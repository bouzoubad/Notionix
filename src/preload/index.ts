import { contextBridge, ipcRenderer } from 'electron'
import type { NotionixApi } from '../shared/types'

const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args)

const api: NotionixApi = {
  pages: {
    list: () => call('pages:list'),
    get: (id) => call('pages:get', id),
    create: (parentId) => call('pages:create', parentId),
    update: (id, patch) => call('pages:update', id, patch),
    move: (id, parentId, index) => call('pages:move', id, parentId, index),
    trash: (id) => call('pages:trash', id),
    restore: (id) => call('pages:restore', id),
    deleteForever: (id) => call('pages:deleteForever', id),
    duplicate: (id) => call('pages:duplicate', id),
    search: (q) => call('pages:search', q)
  },
  transfer: {
    importNotion: () => call('transfer:importNotion'),
    exportMarkdown: (pageId) => call('transfer:exportMarkdown', pageId)
  }
}

contextBridge.exposeInMainWorld('api', api)
