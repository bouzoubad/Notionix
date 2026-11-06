import type { CustomEmoji, SessionUser, WorkspaceInfo } from '../shared/collab'
import { assetNamesIn } from '../shared/assets'
import { OFFLINE_HEADER, type DesktopServer } from '../shared/desktop'
import type { PageId, PageSummary } from '../shared/types'
import type {
  OfflineCopies,
  OfflineStatus,
  ServerSession,
  SharedPage
} from '../renderer/src/platform'
import { request, ServerError } from '../web/http'
import { currentWorkspace } from '../web/workspace'
import { forgetDocuments } from './offline'
import {
  alwaysKept,
  availabilityOf,
  childrenByParent,
  parseKept,
  parseSettings,
  planWorkspace,
  versionOf,
  wantedPages,
  type Availability,
  type KeptPages,
  type OfflineSettings
} from './offlinePlan'

/** The server out of reach: its answer came from what was kept, or there was none. */
class Unreachable extends Error {}

/** Answers that let the app start in a workspace without network: asked again this often. */
const START_ANSWERS_EVERY = 15 * 60_000
/** Operations the app makes when it starts in a workspace. */
const START_CALLS = ['people.list', 'people.groups', 'pages.elsewhere', 'inbox.list']
/** Pause between two pages: gentle with the server, and the app stays smooth. */
const PAUSE = 50
/** Longest wait for a page's shared document. */
const DOCUMENT_TIMEOUT = 20_000
/** The list of kept pages is written at most this often while a pass runs. */
const SAVE_EVERY = 2_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export interface OfflineSyncOptions {
  server: string
  user: SessionUser
  bridge: DesktopServer
  storage: Storage | null
  /** The open workspace's pages, as the app shows them */
  pages: () => PageSummary[]
  /** The pages opened lately (always kept) */
  recent: () => PageId[]
  /** Whether the real-time connection to the server is up */
  connected: () => boolean
  /** Whether a page was written on this computer and not sent yet */
  isLocal: (id: PageId) => boolean
  session: () => ServerSession | null
}

/**
 * Keeps the team's pages on this computer for working without network: the
 * pages of every workspace (unless set to "online only"), each with what the
 * server says of it, its shared document and its files. A pass fetches only
 * what changed since the last one, page after page, and stops as soon as the
 * server is out of reach.
 */
export class OfflineSync {
  private settings: OfflineSettings
  private kept: KeptPages
  private state: OfflineStatus
  private readonly listeners = new Set<() => void>()
  /** Each workspace's pages, from the last pass (or what was kept of them) */
  private readonly lists = new Map<string, PageSummary[]>()
  /** The person's workspaces, from the last pass */
  private workspaceList: WorkspaceInfo[] = []
  private readonly startAnswersAt = new Map<string, number>()
  private running: Promise<void> | null = null
  private again = false
  private stopped = false
  private savedAt = 0
  private readonly keys: { settings: string; kept: string; at: string }

  constructor(private readonly o: OfflineSyncOptions) {
    const id = `${o.server}|${o.user.id}`
    this.keys = {
      settings: `notionix-offline-settings:${id}`,
      kept: `notionix-offline-kept:${id}`,
      at: `notionix-offline-at:${id}`
    }
    this.settings = parseSettings(this.read(this.keys.settings))
    this.kept = parseKept(this.read(this.keys.kept))
    const at = Number(this.read(this.keys.at))
    this.state = { running: false, done: 0, total: 0, at: at > 0 ? at : null }
    // The list of the pages kept before 1.6: those are all kept again by the first pass.
    this.remove('notionix-kept-at-2')
  }

  status = (): OfflineStatus => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The workspaces of the person (from the last pass, or what was kept of them). */
  async workspaces(): Promise<WorkspaceInfo[]> {
    if (this.workspaceList.length) return this.workspaceList
    try {
      const res = await request('/api/workspaces')
      const { workspaces } = (await res.json()) as { workspaces: WorkspaceInfo[] }
      this.workspaceList = workspaces.filter((w) => !w.archived)
    } catch {
      // None known yet.
    }
    return this.workspaceList
  }

  workspaceChoice(workspace: string): Availability {
    return this.settings.workspaces[workspace] ?? 'keep'
  }

  /** How many pages of a workspace are kept here, the room they take, and the pages set apart. */
  usage(workspace: string): { pages: number; bytes: number; ownChoices: number } {
    const kept = Object.values(this.kept[workspace] ?? {})
    const ids = new Set((this.lists.get(workspace) ?? []).map((p) => p.id))
    return {
      pages: kept.length,
      bytes: kept.reduce((n, k) => n + k.bytes, 0),
      ownChoices: Object.keys(this.settings.pages).filter((id) => ids.has(id)).length
    }
  }

  setWorkspace(workspace: string, value: Availability): void {
    if (value === 'keep') delete this.settings.workspaces[workspace]
    else this.settings.workspaces[workspace] = value
    this.saveSettings()
    void this.apply(workspace)
  }

  setPage(pageId: PageId, value: Availability | null): void {
    if (value === null) delete this.settings.pages[pageId]
    else this.settings.pages[pageId] = value
    this.saveSettings()
    void this.apply(currentWorkspace())
  }

  /** Whether a page of the open workspace is kept here, why, and what it would be without its own choice. */
  availability(pageId: PageId): ReturnType<OfflineCopies['availability']> {
    const pages = this.o.pages()
    const workspace = currentWorkspace()
    const byId = new Map(pages.map((p) => [p.id, p]))
    const own = availabilityOf(pageId, byId, workspace, this.settings)
    const parent = byId.get(pageId)?.parentId ?? null
    const inherited =
      own.source !== 'page'
        ? own.value
        : parent !== null
          ? availabilityOf(parent, byId, workspace, this.settings).value
          : this.workspaceChoice(workspace)
    if (alwaysKept(pages, this.o.user.id, this.o.recent()).has(pageId))
      return { value: 'keep', source: 'always', inherited }
    return { value: own.value, source: own.source, inherited }
  }

  keptAt(pageId: PageId): number | null {
    for (const pages of Object.values(this.kept)) if (pages[pageId]) return pages[pageId].at
    return null
  }

  /** What the app's pages see of it. */
  copies(Dialog: OfflineCopies['Dialog']): OfflineCopies {
    return {
      status: this.status,
      subscribe: this.subscribe,
      availability: (id) => this.availability(id),
      setPage: (id, value) => this.setPage(id, value),
      keptAt: (id) => this.keptAt(id),
      Dialog
    }
  }

  /**
   * Brings the copies up to date (a pass runs at a time; asked meanwhile, one
   * more follows it).
   */
  run(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        try {
          await this.pass()
        } catch (e) {
          if (!(e instanceof Unreachable)) console.warn('Offline copies:', e)
          break
        }
      } while (this.again && !this.stopped && this.o.connected())
    })().finally(() => {
      this.running = null
      this.save(true)
      this.set({ running: false, done: 0, total: 0 })
    })
    return this.running
  }

  /** Signing out: what was kept and chosen here is forgotten. */
  forget(): void {
    this.stopped = true
    for (const key of Object.values(this.keys)) this.remove(key)
  }

  private async pass(): Promise<void> {
    if (this.stopped || !this.o.connected()) return
    const { workspaces } = await this.get<{ workspaces: WorkspaceInfo[] }>('/api/workspaces')
    this.workspaceList = workspaces.filter((w) => !w.archived)
    const current = currentWorkspace()
    const order = [...this.workspaceList].sort(
      (a, b) => Number(b.id === current) - Number(a.id === current)
    )
    const me = this.o.user.id
    const recent = this.o.recent()
    const now = Date.now()
    const plans: { workspace: string; list: PageSummary[]; stale: PageSummary[] }[] = []
    for (const w of order) {
      const list = await this.call<PageSummary[]>(w.id, 'pages.list')
      this.lists.set(w.id, list)
      if (now - (this.startAnswersAt.get(w.id) ?? 0) > START_ANSWERS_EVERY) {
        for (const method of START_CALLS) await this.optional(this.call(w.id, method))
        this.startAnswersAt.set(w.id, now)
      }
      // Pages written on this computer are not the server's yet.
      const server = list.filter((p) => !this.o.isLocal(p.id))
      const always = alwaysKept(server, me, recent)
      const wanted = wantedPages(server, w.id, this.settings, always)
      const plan = planWorkspace(server, wanted, this.kept[w.id] ?? {}, always)
      await this.evict(w.id, plan.evicted)
      plans.push({ workspace: w.id, list: server, stale: plan.stale })
    }
    // A workspace no longer open to the person (or archived): its copies go.
    for (const workspace of Object.keys(this.kept))
      if (!this.workspaceList.some((w) => w.id === workspace)) {
        await this.evict(workspace, Object.keys(this.kept[workspace]))
        delete this.kept[workspace]
      }
    const total = plans.reduce((n, p) => n + p.stale.length, 0)
    this.set({ running: total > 0, done: 0, total })
    for (const { workspace, list, stale } of plans) {
      const byId = new Map(list.map((p) => [p.id, p]))
      const children = childrenByParent(list)
      for (const page of stale) {
        if (this.stopped || !this.o.connected()) throw new Unreachable()
        await this.keepPage(workspace, page, byId, children)
        this.set({ done: this.state.done + 1 })
        await sleep(PAUSE)
      }
    }
    // The team's emojis, shown in the pages.
    const emojis = await this.optional(this.get<CustomEmoji[]>('/api/emojis'))
    if (emojis) await this.o.bridge.keepFiles([...assetNamesIn(JSON.stringify(emojis))])
    this.state = { ...this.state, at: Date.now() }
    this.save(true)
  }

  /** Keeps one page: what the server says of it, its shared document and its files. */
  private async keepPage(
    workspace: string,
    page: PageSummary,
    byId: ReadonlyMap<PageId, PageSummary>,
    children: ReadonlyMap<PageId, PageSummary[]>
  ): Promise<void> {
    const texts: string[] = [page.icon ?? '', page.cover ?? '']
    const keep = async (method: string): Promise<boolean> => {
      const answer = await this.optional(this.call(workspace, method, page.id))
      if (answer === undefined) return false
      texts.push(JSON.stringify(answer))
      return true
    }
    // Gone meanwhile (deleted, no longer shared): left for the next pass to drop.
    if (!(await keep('pages.get'))) return
    if (page.kind === 'database') await keep('databases.get')
    else {
      await keep('pages.backlinks')
      await keep('comments.list')
      const parent = page.parentId === null ? null : byId.get(page.parentId)
      if (parent?.kind === 'database') await keep('databases.getRow')
      // Not stored this time (the server did not send it): tried again next time.
      if (!(await this.keepDocument(page.id))) return
    }
    const names = new Set<string>()
    for (const text of texts) assetNamesIn(text, names)
    const sizes = names.size ? await this.o.bridge.keepFiles([...names]) : {}
    // A file missing because the server went out of reach: the page is kept again later.
    if (Object.keys(sizes).length < names.size && !(await this.o.bridge.probe()))
      throw new Unreachable()
    const bytes =
      texts.reduce((n, t) => n + t.length, 0) + Object.values(sizes).reduce((n, s) => n + s, 0)
    ;(this.kept[workspace] ??= {})[page.id] = {
      v: versionOf(page, children),
      at: Date.now(),
      bytes
    }
    this.save()
  }

  /** Stores the page's shared document here; false when it did not arrive. */
  private async keepDocument(pageId: PageId): Promise<boolean> {
    const session = this.o.session()
    if (!session) throw new Unreachable()
    let page: SharedPage | null = null
    try {
      page = session.openPage(pageId)
      const stored = page.stored ?? page.ready
      const arrived = await Promise.race([
        stored.then(() => true),
        sleep(DOCUMENT_TIMEOUT).then(() => false)
      ])
      // Leaves time to write what arrived.
      if (arrived) await sleep(300)
      return arrived
    } catch {
      if (!this.o.connected()) throw new Unreachable()
      return false
    } finally {
      page?.destroy()
    }
  }

  /**
   * Choices changed: the pages of the workspace no longer wanted are
   * forgotten at once (even without network), the others kept by a pass.
   */
  private async apply(workspace: string): Promise<void> {
    this.emit()
    let list = this.lists.get(workspace) ?? null
    if (!list)
      try {
        const res = await request('/api/rpc', {
          json: { method: 'pages.list', args: [] },
          workspace
        })
        list = ((await res.json()) as { result: PageSummary[] }).result
      } catch {
        list = null
      }
    if (list) {
      const server = list.filter((p) => !this.o.isLocal(p.id))
      const always = alwaysKept(server, this.o.user.id, this.o.recent())
      const wanted = wantedPages(server, workspace, this.settings, always)
      // Those kept by a pass, and those kept when they were opened.
      const ids = new Set([...Object.keys(this.kept[workspace] ?? {}), ...server.map((p) => p.id)])
      await this.evict(
        workspace,
        [...ids].filter((id) => !wanted.has(id))
      )
    }
    if (this.o.connected()) void this.run()
  }

  /** Forgets the copies of these pages: shared documents, answers, and the files only they used. */
  private async evict(workspace: string, ids: PageId[]): Promise<void> {
    if (ids.length === 0) return
    await forgetDocuments(this.o.server, this.o.user.id, ids)
    const kept = this.kept[workspace]
    if (kept) for (const id of ids) delete kept[id]
    this.save(true)
    await this.o.bridge.forgetPages(ids).catch(() => 0)
    this.emit()
  }

  /** An operation's answer from the server itself (never what was kept). */
  private async call<T>(workspace: string, method: string, ...args: unknown[]): Promise<T> {
    const { result } = await this.answer<{ result: T }>(
      request('/api/rpc', { json: { method, args }, workspace })
    )
    return result
  }

  private get<T>(path: string): Promise<T> {
    return this.answer<T>(request(path))
  }

  private async answer<T>(pending: Promise<Response>): Promise<T> {
    let res: Response
    try {
      res = await pending
    } catch (e) {
      if (e instanceof ServerError && e.status === 503) throw new Unreachable()
      throw e
    }
    if (res.headers.has(OFFLINE_HEADER)) throw new Unreachable()
    return (await res.json()) as T
  }

  /** The answer, or undefined when the server refused it (out of reach: stops the pass). */
  private async optional<T>(pending: Promise<T>): Promise<T | undefined> {
    try {
      return await pending
    } catch (e) {
      if (e instanceof Unreachable) throw e
      return undefined
    }
  }

  private set(partial: Partial<OfflineStatus>): void {
    Object.assign(this.state, partial)
    this.emit()
  }

  /** Tells the pages something changed (a new value of `status`, so that they show it again). */
  private emit(): void {
    this.state = { ...this.state }
    for (const listener of this.listeners) listener()
  }

  private save(now = false): void {
    if (!now && Date.now() - this.savedAt < SAVE_EVERY) return
    this.savedAt = Date.now()
    this.write(this.keys.kept, JSON.stringify(this.kept))
    if (this.state.at) this.write(this.keys.at, String(this.state.at))
  }

  private saveSettings(): void {
    this.write(this.keys.settings, JSON.stringify(this.settings))
  }

  private read(key: string): string | null {
    try {
      return this.o.storage?.getItem(key) ?? null
    } catch {
      return null
    }
  }

  private write(key: string, value: string): void {
    try {
      this.o.storage?.setItem(key, value)
    } catch {
      // Kept again next time.
    }
  }

  private remove(key: string): void {
    try {
      this.o.storage?.removeItem(key)
    } catch {
      // Nothing kept.
    }
  }
}
