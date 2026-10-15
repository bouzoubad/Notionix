import type { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'crypto'
import { promisify } from 'util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: object
) => Promise<Buffer>

export type Role = 'admin' | 'editor' | 'reader' | 'guest'
export const ROLES: Role[] = ['admin', 'editor', 'reader', 'guest']

export interface User {
  id: string
  email: string
  name: string
  role: Role
  disabled: boolean
  createdAt: number
}

interface UserRow {
  id: string
  email: string
  name: string
  role: Role
  password_hash: string
  disabled: number
  created_at: number
}

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
export const MIN_PASSWORD_LENGTH = 10

/** "scrypt$<salt>$<hash>" with a random salt per password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 32, SCRYPT)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT)
  return timingSafeEqual(actual, expected)
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  disabled: r.disabled === 1,
  createdAt: r.created_at
})

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex')

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** Accounts and login sessions. Only a hash of each session token is stored. */
export class Accounts {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sessionDays: number,
    private readonly now: () => number = Date.now
  ) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
  }

  list(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY name').all() as unknown as UserRow[]).map(
      toUser
    )
  }

  byId(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
    return row ? toUser(row) : null
  }

  async create(input: {
    email: string
    name: string
    role: Role
    password: string
  }): Promise<User> {
    const email = input.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new AuthError('Adresse e-mail invalide.', 400)
    if (!ROLES.includes(input.role)) throw new AuthError('Rôle invalide.', 400)
    checkPassword(input.password)
    if (this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new AuthError('Un compte existe déjà avec cette adresse.', 409)
    }
    const id = randomUUID()
    this.db
      .prepare(
        'INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        email,
        input.name.trim() || email,
        input.role,
        await hashPassword(input.password),
        this.now()
      )
    return this.byId(id)!
  }

  async update(
    id: string,
    patch: { name?: string; role?: Role; password?: string; disabled?: boolean }
  ): Promise<User> {
    const user = this.byId(id)
    if (!user) throw new AuthError('Compte introuvable.', 404)
    if (patch.role !== undefined && !ROLES.includes(patch.role))
      throw new AuthError('Rôle invalide.', 400)
    const losesAdmin =
      user.role === 'admin' && ((patch.role && patch.role !== 'admin') || patch.disabled === true)
    if (losesAdmin && this.activeAdmins() <= 1)
      throw new AuthError('Il doit rester au moins un administrateur actif.', 409)
    if (patch.name !== undefined)
      this.db
        .prepare('UPDATE users SET name = ? WHERE id = ?')
        .run(patch.name.trim() || user.email, id)
    if (patch.role !== undefined)
      this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(patch.role, id)
    if (patch.disabled !== undefined)
      this.db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(patch.disabled ? 1 : 0, id)
    if (patch.password !== undefined) {
      checkPassword(patch.password)
      this.db
        .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(await hashPassword(patch.password), id)
    }
    // A new password, a disabled account or a lower role ends the open sessions.
    if (patch.password !== undefined || patch.disabled === true || patch.role !== undefined)
      this.endSessions(id)
    return this.byId(id)!
  }

  private activeAdmins(): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0")
        .get() as { n: number }
    ).n
  }

  /** Checks the password and opens a session; the same error for an unknown account and a wrong password. */
  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as UserRow | undefined
    const ok = row
      ? await verifyPassword(password, row.password_hash)
      : await hashPassword(password).then(() => false)
    if (!row || !ok) throw new AuthError('E-mail ou mot de passe incorrect.', 401)
    if (row.disabled === 1) throw new AuthError('Ce compte est désactivé.', 403)
    const token = randomBytes(32).toString('base64url')
    const t = this.now()
    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
      )
      .run(tokenHash(token), row.id, t, t + this.sessionDays * 864e5)
    return { token, user: toUser(row) }
  }

  /** The active user of a session token, or null. */
  authenticate(token: string | null | undefined): User | null {
    if (!token) return null
    const row = this.db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`
      )
      .get(tokenHash(token), this.now()) as UserRow | undefined
    return row ? toUser(row) : null
  }

  logout(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token))
  }

  endSessions(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  }

  purgeExpired(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now())
  }
}

function checkPassword(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(
      `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`,
      400
    )
  }
}

/** Slows down password guessing: a few failures per account and address, then a pause. */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; until: number }>()

  constructor(
    private readonly max = 8,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now
  ) {}

  check(key: string): void {
    const entry = this.failures.get(key)
    if (entry && entry.count >= this.max && entry.until > this.now()) {
      throw new AuthError('Trop de tentatives. Réessayez dans quelques minutes.', 429)
    }
  }

  fail(key: string): void {
    const entry = this.failures.get(key)
    const expired = !entry || entry.until <= this.now()
    this.failures.set(key, {
      count: expired ? 1 : entry.count + 1,
      until: this.now() + this.windowMs
    })
  }

  succeed(key: string): void {
    this.failures.delete(key)
  }
}
