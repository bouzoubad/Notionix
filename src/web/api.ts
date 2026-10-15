import type { ExportSummary, ImportSummary, NotionixApi } from '../shared/types'
import { json, request, rpc } from './http'
import { assetNameFromSrc, assetWebPath } from '../shared/assets'

/** Lets the user pick one file; null when the picker is closed without a choice. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function download(bytes: Blob, fileName: string): void {
  const url = URL.createObjectURL(bytes)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** File name from a Content-Disposition header (RFC 6266 filename*). */
function attachmentName(header: string | null): string {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')
  return match ? decodeURIComponent(match[1]) : 'Notionix.zip'
}

const inboxListeners = new Set<() => void>()

/** Called by the real-time connection when the server says the inbox changed. */
export const inboxChanged = (): void => inboxListeners.forEach((l) => l())

/** The app's operations, run on the Notionix server. */
export const webApi: NotionixApi = {
  pages: {
    list: () => rpc('pages.list'),
    get: (id) => rpc('pages.get', id),
    create: (parentId, access, kind) => rpc('pages.create', parentId, access, kind),
    createWith: (parentId, init) => rpc('pages.createWith', parentId, init),
    update: (id, patch) => rpc('pages.update', id, patch),
    move: (id, parentId, index) => rpc('pages.move', id, parentId, index),
    trash: (id) => rpc('pages.trash', id),
    restore: (id) => rpc('pages.restore', id),
    deleteForever: (id) => rpc('pages.deleteForever', id),
    duplicate: (id) => rpc('pages.duplicate', id),
    search: (q, f) => rpc('pages.search', q, f),
    setAccess: (id, access) => rpc('pages.setAccess', id, access),
    setSpace: (id, flag) => rpc('pages.setSpace', id, flag),
    shares: (id) => rpc('pages.shares', id),
    setShare: (id, userId, level) => rpc('pages.setShare', id, userId, level),
    backlinks: (id) => rpc('pages.backlinks', id),
    publish: (id, published) => rpc('pages.publish', id, published),
    versions: (id) => rpc('pages.versions', id),
    view: (id) => rpc('pages.view', id),
    stats: (id) => rpc('pages.stats', id),
    version: (versionId) => rpc('pages.version', versionId),
    restoreVersion: (id, versionId) => rpc('pages.restoreVersion', id, versionId)
  },
  people: {
    list: () => rpc('people.list')
  },
  comments: {
    list: (pageId) => rpc('comments.list', pageId),
    add: (pageId, input) => rpc('comments.add', pageId, input),
    update: (id, body, mentions) => rpc('comments.update', id, body, mentions),
    remove: (id) => rpc('comments.remove', id),
    resolve: (threadId, resolved) => rpc('comments.resolve', threadId, resolved)
  },
  inbox: {
    list: () => rpc('inbox.list'),
    markRead: (ids) => rpc('inbox.markRead', ids),
    activity: () => rpc('inbox.activity'),
    onChange: (listener) => {
      inboxListeners.add(listener)
      return () => inboxListeners.delete(listener)
    }
  },
  reminders: {
    set: (pageId, key, at, text) => rpc('reminders.set', pageId, key, at, text)
  },
  databases: {
    create: (parentId) => rpc('databases.create', parentId),
    get: (id) => rpc('databases.get', id),
    getRow: (rowId) => rpc('databases.getRow', rowId),
    updateSchema: (id, schema, base) => rpc('databases.updateSchema', id, schema, base),
    linkRelation: (id, propertyId) => rpc('databases.linkRelation', id, propertyId),
    enableNesting: (id, kind) => rpc('databases.enableNesting', id, kind),
    importCsv: (id, csv) => rpc('databases.importCsv', id, csv),
    createRow: (id, init) => rpc('databases.createRow', id, init),
    updateRow: (rowId, values) => rpc('databases.updateRow', rowId, values),
    setTemplate: (rowId, flag) => rpc('databases.setTemplate', rowId, flag),
    changePropertyType: (id, propertyId, type) =>
      rpc('databases.changePropertyType', id, propertyId, type)
  },
  assets: {
    save: async (bytes, name) => {
      const { src } = await json<{ src: string }>(`/api/assets?name=${encodeURIComponent(name)}`, {
        body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
        type: 'application/octet-stream'
      })
      return src
    },
    saveFile: async (bytes, name) => {
      const { src } = await json<{ src: string }>(
        `/api/assets?file=1&name=${encodeURIComponent(name)}`,
        { body: new Blob([bytes as Uint8Array<ArrayBuffer>]), type: 'application/octet-stream' }
      )
      return src
    },
    download: async (src, fileName) => {
      const name = assetNameFromSrc(src)
      if (!name) throw new Error('Fichier introuvable.')
      const a = document.createElement('a')
      a.href = `${assetWebPath(name)}?download=${encodeURIComponent(fileName)}`
      a.download = fileName
      document.body.append(a)
      a.click()
      a.remove()
    }
  },
  transfer: {
    importNotion: async (): Promise<ImportSummary | null> => {
      const file = await pickFile('.zip,application/zip')
      if (!file) return null
      const { result } = await json<{ result: ImportSummary }>('/api/transfer/import', {
        body: file,
        type: 'application/zip'
      })
      return result
    },
    exportPdf: async () => {
      // The browser's print dialog saves the page as PDF (print style sheet).
      window.print()
      return null
    },
    exportHtml: async (pageId) => exportArchive(pageId, 'html'),
    exportMarkdown: async (pageId): Promise<ExportSummary | null> =>
      exportArchive(pageId, 'markdown')
  }
}

async function exportArchive(
  pageId: string | null,
  format: 'markdown' | 'html'
): Promise<ExportSummary | null> {
  const query = new URLSearchParams({ format })
  if (pageId) query.set('page', pageId)
  const res = await request(`/api/transfer/export?${query}`)
  const fileName = attachmentName(res.headers.get('Content-Disposition'))
  download(await res.blob(), fileName)
  return { path: fileName, pages: Number(res.headers.get('X-Notionix-Pages') ?? 0) }
}
