import type { ExportSummary, ImportSummary, NotionixApi } from '../shared/types'
import { json, request, rpc } from './http'

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

/** The app's operations, run on the Notionix server. */
export const webApi: NotionixApi = {
  pages: {
    list: () => rpc('pages.list'),
    get: (id) => rpc('pages.get', id),
    create: (parentId, access) => rpc('pages.create', parentId, access),
    update: (id, patch) => rpc('pages.update', id, patch),
    move: (id, parentId, index) => rpc('pages.move', id, parentId, index),
    trash: (id) => rpc('pages.trash', id),
    restore: (id) => rpc('pages.restore', id),
    deleteForever: (id) => rpc('pages.deleteForever', id),
    duplicate: (id) => rpc('pages.duplicate', id),
    search: (q) => rpc('pages.search', q),
    setAccess: (id, access) => rpc('pages.setAccess', id, access),
    setSpace: (id, flag) => rpc('pages.setSpace', id, flag),
    shares: (id) => rpc('pages.shares', id),
    setShare: (id, userId, level) => rpc('pages.setShare', id, userId, level),
    backlinks: (id) => rpc('pages.backlinks', id)
  },
  people: {
    list: () => rpc('people.list')
  },
  databases: {
    create: (parentId) => rpc('databases.create', parentId),
    get: (id) => rpc('databases.get', id),
    getRow: (rowId) => rpc('databases.getRow', rowId),
    updateSchema: (id, schema) => rpc('databases.updateSchema', id, schema),
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
    exportMarkdown: async (pageId): Promise<ExportSummary | null> => {
      const res = await request(
        `/api/transfer/export${pageId ? `?page=${encodeURIComponent(pageId)}` : ''}`
      )
      const fileName = attachmentName(res.headers.get('Content-Disposition'))
      download(await res.blob(), fileName)
      return { path: fileName, pages: Number(res.headers.get('X-Notionix-Pages') ?? 0) }
    }
  }
}
