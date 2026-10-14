import { writeFile } from 'fs/promises'
import type { BrowserWindow, Dialog, IpcMain } from 'electron'
import type { ExportSummary, ImportSummary } from '../shared/types'
import type { PageRepository } from './db/pageRepository'
import type { AssetStore } from './assets'
import type { DatabaseRepository } from './db/databaseRepository'
import { exportPagesAsMarkdown, safeName, zipMarkdown } from './transfer/markdownExport'
import { importNotionExport } from './transfer/notionImport'

export function registerPageHandlers(ipc: IpcMain, repo: PageRepository): void {
  ipc.handle('pages:list', () => repo.list())
  ipc.handle('pages:get', (_e, id: string) => repo.get(id))
  ipc.handle('pages:create', (_e, parentId: string | null) => repo.create(parentId))
  ipc.handle('pages:update', (_e, id: string, patch) => repo.update(id, patch))
  ipc.handle('pages:move', (_e, id: string, parentId: string | null, index: number) =>
    repo.move(id, parentId, index)
  )
  ipc.handle('pages:trash', (_e, id: string) => repo.trash(id))
  ipc.handle('pages:restore', (_e, id: string) => repo.restore(id))
  ipc.handle('pages:deleteForever', (_e, id: string) => repo.deleteForever(id))
  ipc.handle('pages:duplicate', (_e, id: string) => repo.duplicate(id))
  ipc.handle('pages:search', (_e, q: string) => repo.search(q))
}

export interface TransferDeps {
  dialog: Pick<Dialog, 'showOpenDialog' | 'showSaveDialog'>
  getWindow: () => BrowserWindow | null
}

export function registerDatabaseHandlers(ipc: IpcMain, dbs: DatabaseRepository): void {
  ipc.handle('databases:create', (_e, parentId: string | null) => dbs.create(parentId))
  ipc.handle('databases:get', (_e, id: string) => dbs.get(id))
  ipc.handle('databases:getRow', (_e, rowId: string) => dbs.getRow(rowId))
  ipc.handle('databases:updateSchema', (_e, id: string, schema: unknown) =>
    dbs.updateSchema(id, schema)
  )
  ipc.handle('databases:createRow', (_e, id: string, init) => dbs.createRow(id, init ?? {}))
  ipc.handle('databases:updateRow', (_e, rowId: string, values) =>
    dbs.updateRow(rowId, values ?? {})
  )
  ipc.handle('databases:setTemplate', (_e, rowId: string, flag: boolean) =>
    dbs.setTemplate(rowId, flag === true)
  )
  ipc.handle('databases:changePropertyType', (_e, id: string, propertyId: string, type) =>
    dbs.changePropertyType(id, propertyId, type)
  )
}

export function registerAssetHandlers(ipc: IpcMain, assets: AssetStore): void {
  ipc.handle('assets:save', (_e, bytes: Uint8Array, name: string) => assets.save(bytes, name))
}

export function registerTransferHandlers(
  ipc: IpcMain,
  repo: PageRepository,
  dbs: DatabaseRepository,
  assets: AssetStore,
  deps: TransferDeps
): void {
  ipc.handle('transfer:importNotion', async (): Promise<ImportSummary | null> => {
    const options = {
      title: 'Choisir un export Notion (.zip ou dossier extrait)',
      properties: ['openFile', 'openDirectory'] as Array<'openFile' | 'openDirectory'>,
      filters: [{ name: 'Export Notion', extensions: ['zip'] }]
    }
    const win = deps.getWindow()
    const result = win
      ? await deps.dialog.showOpenDialog(win, options)
      : await deps.dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return importNotionExport(repo, result.filePaths[0], assets)
  })

  ipc.handle(
    'transfer:exportMarkdown',
    async (_e, pageId: string | null): Promise<ExportSummary | null> => {
      const { files, attachments } = await exportPagesAsMarkdown(
        repo.list(),
        (id) => repo.get(id),
        (src) => assets.read(src),
        pageId,
        (id) => dbs.get(id)
      )
      if (files.length === 0) throw new Error('Aucune page à exporter.')
      const single = files.length === 1 && attachments.length === 0
      const title = pageId ? safeName(repo.get(pageId)?.title ?? '') : 'Notionix'
      const options = {
        title: 'Exporter en Markdown',
        defaultPath: single ? `${title}.md` : `${title}.zip`,
        filters: single
          ? [{ name: 'Markdown', extensions: ['md'] }]
          : [{ name: 'Archive ZIP', extensions: ['zip'] }]
      }
      const win = deps.getWindow()
      const result = win
        ? await deps.dialog.showSaveDialog(win, options)
        : await deps.dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, single ? files[0].markdown : zipMarkdown(files, attachments))
      return { path: result.filePath, pages: files.length }
    }
  )
}
