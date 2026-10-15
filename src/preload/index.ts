import { contextBridge, ipcRenderer } from 'electron'
import type { NotionixApi } from '../shared/types'

const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args)

const api: NotionixApi = {
  pages: {
    list: () => call('pages:list'),
    get: (id) => call('pages:get', id),
    create: (parentId, access, kind) => call('pages:create', parentId, access, kind),
    createWith: (parentId, init) => call('pages:createWith', parentId, init),
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
    backlinks: (id) => call('pages:backlinks', id),
    publish: (id, published) => call('pages:publish', id, published),
    versions: (id) => call('pages:versions', id),
    version: (versionId) => call('pages:version', versionId),
    restoreVersion: (id, versionId) => call('pages:restoreVersion', id, versionId)
  },
  people: {
    list: () => call('people:list')
  },
  comments: {
    list: (pageId) => call('comments:list', pageId),
    add: (pageId, input) => call('comments:add', pageId, input),
    update: (id, body, mentions) => call('comments:update', id, body, mentions),
    remove: (id) => call('comments:remove', id),
    resolve: (threadId, resolved) => call('comments:resolve', threadId, resolved)
  },
  inbox: {
    list: () => call('inbox:list'),
    markRead: (ids) => call('inbox:markRead', ids),
    activity: () => call('inbox:activity'),
    onChange: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on('inbox:changed', handler)
      return () => ipcRenderer.removeListener('inbox:changed', handler)
    }
  },
  reminders: {
    set: (pageId, key, at, text) => call('reminders:set', pageId, key, at, text)
  },
  databases: {
    create: (parentId) => call('databases:create', parentId),
    get: (id) => call('databases:get', id),
    getRow: (rowId) => call('databases:getRow', rowId),
    updateSchema: (id, schema, base) => call('databases:updateSchema', id, schema, base),
    linkRelation: (id, propertyId) => call('databases:linkRelation', id, propertyId),
    enableNesting: (id, kind) => call('databases:enableNesting', id, kind),
    createRow: (id, init) => call('databases:createRow', id, init),
    updateRow: (rowId, values) => call('databases:updateRow', rowId, values),
    setTemplate: (rowId, flag) => call('databases:setTemplate', rowId, flag),
    changePropertyType: (id, propertyId, type) =>
      call('databases:changePropertyType', id, propertyId, type)
  },
  assets: {
    save: (bytes, name) => call('assets:save', bytes, name),
    saveFile: (bytes, name) => call('assets:saveFile', bytes, name),
    download: (src, fileName) => call('assets:download', src, fileName)
  },
  transfer: {
    importNotion: () => call('transfer:importNotion'),
    exportMarkdown: (pageId) => call('transfer:exportMarkdown', pageId),
    exportHtml: (pageId) => call('transfer:exportHtml', pageId),
    exportPdf: (pageId) => call('transfer:exportPdf', pageId)
  }
}

contextBridge.exposeInMainWorld('api', api)
