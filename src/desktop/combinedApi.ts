import type { SessionUser } from '../shared/collab'
import { t } from '../shared/i18n'
import type {
  Comment,
  InboxItem,
  NotionixApi,
  PageAccess,
  PageId,
  Person,
  SearchHit
} from '../shared/types'

type Side = 'local' | 'remote'

export interface CombinedApi extends NotionixApi {
  /** Whether a page is kept on this computer only */
  isLocal(id: PageId): boolean
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
 * Private pages (and everything under them) stay in this computer's database;
 * the team's pages are on the server. Each operation goes to the side of the
 * page it is about; lists and searches gather both.
 *
 * A new top-level page is private (here) when created with the 'restricted'
 * access, the team's otherwise; a sub-page goes with its parent. Files go
 * with the page open when they are added.
 */
export function combineApis(
  local: NotionixApi,
  remote: NotionixApi,
  context: { currentPage: () => PageId | null; user: SessionUser }
): CombinedApi {
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
  const newPageSide = (parentId: PageId | null, access: PageAccess | undefined): Side =>
    parentId ? sideOf(parentId) : access === 'restricted' ? 'local' : 'remote'
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
    pages: {
      list: async () => {
        const [mine, team] = await Promise.all([local.pages.list(), orNone(remote.pages.list())])
        localIds.clear()
        for (const p of mine) localIds.add(p.id)
        return [...team, ...mine]
      },
      get: (id) => byPage(id).pages.get(id),
      create: async (parentId, access, kind) => {
        const side = newPageSide(parentId, access)
        return kept(side, await of(side).pages.create(parentId, access, kind))
      },
      createWith: async (parentId, init) => {
        const side = newPageSide(parentId, init.access)
        return kept(side, await of(side).pages.createWith(parentId, init))
      },
      update: (id, patch) => byPage(id).pages.update(id, patch),
      move: async (id, parentId, index) => {
        if (parentId && sideOf(parentId) !== sideOf(id))
          throw new Error(
            t(
              'Une page ne peut pas encore passer de cet ordinateur au serveur, ni du serveur à cet ordinateur.'
            )
          )
        return byPage(id).pages.move(id, parentId, index)
      },
      trash: (id) => byPage(id).pages.trash(id),
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
        return kept(side, await of(side).databases.create(parentId))
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
      // A file added to a private page never leaves this computer.
      save: (bytes, name) => of(sideOf(context.currentPage())).assets.save(bytes, name),
      saveFile: (bytes, name) => of(sideOf(context.currentPage())).assets.saveFile(bytes, name),
      // The main process fetches the server's files it does not have yet.
      download: (src, fileName) => local.assets.download(src, fileName)
    },
    commands: local.commands,
    transfer: {
      // Imported pages arrive private, on this computer.
      importNotion: () => local.transfer.importNotion(),
      exportMarkdown: (pageId) => (pageId ? byPage(pageId) : local).transfer.exportMarkdown(pageId),
      exportHtml: (pageId) => (pageId ? byPage(pageId) : local).transfer.exportHtml(pageId),
      // The page shown is printed by the app, wherever it is kept.
      exportPdf: (pageId) => local.transfer.exportPdf(pageId)
    }
  }
}
