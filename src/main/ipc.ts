import { writeFile } from 'fs/promises'
import type { BrowserWindow, Dialog, IpcMain } from 'electron'
import type { ExportSummary, ImportSummary, NewComment, PageAccess, Person } from '../shared/types'
import type { TeamRepository } from '../core/db/teamRepository'
import type { PageRepository } from '../core/db/pageRepository'
import type { AssetStore } from '../core/assets'
import type { DatabaseRepository } from '../core/db/databaseRepository'
import { buildMarkdownArchive, safeName } from '../core/transfer/markdownExport'
import { importNotionExport } from '../core/transfer/notionImport'

export function registerPageHandlers(ipc: IpcMain, repo: PageRepository): void {
  ipc.handle('pages:list', () => repo.list())
  ipc.handle('pages:get', (_e, id: string) => repo.get(id))
  ipc.handle(
    'pages:create',
    (_e, parentId: string | null, access?: PageAccess, kind?: 'page' | 'synced') =>
      repo.create(parentId, access ?? 'inherit', kind === 'synced' ? 'synced' : 'page')
  )
  ipc.handle('pages:update', (_e, id: string, patch) => repo.update(id, patch))
  ipc.handle('pages:move', (_e, id: string, parentId: string | null, index: number) =>
    repo.move(id, parentId, index)
  )
  ipc.handle('pages:trash', (_e, id: string) => repo.trash(id))
  ipc.handle('pages:restore', (_e, id: string) => repo.restore(id))
  ipc.handle('pages:deleteForever', (_e, id: string) => repo.deleteForever(id))
  ipc.handle('pages:duplicate', (_e, id: string) => repo.duplicate(id))
  ipc.handle('pages:search', (_e, q: string) => repo.search(q))
  ipc.handle('pages:setAccess', (_e, id: string, access: PageAccess) => repo.setAccess(id, access))
  ipc.handle('pages:setSpace', (_e, id: string, flag: boolean) => repo.setSpace(id, flag === true))
  // One person on this computer: nothing to share with.
  ipc.handle('pages:shares', () => [])
  ipc.handle('pages:setShare', () => {
    throw new Error('Le partage se fait sur un serveur Notionix.')
  })
  ipc.handle('pages:backlinks', (_e, id: string) => repo.backlinks(id))
  ipc.handle('pages:versions', (_e, id: string) => repo.versions(id))
  ipc.handle('pages:version', (_e, versionId: number) => repo.version(versionId))
  ipc.handle('pages:restoreVersion', (_e, id: string, versionId: number) =>
    repo.restoreVersion(id, versionId)
  )
  ipc.handle('people:list', (): Person[] => [LOCAL_PERSON])
}

/** The only person of the desktop app, recorded as the author of every change. */
export const LOCAL_PERSON: Person = { id: 'local', name: 'Moi', email: '' }

/** Comments, inbox and reminders of the only person of the desktop app. */
export function registerTeamHandlers(ipc: IpcMain, team: TeamRepository): void {
  const me = LOCAL_PERSON.id
  ipc.handle('comments:list', (_e, pageId: string) => team.comments(pageId))
  ipc.handle('comments:add', (_e, pageId: string, input: NewComment) =>
    team.addComment(pageId, me, input)
  )
  ipc.handle('comments:update', (_e, id: string, body: string) => team.updateComment(id, body, []))
  ipc.handle('comments:remove', (_e, id: string) => team.removeComment(id))
  ipc.handle('comments:resolve', (_e, threadId: string, resolved: boolean) =>
    team.resolveThread(threadId, resolved === true)
  )
  ipc.handle('inbox:list', () => team.inbox(me))
  ipc.handle('inbox:markRead', (_e, ids: string[] | null) => team.markRead(me, ids))
  ipc.handle('inbox:activity', () => team.activity(150))
  ipc.handle('reminders:set', (_e, pageId: string, key: string, at: number | null, text: string) =>
    team.setReminder(me, pageId, key, at, text)
  )
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

export function registerAssetHandlers(
  ipc: IpcMain,
  assets: AssetStore,
  deps: Pick<TransferDeps, 'dialog' | 'getWindow'>
): void {
  ipc.handle('assets:save', (_e, bytes: Uint8Array, name: string) => assets.save(bytes, name))
  ipc.handle('assets:saveFile', (_e, bytes: Uint8Array, name: string) =>
    assets.saveFile(bytes, name)
  )
  ipc.handle('assets:download', async (_e, src: string, fileName: string) => {
    const bytes = await assets.read(src)
    if (!bytes) throw new Error('Fichier introuvable.')
    const options = {
      title: 'Enregistrer le fichier',
      defaultPath: safeName(fileName) || 'fichier'
    }
    const win = deps.getWindow()
    const result = win
      ? await deps.dialog.showSaveDialog(win, options)
      : await deps.dialog.showSaveDialog(options)
    if (!result.canceled && result.filePath) await writeFile(result.filePath, bytes)
  })
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
      const archive = await buildMarkdownArchive(repo, dbs, assets, pageId)
      const md = archive.fileName.endsWith('.md')
      const options = {
        title: 'Exporter en Markdown',
        defaultPath: archive.fileName,
        filters: md
          ? [{ name: 'Markdown', extensions: ['md'] }]
          : [{ name: 'Archive ZIP', extensions: ['zip'] }]
      }
      const win = deps.getWindow()
      const result = win
        ? await deps.dialog.showSaveDialog(win, options)
        : await deps.dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, archive.bytes)
      return { path: result.filePath, pages: archive.pages }
    }
  )
}
