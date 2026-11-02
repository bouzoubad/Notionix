import type { SessionUser } from '../shared/collab'
import { t } from '../shared/i18n'
import type {
  Comment,
  InboxItem,
  NotionixApi,
  PageId,
  PageSummary,
  Person,
  SearchHit
} from '../shared/types'
import { OfflineQueue, type QueuedChange } from './offlineQueue'
import { pendingParents } from './sendToServer'

type Side = 'local' | 'remote'

export interface CombinedApi extends NotionixApi {
  /** Whether a page is on this computer only (written without network, not sent yet) */
  isLocal(id: PageId): boolean
  /** Changes of the server's pages made without network, sent when it is back */
  queue: OfflineQueue
  /** Sends the queued changes (in order) */
  flushQueue(): Promise<void>
}

/** Alternates the hits of both sides, so the best of each come first. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

/**
 * The desktop app linked to a server: one set of operations over two places.
 * Every page is on the server, private ones included (visible to their owner
 * only); this computer keeps what is needed without network. Without
 * network, a new page is written on this computer (under the server page it
 * was made in, once sent) and sent with the same id when the network is back;
 * renaming, moving or trashing a server page waits in `queue`. Each operation
 * goes to the side of the page it is about; lists and searches gather both.
 */
export function combineApis(
  local: NotionixApi,
  remote: NotionixApi,
  context: {
    currentPage: () => PageId | null
    user: SessionUser
    /** Whether an error means the server is out of reach */
    offline?: (error: unknown) => boolean
    queue?: OfflineQueue
  }
): CombinedApi {
  const offline = context.offline ?? (() => false)
  const queue = context.queue ?? new OfflineQueue('notionix-queue', null)
  /** The server's pages as last listed, for what a queued change returns */
  const lastTeam = new Map<PageId, PageSummary>()
  const send = async (c: QueuedChange): Promise<void> => {
    if (c.kind === 'update') await remote.pages.update(c.id, c.patch)
    else if (c.kind === 'move') await remote.pages.move(c.id, c.parentId, c.index)
    else await remote.pages.trash(c.id)
  }
  const flushQueue = async (): Promise<void> => {
    const report = await queue.flush(send, offline)
    for (const d of report.dropped) console.warn('Change refused by the server:', d)
  }
  /**
   * A change of a server page: sent now, or queued without network (and
   * behind changes already waiting, to keep their order).
   */
  const queued = async <T>(
    change: QueuedChange,
    call: () => Promise<T>,
    shown: () => T
  ): Promise<T> => {
    if (queue.pending) {
      queue.push(change)
      void flushQueue()
      return shown()
    }
    try {
      return await call()
    } catch (e) {
      if (!offline(e)) throw e
      queue.push(change)
      return shown()
    }
  }
  /**
   * A new page without network: written here (top level), and placed under
   * `parentId` on the server once sent.
   */
  const createHere = async <T extends { id: PageId }>(
    parentId: PageId | null,
    create: () => Promise<T>
  ): Promise<T> => {
    const page = await create()
    if (parentId) pendingParents.set(page.id, parentId)
    return kept('local', page)
  }
  const localIds = new Set<PageId>()
  /** Comments and discussions (by id), notifications (by id), saved versions (by id) */
  const commentSide = new Map<string, Side>()
  const inboxSide = new Map<string, Side>()
  const versionSide = new Map<number, Side>()

  const sideOf = (id: PageId | null | undefined): Side =>
    id && localIds.has(id) ? 'local' : 'remote'
  const of = (side: Side): NotionixApi => (side === 'local' ? local : remote)
  const byPage = (id: PageId): NotionixApi => of(sideOf(id))
  const kept = <T extends { id: PageId }>(side: Side, page: T): T => {
    if (side === 'local') localIds.add(page.id)
    return page
  }
  const newPageSide = (parentId: PageId | null): Side => (parentId ? sideOf(parentId) : 'remote')
  const noteComments = (side: Side, comments: Comment[]): Comment[] => {
    for (const c of comments) {
      commentSide.set(c.id, side)
      commentSide.set(c.threadId, side)
    }
    return comments
  }
  /** The server out of reach and nothing kept from it: only this computer's side answers. */
  const orNone = <T>(promise: Promise<T[]>): Promise<T[]> => promise.catch(() => [])

  /** The person's own entry for this computer's pages, whose author is 'local'. */
  const localPerson: Person = {
    id: 'local',
    name: context.user.name || context.user.email,
    email: context.user.email,
    // Listed for its name only: never offered in mentions or shares.
    disabled: true
  }

  return {
    isLocal: (id) => localIds.has(id),
    queue,
    flushQueue,
    pages: {
      list: async () => {
        const [mine, team] = await Promise.all([
          local.pages.list(),
          orNone(remote.pages.list()).then((list) => queue.overlayList(list))
        ])
        localIds.clear()
        for (const p of mine) localIds.add(p.id)
        lastTeam.clear()
        for (const p of team) lastTeam.set(p.id, p)
        return [...team, ...mine]
      },
      get: async (id) =>
        sideOf(id) === 'local'
          ? local.pages.get(id)
          : queue.overlayPage(await remote.pages.get(id)),
      create: async (parentId, access, kind) => {
        const side = newPageSide(parentId)
        if (side === 'local') return kept(side, await local.pages.create(parentId, access, kind))
        try {
          return kept(side, await remote.pages.create(parentId, access, kind))
        } catch (e) {
          if (!offline(e) || kind === 'synced') throw e
          return createHere(parentId, () => local.pages.create(null, 'restricted'))
        }
      },
      createWith: async (parentId, init) => {
        const side = newPageSide(parentId)
        if (side === 'local') return kept(side, await local.pages.createWith(parentId, init))
        try {
          return kept(side, await remote.pages.createWith(parentId, init))
        } catch (e) {
          if (!offline(e)) throw e
          return createHere(parentId, () =>
            local.pages.createWith(null, { ...init, access: 'restricted' })
          )
        }
      },
      update: (id, patch) =>
        sideOf(id) === 'local'
          ? local.pages.update(id, patch)
          : queued(
              { kind: 'update', id, patch, at: Date.now() },
              () => remote.pages.update(id, patch),
              () => {
                const before = lastTeam.get(id)
                if (!before) throw new Error(t('Serveur injoignable : vous êtes hors ligne.'))
                return queue.overlayPage(before)!
              }
            ),
      move: async (id, parentId, index) => {
        if (parentId && sideOf(parentId) !== sideOf(id))
          throw new Error(
            t(
              'Cette page a été écrite sans réseau : elle sera envoyée sur le serveur au retour du réseau, vous pourrez la déplacer ensuite.'
            )
          )
        if (sideOf(id) === 'local') return local.pages.move(id, parentId, index)
        return queued(
          { kind: 'move', id, parentId, index, at: Date.now() },
          () => remote.pages.move(id, parentId, index),
          () => undefined
        )
      },
      trash: (id) =>
        sideOf(id) === 'local'
          ? local.pages.trash(id)
          : queued(
              { kind: 'trash', id, at: Date.now() },
              () => remote.pages.trash(id),
              () => undefined
            ),
      restore: (id) => byPage(id).pages.restore(id),
      deleteForever: (id) => byPage(id).pages.deleteForever(id),
      duplicate: async (id) => kept(sideOf(id), await byPage(id).pages.duplicate(id)),
      search: async (query, filters) => {
        const [team, mine] = await Promise.all([
          orNone(remote.pages.search(query, filters)),
          local.pages.search(query, filters)
        ])
        return interleave<SearchHit>(team, mine)
      },
      setAccess: (id, access) => byPage(id).pages.setAccess(id, access),
      setSpace: (id, flag) => byPage(id).pages.setSpace(id, flag),
      shares: (id) => byPage(id).pages.shares(id),
      setShare: (id, userId, level) => byPage(id).pages.setShare(id, userId, level),
      backlinks: (id) => byPage(id).pages.backlinks(id),
      publish: (id, published) => byPage(id).pages.publish(id, published),
      versions: async (id) => {
        const side = sideOf(id)
        const versions = await of(side).pages.versions(id)
        versionSide.clear()
        for (const v of versions) versionSide.set(v.id, side)
        return versions
      },
      view: (id) => byPage(id).pages.view(id),
      stats: (id) => byPage(id).pages.stats(id),
      version: (versionId) => of(versionSide.get(versionId) ?? 'remote').pages.version(versionId),
      restoreVersion: (id, versionId) => byPage(id).pages.restoreVersion(id, versionId)
    },
    people: {
      list: async () => {
        try {
          return [...(await remote.people.list()), localPerson]
        } catch {
          return [localPerson]
        }
      },
      groups: () => orNone(remote.people.groups())
    },
    comments: {
      list: async (pageId) => {
        const side = sideOf(pageId)
        return noteComments(side, await of(side).comments.list(pageId))
      },
      add: async (pageId, input) => {
        const side = sideOf(pageId)
        return noteComments(side, [await of(side).comments.add(pageId, input)])[0]
      },
      update: (id, body, mentions) =>
        of(commentSide.get(id) ?? 'remote').comments.update(id, body, mentions),
      remove: (id) => of(commentSide.get(id) ?? 'remote').comments.remove(id),
      resolve: (threadId, resolved) =>
        of(commentSide.get(threadId) ?? 'remote').comments.resolve(threadId, resolved)
    },
    inbox: {
      list: async () => {
        const [mine, team] = await Promise.all([local.inbox.list(), orNone(remote.inbox.list())])
        for (const i of mine) inboxSide.set(i.id, 'local')
        for (const i of team) inboxSide.set(i.id, 'remote')
        return [...mine, ...team].sort((a: InboxItem, b: InboxItem) => b.createdAt - a.createdAt)
      },
      markRead: async (ids) => {
        if (ids === null) {
          await Promise.all([local.inbox.markRead(null), remote.inbox.markRead(null)])
          return
        }
        const mine = ids.filter((id) => inboxSide.get(id) === 'local')
        const team = ids.filter((id) => inboxSide.get(id) !== 'local')
        await Promise.all([
          mine.length ? local.inbox.markRead(mine) : undefined,
          team.length ? remote.inbox.markRead(team) : undefined
        ])
      },
      activity: async () => {
        const [mine, team] = await Promise.all([
          local.inbox.activity(),
          orNone(remote.inbox.activity())
        ])
        return [...mine, ...team].sort((a, b) => b.at - a.at)
      },
      onChange: (listener) => {
        const stops = [local.inbox.onChange(listener), remote.inbox.onChange(listener)]
        return () => stops.forEach((stop) => stop())
      }
    },
    reminders: {
      set: (pageId, key, at, text) => byPage(pageId).reminders.set(pageId, key, at, text)
    },
    databases: {
      create: async (parentId) => {
        const side = parentId ? sideOf(parentId) : 'remote'
        if (side === 'local') return kept(side, await local.databases.create(parentId))
        try {
          return kept(side, await remote.databases.create(parentId))
        } catch (e) {
          if (!offline(e)) throw e
          return createHere(parentId, () => local.databases.create(null))
        }
      },
      get: (id) => byPage(id).databases.get(id),
      getRow: (rowId) => byPage(rowId).databases.getRow(rowId),
      updateSchema: (id, schema, base) => byPage(id).databases.updateSchema(id, schema, base),
      linkRelation: (id, propertyId) => byPage(id).databases.linkRelation(id, propertyId),
      enableNesting: (id, kind) => byPage(id).databases.enableNesting(id, kind),
      importCsv: (id, csv) => byPage(id).databases.importCsv(id, csv),
      recurrences: (id) => byPage(id).databases.recurrences(id),
      setRecurrence: (id, templateId, rule) =>
        byPage(id).databases.setRecurrence(id, templateId, rule),
      onChange: (listener) => {
        const stops = [local.databases.onChange(listener), remote.databases.onChange(listener)]
        return () => stops.forEach((stop) => stop())
      },
      createRow: async (databaseId, init) => {
        const side = sideOf(databaseId)
        return kept(side, await of(side).databases.createRow(databaseId, init))
      },
      updateRow: (rowId, values) => byPage(rowId).databases.updateRow(rowId, values),
      setTemplate: (rowId, flag) => byPage(rowId).databases.setTemplate(rowId, flag),
      changePropertyType: (id, propertyId, type) =>
        byPage(id).databases.changePropertyType(id, propertyId, type)
    },
    assets: {
      // A file goes with the page it is added to (sent with it when written without network).
      save: (bytes, name) => of(sideOf(context.currentPage())).assets.save(bytes, name),
      saveFile: (bytes, name) => of(sideOf(context.currentPage())).assets.saveFile(bytes, name),
      // The main process fetches the server's files it does not have yet.
      download: (src, fileName) => local.assets.download(src, fileName)
    },
    commands: local.commands,
    transfer: {
      // Imported pages arrive on this computer, then go to the server as private pages.
      importNotion: () => local.transfer.importNotion(),
      exportMarkdown: (pageId) => (pageId ? byPage(pageId) : local).transfer.exportMarkdown(pageId),
      exportHtml: (pageId) => (pageId ? byPage(pageId) : local).transfer.exportHtml(pageId),
      // The page shown is printed by the app, wherever it is kept.
      exportPdf: (pageId) => local.transfer.exportPdf(pageId)
    }
  }
}
