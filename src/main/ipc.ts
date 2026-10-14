import { writeFile } from 'fs/promises'
import type { BrowserWindow, Dialog, IpcMain } from 'electron'
import type { ExportSummary, ImportSummary } from '../shared/types'
import type { PageRepository } from './db/pageRepository'
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

export function registerTransferHandlers(
  ipc: IpcMain,
  repo: PageRepository,
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
    return importNotionExport(repo, result.filePaths[0])
  })

  ipc.handle(
    'transfer:exportMarkdown',
    async (_e, pageId: string | null): Promise<ExportSummary | null> => {
      const files = exportPagesAsMarkdown(repo.list(), (id) => repo.get(id), pageId)
      if (files.length === 0) throw new Error('Aucune page à exporter.')
      const single = files.length === 1
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
      await writeFile(result.filePath, single ? files[0].markdown : zipMarkdown(files))
      return { path: result.filePath, pages: files.length }
    }
  )
}
