import { isPropertyType, type PropertyType, type PropertyValue } from '../../src/shared/database'
import {
  atLeast,
  type AccessLevel,
  type ActivityKind,
  type PageAccess,
  type PageShare,
  type PageSummary,
  type Person
} from '../../src/shared/types'
import { resolveLevels } from '../../src/core/access'
import type { User } from './auth'
import type { Workspace } from './workspace'

/** A call refused because of its arguments (HTTP 400). */
export class RpcError extends Error {}
/** A call the person may not make on this page (HTTP 403). */
export class ForbiddenError extends Error {}

const id = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v))
    throw new RpcError('Identifiant invalide.')
  return v
}
const parent = (v: unknown): string | null => (v === null || v === undefined ? null : id(v))
const int = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
    throw new RpcError('Position invalide.')
  return v
}
const record = (v: unknown): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new RpcError('Valeurs invalides.')
  return v as Record<string, unknown>
}
const text = (v: unknown): string => {
  if (typeof v !== 'string') throw new RpcError('Texte attendu.')
  return v
}
const optional = <T>(v: unknown, parse: (v: unknown) => T): T | undefined =>
  v === undefined ? undefined : parse(v)
const nullableText = (v: unknown): string | null => (v === null ? null : text(v))
const propertyType = (v: unknown): PropertyType => {
  if (!isPropertyType(v)) throw new RpcError('Type de propriété inconnu.')
  return v
}
const access = (v: unknown): PageAccess => {
  if (v !== 'inherit' && v !== 'workspace' && v !== 'restricted')
    throw new RpcError('Accès inconnu.')
  return v
}
const shareLevel = (v: unknown): PageShare['level'] | null => {
  if (v === null) return null
  if (v !== 'read' && v !== 'comment' && v !== 'edit' && v !== 'full')
    throw new RpcError('Niveau de partage inconnu.')
  return v
}

/** What calls need from the real-time side. */
export interface LiveDocuments {
  /** Replaces the content of a page's shared document */
  replaceContent: (pageId: string, content: string, user: User) => Promise<void>
  /** Tells these people their inbox changed */
  notifyUsers: (userIds: string[]) => void
}

const NO_LIVE: LiveDocuments = {
  replaceContent: async () => undefined,
  notifyUsers: () => undefined
}

/** Ids of existing people, from a list sent by the client. */
const people = (ctx: CallContext, v: unknown): string[] => {
  if (v === undefined) return []
  if (!Array.isArray(v)) throw new RpcError('Liste de personnes attendue.')
  const known = new Set(ctx.members().map((m) => m.id))
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && known.has(x)))]
}

/** What a call knows about its caller. */
export class CallContext {
  private levels: Map<string, AccessLevel> | null = null

  constructor(
    readonly ws: Workspace,
    readonly user: User,
    /** Every account, disabled ones included */
    readonly members: () => User[],
    readonly live: LiveDocuments = NO_LIVE
  ) {}

  people(): Person[] {
    return this.members().map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      disabled: u.disabled
    }))
  }

  /** Active people who can at least read the page. */
  readers(pageId: string, among: Iterable<string>): string[] {
    const wanted = new Set(among)
    const pages = this.ws.pages.list()
    const shares = this.ws.pages.allShares()
    return this.members()
      .filter((m) => wanted.has(m.id) && !m.disabled)
      .filter((m) => (resolveLevels(pages, shares, m).get(pageId) ?? 'none') !== 'none')
      .map((m) => m.id)
  }

  /** Notifies the people (who can read the page) and tells their clients. */
  notify(
    userIds: Iterable<string>,
    item: Omit<Parameters<Workspace['team']['notify']>[1], 'actorId'>
  ): void {
    const targets = item.pageId ? this.readers(item.pageId, userIds) : [...userIds]
    const sent = this.ws.team.notify(targets, { ...item, actorId: this.user.id })
    if (sent.length) this.live.notifyUsers(sent)
  }

  /** Records an activity entry of the caller. */
  log(pageId: string, kind: ActivityKind, detail: string | null = null): void {
    this.ws.team.log(pageId, this.user.id, kind, detail)
  }

  /** The caller's level on every page, computed once per call (and after changes). */
  all(): Map<string, AccessLevel> {
    this.levels ??= resolveLevels(this.ws.pages.list(), this.ws.pages.allShares(), this.user)
    return this.levels
  }

  level(pageId: string): AccessLevel {
    return this.all().get(pageId) ?? 'none'
  }

  /** Throws unless the caller has at least `wanted` on the page. */
  need(pageId: string, wanted: AccessLevel): void {
    const level = this.level(pageId)
    if (level === 'none') throw new RpcError('Page introuvable.')
    if (!atLeast(level, wanted)) throw new ForbiddenError('Droits insuffisants sur cette page.')
  }

  /** Creating under a page needs editing it; at the top level, being a member who edits. */
  needParent(parentId: string | null): void {
    if (parentId !== null) this.need(parentId, 'edit')
    else if (this.user.role === 'guest' || this.user.role === 'reader')
      throw new ForbiddenError('Droits insuffisants.')
  }

  /** Levels change with the pages: computed again on the next question. */
  invalidate(): void {
    this.levels = null
  }

  /** A summary with the caller's level on it; null when the caller cannot see it. */
  visible(summary: PageSummary): PageSummary | null {
    this.invalidate()
    const level = this.level(summary.id)
    return level === 'none' ? null : { ...summary, level }
  }

  /** Keeps the pages the caller sees, with their level. */
  filter(summaries: PageSummary[]): PageSummary[] {
    return summaries.flatMap((s) => {
      const level = this.level(s.id)
      return level === 'none' ? [] : [{ ...s, level }]
    })
  }
}

interface Method {
  /** Changes the workspace: announced to every client */
  write: boolean
  run: (ctx: CallContext, args: unknown[]) => unknown
}

const read = (run: Method['run']): Method => ({ write: false, run })
const write = (run: Method['run']): Method => ({ write: true, run })

/**
 * The operations of NotionixApi the web client calls. Every argument is
 * checked, and so is the caller's level on the pages involved. Page content
 * is not among the editable fields: it is edited through the page's shared
 * document.
 */
const METHODS: Record<string, Method> = {
  'people.list': read((ctx) => ctx.people()),

  'pages.list': read((ctx) => ctx.filter(ctx.ws.pages.list())),
  'pages.get': read((ctx, [p]) => {
    ctx.need(id(p), 'read')
    const page = ctx.ws.pages.get(id(p))
    return page && { ...page, level: ctx.level(page.id) }
  }),
  'pages.create': write((ctx, [p, a]) => {
    const parentId = parent(p)
    ctx.needParent(parentId)
    // JSON turns an omitted argument into null.
    const page = ctx.ws.pages.create(parentId, a === undefined || a === null ? 'inherit' : access(a))
    ctx.log(page.id, 'created')
    ctx.invalidate()
    return { ...page, level: ctx.level(page.id) }
  }),
  'pages.update': write((ctx, [p, patch]) => {
    ctx.need(id(p), 'edit')
    const r = record(patch)
    return ctx.visible(
      ctx.ws.pages.update(id(p), {
        title: optional(r.title, text),
        icon: optional(r.icon, nullableText),
        cover: optional(r.cover, nullableText),
        favorite: optional(r.favorite, (v) => v === true),
        options: optional(r.options, record)
      })
    )
  }),
  'pages.move': write((ctx, [p, to, index]) => {
    ctx.need(id(p), 'edit')
    ctx.needParent(parent(to))
    return ctx.ws.pages.move(id(p), parent(to), int(index))
  }),
  'pages.trash': write((ctx, [p]) => {
    ctx.need(id(p), 'edit')
    ctx.log(id(p), 'trashed')
    return ctx.ws.pages.trash(id(p))
  }),
  'pages.restore': write((ctx, [p]) => {
    ctx.need(id(p), 'edit')
    return ctx.ws.pages.restore(id(p))
  }),
  'pages.deleteForever': write((ctx, [p]) => {
    ctx.need(id(p), 'full')
    return ctx.ws.pages.deleteForever(id(p))
  }),
  'pages.duplicate': write((ctx, [p]) => {
    ctx.need(id(p), 'read')
    ctx.needParent(ctx.ws.pages.summary(id(p)).parentId)
    const copy = ctx.ws.pages.duplicate(id(p))
    ctx.invalidate()
    return { ...copy, level: ctx.level(copy.id) }
  }),
  'pages.search': read((ctx, [q]) =>
    ctx.ws.pages
      .search(text(q), 50)
      .filter((hit) => ctx.level(hit.id) !== 'none')
      .slice(0, 20)
  ),
  'pages.setAccess': write((ctx, [p, a]) => {
    ctx.need(id(p), 'full')
    return ctx.visible(ctx.ws.pages.setAccess(id(p), access(a)))
  }),
  'pages.setSpace': write((ctx, [p, flag]) => {
    ctx.need(id(p), 'full')
    return ctx.visible(ctx.ws.pages.setSpace(id(p), flag === true))
  }),
  'pages.shares': read((ctx, [p]) => {
    ctx.need(id(p), 'read')
    return ctx.ws.pages.shares(id(p))
  }),
  'pages.setShare': write((ctx, [p, user, level]) => {
    ctx.need(id(p), 'full')
    const userId = id(user)
    if (!ctx.people().some((person) => person.id === userId))
      throw new RpcError('Personne inconnue.')
    const before = ctx.ws.pages.shares(id(p)).find((s) => s.userId === userId)
    const next = shareLevel(level)
    ctx.ws.pages.setShare(id(p), userId, next)
    if (next && !before) {
      ctx.log(id(p), 'shared')
      ctx.notify([userId], {
        kind: 'share',
        pageId: id(p),
        text: `${ctx.user.name} a partagé « ${ctx.ws.pages.summary(id(p)).title || 'Sans titre'} » avec vous.`
      })
    }
  }),
  'pages.versions': read((ctx, [p]) => {
    ctx.need(id(p), 'read')
    return ctx.ws.pages.versions(id(p))
  }),
  'pages.version': read((ctx, [v]) => {
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new RpcError('Version invalide.')
    const version = ctx.ws.pages.version(v)
    if (!version) return null
    ctx.need(version.pageId, 'read')
    return version
  }),
  'pages.restoreVersion': write(async (ctx, [p, v]) => {
    ctx.need(id(p), 'edit')
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new RpcError('Version invalide.')
    ctx.ws.pages.restoreVersion(id(p), v)
    ctx.log(id(p), 'restored')
    await ctx.live.replaceContent(id(p), ctx.ws.pages.get(id(p))!.content, ctx.user)
  }),
  'pages.backlinks': read((ctx, [p]) => {
    ctx.need(id(p), 'read')
    return ctx.filter(ctx.ws.pages.backlinks(id(p)))
  }),

  'comments.list': read((ctx, [p]) => {
    ctx.need(id(p), 'read')
    return ctx.ws.team.comments(id(p))
  }),
  'comments.add': write((ctx, [p, input]) => {
    ctx.need(id(p), 'comment')
    const r = record(input)
    const threadId = optional(r.threadId, id)
    const mentions = people(ctx, r.mentions)
    const comment = ctx.ws.team.addComment(id(p), ctx.user.id, {
      threadId,
      body: text(r.body),
      mentions,
      quote: optional(r.quote, nullableText) ?? null
    })
    ctx.log(id(p), 'commented', comment.body.slice(0, 140))
    const title = ctx.ws.pages.summary(id(p)).title || 'Sans titre'
    const excerpt = comment.body.length > 120 ? `${comment.body.slice(0, 120)}…` : comment.body
    // The people discussing, and the page's creator, hear about the new comment.
    const thread = ctx.ws.team.thread(comment.threadId)
    const followers = new Set(thread.map((c) => c.authorId).filter((a): a is string => !!a))
    const creator = ctx.ws.pages.summary(id(p)).createdBy
    if (creator) followers.add(creator)
    for (const m of mentions) followers.delete(m)
    ctx.notify(mentions, {
      kind: 'mention',
      pageId: id(p),
      ref: comment.threadId,
      text: `${ctx.user.name} vous a mentionné dans un commentaire sur « ${title} » : ${excerpt}`
    })
    ctx.notify(followers, {
      kind: 'comment',
      pageId: id(p),
      ref: comment.threadId,
      text: `${ctx.user.name} a commenté « ${title} » : ${excerpt}`
    })
    return comment
  }),
  'comments.update': write((ctx, [c, body, mentioned]) => {
    const comment = ctx.ws.team.comment(id(c))
    if (!comment || comment.authorId !== ctx.user.id)
      throw new ForbiddenError('Seul son auteur modifie un commentaire.')
    ctx.need(comment.pageId, 'comment')
    const mentions = people(ctx, mentioned)
    const updated = ctx.ws.team.updateComment(comment.id, text(body), mentions)
    const added = mentions.filter((m) => !comment.mentions.includes(m))
    ctx.notify(added, {
      kind: 'mention',
      pageId: comment.pageId,
      ref: comment.threadId,
      text: `${ctx.user.name} vous a mentionné dans un commentaire sur « ${ctx.ws.pages.summary(comment.pageId).title || 'Sans titre'} ».`
    })
    return updated
  }),
  'comments.remove': write((ctx, [c]) => {
    const comment = ctx.ws.team.comment(id(c))
    if (!comment) return
    if (comment.authorId !== ctx.user.id) ctx.need(comment.pageId, 'full')
    else ctx.need(comment.pageId, 'comment')
    ctx.ws.team.removeComment(comment.id)
  }),
  'comments.resolve': write((ctx, [t, flag]) => {
    const first = ctx.ws.team.thread(id(t))[0]
    if (!first) throw new RpcError('Discussion introuvable.')
    ctx.need(first.pageId, 'comment')
    ctx.ws.team.resolveThread(first.threadId, flag === true)
  }),

  'inbox.list': read((ctx) =>
    ctx.ws.team
      .inbox(ctx.user.id)
      .filter((item) => item.pageId === null || ctx.level(item.pageId) !== 'none')
  ),
  'inbox.markRead': read((ctx, [list]) => {
    const ids =
      list === null
        ? null
        : Array.isArray(list)
          ? list.map((v) => id(v))
          : (() => {
              throw new RpcError('Liste attendue.')
            })()
    ctx.ws.team.markRead(ctx.user.id, ids)
  }),
  'inbox.activity': read((ctx) =>
    ctx.ws.team
      .activity(400)
      .filter((a) => ctx.level(a.pageId) !== 'none')
      .slice(0, 150)
  ),
  'reminders.set': read((ctx, [p, key, at, label]) => {
    ctx.need(id(p), 'read')
    if (at !== null && (typeof at !== 'number' || !Number.isFinite(at)))
      throw new RpcError('Date invalide.')
    ctx.ws.team.setReminder(ctx.user.id, id(p), id(key), at as number | null, text(label))
  }),

  'databases.create': write((ctx, [p]) => {
    ctx.needParent(parent(p))
    const db = ctx.ws.databases.create(parent(p))
    ctx.log(db.id, 'created')
    return db
  }),
  'databases.get': read((ctx, [p]) => {
    ctx.need(id(p), 'read')
    return ctx.ws.databases.get(id(p))
  }),
  'databases.getRow': read((ctx, [p]) => {
    ctx.need(id(p), 'read')
    return ctx.ws.databases.getRow(id(p))
  }),
  'databases.updateSchema': write((ctx, [p, schema]) => {
    ctx.need(id(p), 'edit')
    return ctx.ws.databases.updateSchema(id(p), schema)
  }),
  'databases.createRow': write((ctx, [p, init]) => {
    ctx.need(id(p), 'edit')
    const r = init === undefined ? {} : record(init)
    return ctx.ws.databases.createRow(id(p), {
      title: optional(r.title, text),
      properties: optional(r.properties, record) as Record<string, PropertyValue> | undefined,
      templateId: optional(r.templateId, parent)
    })
  }),
  'databases.updateRow': write((ctx, [p, values]) => {
    ctx.need(id(p), 'edit')
    const row = ctx.ws.databases.updateRow(id(p), record(values))
    ctx.log(id(p), 'edited')
    return row
  }),
  'databases.setTemplate': write((ctx, [p, flag]) => {
    ctx.need(id(p), 'edit')
    return ctx.ws.databases.setTemplate(id(p), flag === true)
  }),
  'databases.changePropertyType': write((ctx, [p, property, type]) => {
    ctx.need(id(p), 'edit')
    return ctx.ws.databases.changePropertyType(id(p), text(property), propertyType(type))
  })
}

/** Operations reading page content, which must include the edits in progress. */
const READS_CONTENT = new Set([
  'pages.get',
  'pages.versions',
  'pages.restoreVersion',
  'pages.duplicate',
  'pages.search',
  'pages.backlinks',
  'databases.createRow'
])

export interface RpcCall {
  method: Method
  args: unknown[]
  readsContent: boolean
}

/** Finds a method; null for an unknown one. Access is checked when it runs. */
export function resolveCall(name: string, args: unknown): RpcCall | null {
  const method = Object.hasOwn(METHODS, name) ? METHODS[name] : undefined
  if (!method) return null
  if (!Array.isArray(args)) throw new RpcError('Arguments invalides.')
  return { method, args, readsContent: READS_CONTENT.has(name) }
}

/** Runs a call on behalf of its caller, recorded as the author of the changes. */
export function runCall(call: RpcCall, ctx: CallContext): unknown {
  return ctx.ws.pages.as(ctx.user.id, () => call.method.run(ctx, call.args))
}
