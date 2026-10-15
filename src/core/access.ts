import { ACCESS_LEVELS, type AccessLevel, type PageAccess, type PageShare } from '../shared/types'

/** Workspace roles; guests only see the pages shared with them. */
export type MemberRole = 'admin' | 'editor' | 'reader' | 'guest'

export interface Viewer {
  id: string
  role: MemberRole
}

export interface AccessNode {
  id: string
  parentId: string | null
  access: PageAccess
  createdBy: string | null
}

export interface ShareRow extends PageShare {
  pageId: string
}

const max = (a: AccessLevel, b: AccessLevel): AccessLevel =>
  ACCESS_LEVELS.indexOf(a) >= ACCESS_LEVELS.indexOf(b) ? a : b
const min = (a: AccessLevel, b: AccessLevel): AccessLevel =>
  ACCESS_LEVELS.indexOf(a) <= ACCESS_LEVELS.indexOf(b) ? a : b

/** What a role gets on pages open to the whole workspace. */
const WORKSPACE_LEVEL: Record<MemberRole, AccessLevel> = {
  admin: 'full',
  editor: 'full',
  reader: 'comment',
  guest: 'none'
}
/** The most a role can ever do, whatever is shared with it. */
const ROLE_CAP: Record<MemberRole, AccessLevel> = {
  admin: 'full',
  editor: 'full',
  reader: 'comment',
  guest: 'edit'
}

/**
 * Level of `viewer` on every page. A page follows its nearest ancestor that
 * sets an access ('workspace' for the top level); a restricted page is open
 * to its creator only. Pages shared with the viewer, and their sub-pages, add
 * the shared level on top.
 */
export function resolveLevels(
  nodes: AccessNode[],
  shares: ShareRow[],
  viewer: Viewer
): Map<string, AccessLevel> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const shared = new Map<string, AccessLevel>()
  for (const s of shares) if (s.userId === viewer.id) shared.set(s.pageId, s.level)

  const base = new Map<string, AccessLevel>()
  const fromShares = new Map<string, AccessLevel>()
  const resolve = (id: string, depth = 0): [AccessLevel, AccessLevel] => {
    const known = base.get(id)
    if (known !== undefined) return [known, fromShares.get(id)!]
    const node = byId.get(id)
    // A broken tree (missing parent, loop) grants nothing more.
    if (!node || depth > 1000) return ['none', 'none']
    const parent =
      node.parentId && byId.has(node.parentId) ? resolve(node.parentId, depth + 1) : null
    let own: AccessLevel
    if (node.access === 'workspace' || (node.access === 'inherit' && !parent))
      own = WORKSPACE_LEVEL[viewer.role]
    else if (node.access === 'restricted') own = node.createdBy === viewer.id ? 'full' : 'none'
    else own = parent![0]
    const share = max(parent?.[1] ?? 'none', shared.get(id) ?? 'none')
    base.set(id, own)
    fromShares.set(id, share)
    return [own, share]
  }

  const out = new Map<string, AccessLevel>()
  for (const n of nodes) {
    const [own, share] = resolve(n.id)
    out.set(n.id, min(max(own, share), ROLE_CAP[viewer.role]))
  }
  return out
}
