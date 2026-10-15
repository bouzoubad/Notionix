import { contextBridge, ipcRenderer } from 'electron'
import type { NotionixApi } from '../shared/types'

const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args)

const api: NotionixApi = {
  pages: {
    list: () => call('pages:list'),
    get: (id) => call('pages:get', id),
    create: (parentId, access) => call('pages:create', parentId, access),
    update: (id, patch) => call('pages:update', id, patch),
    move: (id, parentId, index) => call('pages:move', id, parentId, index),
    trash: (id) => call('pages:trash', id),
    restore: (id) => call('pages:restore', id),
    deleteForever: (id) => call('pages:deleteForever', id),
    duplicate: (id) => call('pages:duplicate', id),
    search: (q) => call('pages:search', q),
    setAccess: (id, access) => call('pages:setAccess', id, access),
    setSpace: (id, flag) => call('pages:setSpace', id, flag),
    shares: (id) => call('pages:shares', id),
    setShare: (id, userId, level) => call('pages:setShare', id, userId, level),
    backlinks: (id) => call('pages:backlinks', id)
  },
  people: {
    list: () => call('people:list')
  },
  databases: {
    create: (parentId) => call('databases:create', parentId),
    get: (id) => call('databases:get', id),
    getRow: (rowId) => call('databases:getRow', rowId),
    updateSchema: (id, schema) => call('databases:updateSchema', id, schema),
    createRow: (id, init) => call('databases:createRow', id, init),
    updateRow: (rowId, values) => call('databases:updateRow', rowId, values),
    setTemplate: (rowId, flag) => call('databases:setTemplate', rowId, flag),
    changePropertyType: (id, propertyId, type) =>
      call('databases:changePropertyType', id, propertyId, type)
  },
  assets: {
    save: (bytes, name) => call('assets:save', bytes, name)
  },
  transfer: {
    importNotion: () => call('transfer:importNotion'),
    exportMarkdown: (pageId) => call('transfer:exportMarkdown', pageId)
  }
}

contextBridge.exposeInMainWorld('api', api)
