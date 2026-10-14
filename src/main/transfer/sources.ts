import { createWriteStream } from 'fs'
import { mkdtemp, readdir, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import { pipeline } from 'stream/promises'
import yauzl from 'yauzl'

export interface SourceFile {
  /** POSIX-style path inside the export */
  path: string
  size: number
  read(): Promise<Buffer>
}

export interface Source {
  files: SourceFile[]
  close(): Promise<void>
}

const MAX_NESTED_ZIP_DEPTH = 2
const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$)/

/** Opens a Notion export given as a .zip (possibly containing part zips) or as an extracted folder. */
export async function openSource(path: string): Promise<Source> {
  const info = await stat(path)
  return info.isDirectory() ? openDirectory(path) : openZip(path)
}

async function openDirectory(root: string): Promise<Source> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files: SourceFile[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue // symbolic links and special files are not followed
    const absolute = join(entry.parentPath, entry.name)
    const rel = absolute
      .slice(root.length + 1)
      .split(sep)
      .join('/')
    if (IGNORED.test(rel)) continue
    files.push({ path: rel, size: (await stat(absolute)).size, read: () => readFile(absolute) })
  }
  return { files, close: async () => {} }
}

async function openZip(file: string): Promise<Source> {
  const cleanups: (() => Promise<void>)[] = []
  const files: SourceFile[] = []
  const seen = new Set<string>()
  const tempRoot = { dir: null as string | null }

  const addArchive = async (archive: string, depth: number): Promise<void> => {
    const zip = await openYauzl(archive)
    cleanups.push(async () => zip.close())
    const entries = await listEntries(zip)
    for (const entry of entries) {
      const name = entry.fileName
      if (name.endsWith('/') || IGNORED.test(name)) continue
      if (/\.zip$/i.test(name) && depth < MAX_NESTED_ZIP_DEPTH) {
        // Large Notion exports are split into part archives stored inside the main one.
        tempRoot.dir ??= await mkdtemp(join(tmpdir(), 'notionix-import-'))
        const inner = join(tempRoot.dir, `part-${files.length}-${seen.size}.zip`)
        await pipeline(await openEntry(zip, entry), createWriteStream(inner))
        seen.add(`${depth}:${name}`)
        await addArchive(inner, depth + 1)
        continue
      }
      if (seen.has(name)) continue // the same path in two parts: keep the first
      seen.add(name)
      files.push({
        path: name,
        size: entry.uncompressedSize,
        read: async () => collect(await openEntry(zip, entry))
      })
    }
  }

  try {
    await addArchive(file, 0)
  } catch (e) {
    await Promise.all(cleanups.map((c) => c()))
    if (tempRoot.dir) await rm(tempRoot.dir, { recursive: true, force: true })
    throw e
  }
  return {
    files,
    close: async () => {
      await Promise.all(cleanups.map((c) => c()))
      if (tempRoot.dir) await rm(tempRoot.dir, { recursive: true, force: true })
    }
  }
}

const openYauzl = (path: string): Promise<yauzl.ZipFile> =>
  new Promise((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) =>
      err || !zip ? reject(err ?? new Error('Archive illisible')) : resolve(zip)
    )
  )

const listEntries = (zip: yauzl.ZipFile): Promise<yauzl.Entry[]> =>
  new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = []
    zip.on('entry', (entry: yauzl.Entry) => {
      entries.push(entry)
      zip.readEntry()
    })
    zip.once('end', () => resolve(entries))
    zip.once('error', reject)
    zip.readEntry()
  })

const openEntry = (zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> =>
  new Promise((resolve, reject) =>
    zip.openReadStream(entry, (err, stream) =>
      err || !stream
        ? reject(err ?? new Error(`Entrée illisible : ${entry.fileName}`))
        : resolve(stream)
    )
  )

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks)
}
