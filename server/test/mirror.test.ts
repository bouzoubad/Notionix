import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { GitMirror, MAX_MIRROR_FILE, type MirrorFiles } from '../src/mirror'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Quelqu’un',
      GIT_AUTHOR_EMAIL: 'q@example.com',
      GIT_COMMITTER_NAME: 'Quelqu’un',
      GIT_COMMITTER_EMAIL: 'q@example.com'
    }
  })

const PEOPLE: Record<string, { name: string; email: string }> = {
  alice: { name: 'Alice', email: 'alice@example.com' },
  bob: { name: 'Bob', email: 'bob@example.com' }
}

/** A repository standing for Bitbucket, a mirror writing to it, and what the pages are. */
function setup(): {
  remote: string
  files: MirrorFiles
  mirror: GitMirror
  /** The repository as someone would clone it */
  clone: () => string
} {
  const root = mkdtempSync(join(tmpdir(), 'nx-mirror-'))
  const bare = join(root, 'remote.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  const files: MirrorFiles = new Map()
  const mirror = new GitMirror(
    join(root, 'mirror'),
    { snapshot: async () => new Map(files), person: (id) => PEOPLE[id] ?? null },
    { quietMs: 60_000, maxWaitMs: 600_000, retryMs: 600_000 }
  )
  let n = 0
  const clone = (): string => {
    const dir = join(root, `clone-${++n}`)
    execFileSync('git', ['clone', '-q', bare, dir])
    return dir
  }
  return { remote: `file://${bare}`, files, mirror, clone }
}

let running: GitMirror[] = []
afterEach(async () => {
  await Promise.all(running.map((m) => m.stop()))
  running = []
})

describe('Git mirror of the pages', () => {
  it('writes the pages, commits as the people who changed them, and pushes', async () => {
    const { remote, files, mirror, clone } = setup()
    running.push(mirror)
    files.set('pages/Projet.md', '# Projet\n\nDébut\n')
    files.set('pages/Projet/image.png', new Uint8Array([1, 2, 3]))
    expect(await mirror.configure({ remote })).toEqual({ ok: true })
    await mirror.syncNow()
    expect(mirror.status()).toMatchObject({ configured: true, error: null, unpushed: false })

    let dir = clone()
    expect(readFileSync(join(dir, 'pages/Projet.md'), 'utf8')).toContain('Début')
    expect(readFileSync(join(dir, 'pages/Projet/image.png'))).toEqual(Buffer.from([1, 2, 3]))
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('Miroir Notionix')
    expect(git(dir, 'log', '--format=%s')).toContain('état initial')

    // Two people in the same batch: the last one is the author, the other a co-author.
    mirror.touch('alice')
    await new Promise((r) => setTimeout(r, 5))
    mirror.touch('bob')
    expect(mirror.status().pending).toBe(true)
    files.set('pages/Projet.md', '# Projet\n\nDébut et suite\n')
    files.set('pages/Réunion.md', '# Réunion\n')
    await mirror.syncNow()
    dir = clone()
    expect(git(dir, 'log', '-1', '--format=%an <%ae>|%cn')).toBe(
      'Bob <bob@example.com>|Notionix (miroir)\n'
    )
    const body = git(dir, 'log', '-1', '--format=%B')
    expect(body).toContain('Notionix : Réunion, Projet')
    expect(body).toContain('Co-authored-by: Alice <alice@example.com>')

    // Nothing changed: no commit.
    const count = git(dir, 'rev-list', '--count', 'HEAD')
    await mirror.syncNow()
    expect(git(clone(), 'rev-list', '--count', 'HEAD')).toBe(count)

    // A page removed: its file goes, and its empty folder.
    files.delete('pages/Projet.md')
    files.delete('pages/Projet/image.png')
    await mirror.syncNow()
    dir = clone()
    expect(existsSync(join(dir, 'pages/Projet.md'))).toBe(false)
    expect(existsSync(join(dir, 'pages/Projet'))).toBe(false)
    expect(git(dir, 'log', '-1', '--format=%B')).toContain('- Projet')
  })

  it('keeps going on top of a repository changed by hand, without rewriting its history', async () => {
    const { remote, files, mirror, clone } = setup()
    running.push(mirror)
    files.set('pages/A.md', 'a\n')
    await mirror.configure({ remote })
    await mirror.syncNow()

    const hand = clone()
    writeFileSync(join(hand, 'pages/A.md'), 'changé à la main\n')
    writeFileSync(join(hand, 'notes.txt'), 'à moi\n')
    git(hand, 'add', '-A')
    git(hand, 'commit', '-q', '-m', 'à la main')
    git(hand, 'push', '-q', 'origin', 'main')

    files.set('pages/A.md', 'a, suite\n')
    mirror.touch('alice')
    await mirror.syncNow()
    expect(mirror.status().error).toBeNull()
    const dir = clone()
    expect(readFileSync(join(dir, 'pages/A.md'), 'utf8')).toBe('a, suite\n')
    expect(existsSync(join(dir, 'notes.txt'))).toBe(false)
    // The commit made by hand is still in the history.
    expect(git(dir, 'log', '--format=%s')).toContain('à la main')
  })

  it('starts from what the repository already has, and leaves out files too big', async () => {
    const { remote, files, mirror, clone } = setup()
    running.push(mirror)
    // Bitbucket's starting commit: a .gitignore that would hide pages named "dist".
    const first = clone()
    writeFileSync(join(first, '.gitignore'), 'dist/\n*.mov\n')
    git(first, 'add', '-A')
    git(first, 'commit', '-q', '-m', 'Initial commit')
    git(first, 'push', '-q', 'origin', 'HEAD:main')

    files.set('pages/dist.md', 'une page nommée dist\n')
    files.set('pages/dist/film.mov', new Uint8Array(10))
    files.set('pages/gros.bin', new Uint8Array(MAX_MIRROR_FILE + 1))
    await mirror.configure({ remote })
    await mirror.syncNow()
    expect(mirror.status().skipped).toBe(1)
    const dir = clone()
    expect(git(dir, 'log', '--format=%s')).toContain('Initial commit')
    expect(existsSync(join(dir, 'pages/dist.md'))).toBe(true)
    expect(existsSync(join(dir, 'pages/dist/film.mov'))).toBe(true)
    expect(existsSync(join(dir, 'pages/gros.bin'))).toBe(false)
  })

  it('refuses a repository that does not answer, and keeps its token out of sight', async () => {
    const { mirror } = setup()
    running.push(mirror)
    expect(await mirror.configure({ remote: 'ssh://git@example.com/x.git' })).toMatchObject({
      ok: false
    })
    expect(
      await mirror.configure({ remote: 'file:///nulle/part.git', token: 'secret-123' })
    ).toMatchObject({ ok: false })
    expect(mirror.status()).toMatchObject({ configured: false, hasToken: false })
    expect(JSON.stringify(mirror.status())).not.toContain('secret-123')
  })
})
