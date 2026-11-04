import { execFile } from 'child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync
} from 'fs'
import { dirname, join, relative, sep } from 'path'
import type { MirrorStatus } from '../../src/shared/collab'

/** What the mirror writes: path in the repository -> content. */
export type MirrorFiles = Map<string, string | Uint8Array>

export interface MirrorSource {
  /** Every file of the mirror as it should be now (pages as Markdown, databases as CSV, images) */
  snapshot(): Promise<MirrorFiles>
  /** Name and e-mail of an account, for the authors of commits; null when unknown */
  person(id: string): { name: string; email: string } | null
}

export interface MirrorSettings {
  /** https:// address of the repository (file:// in tests) */
  remote: string
  /** Access token of the repository (Bitbucket: Read + Write); null for a remote without one */
  token: string | null
  branch: string
}

export interface MirrorTiming {
  /** Export this long after the last change */
  quietMs: number
  /** ... but at least this often while changes keep coming */
  maxWaitMs: number
  /** A failed push is tried again after this long */
  retryMs: number
}

const DEFAULT_TIMING: MirrorTiming = {
  quietMs: 60_000,
  maxWaitMs: 10 * 60_000,
  retryMs: 5 * 60_000
}
/** Files bigger than this stay out of the repository (Git hosts refuse big files). */
export const MAX_MIRROR_FILE = 25 * 1024 * 1024
const COMMITTER = { name: 'Notionix (miroir)', email: 'notionix@localhost' }
const SYSTEM_AUTHOR = { name: 'Notionix', email: 'notionix@localhost' }

const README = `# Miroir Notionix

Copie automatique, en Markdown, des pages de Notionix ouvertes à tout leur
espace : l'espace principal dans \`pages/\`, chacun des autres espaces dans
\`espaces/<nom de l'espace>/\`. Une page par fichier \`.md\`, ses sous-pages et
ses images dans le dossier du même nom, les bases de données en \`.csv\`.

Écrit par le serveur Notionix à chaque modification (regroupées par minute) :
l'auteur d'un commit est la personne qui a modifié les pages. **Ne pas modifier
ce dépôt à la main** : le miroir remet son état par-dessus. Les pages privées,
partagées à quelques personnes, la corbeille et les commentaires n'y sont pas.
`
const GITIGNORE = '.DS_Store\n'

/** Messages of git as people can read them: one line, no secret. */
const clean = (text: string, token: string | null): string => {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('hint:'))
    .slice(-2)
    .join(' ')
  return (token ? line.split(token).join('***') : line).slice(0, 300)
}

const sameContent = (file: string, content: string | Uint8Array): boolean => {
  if (!existsSync(file)) return false
  const current = readFileSync(file)
  const wanted = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
  return current.equals(wanted)
}

/** Paths of the files under `dir` (relative, with /), except git's own. */
const listFiles = (dir: string): string[] => {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (d === dir && entry.name === '.git') continue
      const path = join(d, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(relative(dir, path).split(sep).join('/'))
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

/** Removes the folders left empty under `dir` (deepest first). */
const pruneEmpty = (dir: string): void => {
  const walk = (d: string): boolean => {
    let empty = true
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (d === dir && entry.name === '.git') {
        empty = false
        continue
      }
      if (entry.isDirectory()) {
        if (walk(join(d, entry.name))) rmdirSync(join(d, entry.name))
        else empty = false
      } else empty = false
    }
    return empty
  }
  if (existsSync(dir)) walk(dir)
}

/** Title of a page from its file's path, for commit messages. */
const pageOf = (path: string): string | null =>
  (path.startsWith('pages/') || path.startsWith('espaces/')) && /\.(md|csv)$/.test(path)
    ? path
        .split('/')
        .pop()!
        .replace(/\.(md|csv)$/, '')
    : null

/**
 * The Git mirror of the team's pages: after changes (grouped), writes every
 * page as Markdown into a working copy, commits with the people who made the
 * changes as authors, and pushes to the repository (one branch, linear
 * history). Never throws: problems are kept in `status().error` and tried
 * again later.
 */
export class GitMirror {
  private settings: MirrorSettings | null = null
  private timer: NodeJS.Timeout | null = null
  private firstChangeAt: number | null = null
  /** People who changed pages since the last commit, with when */
  private authors = new Map<string, number>()
  private running: Promise<void> = Promise.resolve()
  private stopped = false
  private state: Omit<MirrorStatus, 'remote' | 'branch' | 'hasToken' | 'configured'> = {
    pending: false,
    lastCommit: null,
    lastCommitAt: null,
    lastPushAt: null,
    unpushed: false,
    skipped: 0,
    error: null
  }

  constructor(
    /** Folder of the mirror: settings and working copy */
    private readonly dir: string,
    private readonly source: MirrorSource,
    private readonly timing: MirrorTiming = DEFAULT_TIMING,
    private readonly git = 'git'
  ) {
    try {
      const saved = JSON.parse(readFileSync(this.settingsFile, 'utf8')) as Partial<MirrorSettings>
      if (typeof saved.remote === 'string' && typeof saved.branch === 'string')
        this.settings = {
          remote: saved.remote,
          token: typeof saved.token === 'string' ? saved.token : null,
          branch: saved.branch
        }
    } catch {
      this.settings = null
    }
  }

  private get settingsFile(): string {
    return join(this.dir, 'settings.json')
  }

  private get repo(): string {
    return join(this.dir, 'repo')
  }

  status(): MirrorStatus {
    const s = this.settings
    return {
      configured: s !== null,
      remote: s?.remote ?? null,
      branch: s?.branch ?? 'main',
      hasToken: Boolean(s?.token),
      ...this.state
    }
  }

  /**
   * Links the mirror to a repository (checked first: it must answer with
   * these credentials), or unlinks it (null). A new repository starts from
   * a new working copy. The token is kept when not given again.
   */
  async configure(
    next: { remote: string; token?: string | null; branch?: string } | null
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (next === null) {
      this.cancel()
      await this.running
      this.settings = null
      rmSync(this.settingsFile, { force: true })
      rmSync(this.repo, { recursive: true, force: true })
      this.state = {
        ...this.state,
        lastCommit: null,
        lastCommitAt: null,
        lastPushAt: null,
        unpushed: false,
        error: null
      }
      return { ok: true }
    }
    const remote = next.remote.trim()
    if (!/^(https:\/\/[^\s@]+|file:\/\/\/\S+)$/.test(remote))
      return { ok: false, error: 'Adresse du dépôt invalide (https://…).' }
    const branch = (next.branch ?? 'main').trim() || 'main'
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.includes('..'))
      return { ok: false, error: 'Nom de branche invalide.' }
    const token =
      next.token === undefined || next.token === ''
        ? this.settings?.remote === remote
          ? this.settings.token
          : null
        : next.token?.trim() || null
    const candidate: MirrorSettings = { remote, token, branch }
    const check = await this.run(candidate, ['ls-remote', '--heads', remote], this.dir, true)
    if (!check.ok)
      return { ok: false, error: `Le dépôt ne répond pas avec ces accès : ${check.output}` }
    this.cancel()
    await this.running
    const changedRepo = this.settings?.remote !== remote || this.settings?.branch !== branch
    this.settings = candidate
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.settingsFile, JSON.stringify(candidate), { mode: 0o600 })
    if (changedRepo) rmSync(this.repo, { recursive: true, force: true })
    this.state.error = null
    this.schedule(0)
    return { ok: true }
  }

  /** Pages changed (by this person; null: the server itself): exported a bit later. */
  touch(userId: string | null): void {
    if (!this.settings || this.stopped) return
    if (userId) this.authors.set(userId, Date.now())
    const now = Date.now()
    this.firstChangeAt ??= now
    const latest = this.firstChangeAt + this.timing.maxWaitMs
    this.schedule(Math.max(0, Math.min(this.timing.quietMs, latest - now)))
  }

  /** Exports, commits and pushes now (after any run in progress). */
  syncNow(): Promise<void> {
    this.cancel()
    this.running = this.running.then(() => this.sync())
    return this.running
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.cancel()
    await this.running
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.state.pending = false
  }

  private schedule(delay: number): void {
    if (this.stopped || !this.settings) return
    if (this.timer) clearTimeout(this.timer)
    this.state.pending = true
    this.timer = setTimeout(() => {
      this.timer = null
      void this.syncNow()
    }, delay)
    this.timer.unref()
  }

  /** Runs git; never throws. `auth` sends the token (HTTP header, never written to disk). */
  private run(
    settings: MirrorSettings,
    args: string[],
    cwd: string,
    auth = false,
    env: Record<string, string> = {}
  ): Promise<{ ok: boolean; output: string }> {
    const extra: Record<string, string> =
      auth && settings.token && settings.remote.startsWith('https://')
        ? {
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'http.extraHeader',
            GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-token-auth:${settings.token}`).toString('base64')}`
          }
        : {}
    mkdirSync(cwd, { recursive: true })
    return new Promise((resolve) => {
      execFile(
        this.git,
        args,
        {
          cwd,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...extra, ...env },
          maxBuffer: 16 * 1024 * 1024,
          timeout: 5 * 60_000
        },
        (error, stdout, stderr) =>
          resolve({
            ok: !error,
            output: error ? clean(`${stderr}\n${error.message}`, settings.token) : stdout
          })
      )
    })
  }

  /** The working copy, made once: the repository's branch if it has one, else a new one. */
  private async prepare(s: MirrorSettings): Promise<void> {
    if (existsSync(join(this.repo, '.git'))) return
    rmSync(this.repo, { recursive: true, force: true })
    const step = async (args: string[], auth = false): Promise<string> => {
      const r = await this.run(s, args, this.repo, auth)
      if (!r.ok) throw new Error(r.output)
      return r.output
    }
    await step(['init', '-q', '-b', s.branch])
    await step(['remote', 'add', 'origin', s.remote])
    const heads = await step(['ls-remote', '--heads', 'origin', s.branch], true)
    if (heads.trim()) {
      await step(['fetch', '-q', 'origin', s.branch], true)
      await step(['reset', '-q', '--hard', 'FETCH_HEAD'])
    }
  }

  /** Writes the files of the mirror into the working copy; returns how many were too big. */
  private write(files: MirrorFiles): number {
    const wanted = new Map<string, string | Uint8Array>([
      ['README.md', README],
      ['.gitignore', GITIGNORE]
    ])
    let skipped = 0
    for (const [path, content] of files) {
      if (path.split('/').some((p) => p === '' || p === '.' || p === '..' || p === '.git')) continue
      if (typeof content !== 'string' && content.byteLength > MAX_MIRROR_FILE) {
        skipped++
        continue
      }
      wanted.set(path, content)
    }
    for (const path of listFiles(this.repo))
      if (!wanted.has(path)) rmSync(join(this.repo, path), { force: true })
    pruneEmpty(this.repo)
    for (const [path, content] of wanted) {
      const file = join(this.repo, path)
      if (sameContent(file, content)) continue
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content)
    }
    return skipped
  }

  /** Message of a commit: the pages changed, by kind. */
  private async message(s: MirrorSettings, initial: boolean): Promise<string> {
    if (initial) return 'Notionix : état initial du miroir'
    const status = await this.run(s, ['status', '--porcelain', '-z', '--no-renames'], this.repo)
    const entries = status.output.split('\0').filter(Boolean)
    const added: string[] = []
    const changed: string[] = []
    const removed: string[] = []
    for (const entry of entries) {
      const code = entry.slice(0, 2)
      const title = pageOf(entry.slice(3))
      if (!title) continue
      const list =
        code.includes('A') || code === '??' ? added : code.includes('D') ? removed : changed
      if (!list.includes(title)) list.push(title)
    }
    const all = [...added, ...changed, ...removed]
    const subject = all.length
      ? `Notionix : ${all.slice(0, 3).join(', ')}${all.length > 3 ? ` (+${all.length - 3})` : ''}`
      : 'Notionix : mise à jour'
    const body = [
      ...added.map((t) => `+ ${t}`),
      ...changed.map((t) => `~ ${t}`),
      ...removed.map((t) => `- ${t}`)
    ]
    return body.length ? `${subject}\n\n${body.join('\n')}` : subject
  }

  /** The author of a commit (the last to change), and the others as co-authors. */
  private people(authors: Map<string, number>): {
    author: { name: string; email: string }
    others: { name: string; email: string }[]
  } {
    const known = [...authors.entries()]
      .sort((a, b) => b[1] - a[1])
      .flatMap(([id]) => {
        const p = this.source.person(id)
        return p ? [p] : []
      })
    return { author: known[0] ?? SYSTEM_AUTHOR, others: known.slice(1) }
  }

  private async commit(
    s: MirrorSettings,
    message: string,
    authors: Map<string, number>
  ): Promise<void> {
    const { author, others } = this.people(authors)
    const trailers = others.map((o) => `Co-authored-by: ${o.name} <${o.email}>`)
    const full = trailers.length ? `${message}\n\n${trailers.join('\n')}` : message
    // The message goes through a file (outside the working copy).
    const file = join(this.dir, 'COMMIT_MSG')
    writeFileSync(file, full)
    const done = await this.run(s, ['commit', '-q', '--no-verify', '-F', file], this.repo, false, {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: COMMITTER.name,
      GIT_COMMITTER_EMAIL: COMMITTER.email
    })
    rmSync(file, { force: true })
    if (!done.ok) throw new Error(done.output)
  }

  /** Pushes the branch; when the repository moved on (changed by hand), the mirror's state goes on top. */
  private async push(
    s: MirrorSettings,
    message: string,
    authors: Map<string, number>
  ): Promise<void> {
    const target = `HEAD:refs/heads/${s.branch}`
    const first = await this.run(s, ['push', '-q', 'origin', target], this.repo, true)
    if (first.ok) return
    if (!/rejected|non-fast-forward|fetch first/i.test(first.output)) throw new Error(first.output)
    const fetched = await this.run(s, ['fetch', '-q', 'origin', s.branch], this.repo, true)
    if (!fetched.ok) throw new Error(fetched.output)
    // Same files as now, on top of the repository's history: no history rewritten.
    const reset = await this.run(s, ['reset', '-q', '--soft', 'FETCH_HEAD'], this.repo)
    if (!reset.ok) throw new Error(reset.output)
    const diff = await this.run(s, ['diff', '--cached', '--quiet'], this.repo)
    if (!diff.ok)
      await this.commit(
        s,
        `${message}\n\n(état du miroir remis par-dessus des modifications faites à la main)`,
        authors
      )
    const again = await this.run(s, ['push', '-q', 'origin', target], this.repo, true)
    if (!again.ok) throw new Error(again.output)
  }

  private async sync(): Promise<void> {
    const s = this.settings
    this.state.pending = false
    if (!s || this.stopped) return
    this.firstChangeAt = null
    let authors = new Map<string, number>()
    try {
      await this.prepare(s)
      const head = await this.run(s, ['rev-parse', '--verify', '-q', 'HEAD'], this.repo)
      // The people of the changes this export holds: those made until now.
      authors = this.authors
      this.authors = new Map()
      const files = await this.source.snapshot()
      this.state.skipped = this.write(files)
      await this.run(s, ['add', '-A'], this.repo)
      const staged = await this.run(s, ['diff', '--cached', '--quiet'], this.repo)
      let message = 'Notionix : mise à jour'
      if (!staged.ok) {
        message = await this.message(s, !head.ok)
        await this.commit(s, message, authors)
        this.state.lastCommit = message.split('\n')[0]
        this.state.lastCommitAt = Date.now()
        this.state.unpushed = true
      }
      if (this.state.unpushed || !head.ok) {
        await this.push(s, message, authors)
        this.state.unpushed = false
        this.state.lastPushAt = Date.now()
      }
      this.state.error = null
    } catch (e) {
      // Kept for the next run: the people of this batch still author it.
      for (const [id, at] of authors) if (!this.authors.has(id)) this.authors.set(id, at)
      this.state.error = clean(e instanceof Error ? e.message : String(e), s.token)
      this.schedule(this.timing.retryMs)
    }
  }
}
