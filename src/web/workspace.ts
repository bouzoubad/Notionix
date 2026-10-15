import { MAIN_WORKSPACE } from '../shared/collab'

const KEY = 'notionix.workspace'

/** The workspace this browser works in; every request names it. */
export function currentWorkspace(): string {
  try {
    return localStorage.getItem(KEY) || MAIN_WORKSPACE
  } catch {
    return MAIN_WORKSPACE
  }
}

/** Opens another workspace, on one of its pages or not: the app starts again on it. */
export function switchWorkspace(id: string, pageId: string | null = null): void {
  try {
    localStorage.setItem(KEY, id)
    // The page open and the recent pages belong to the previous workspace.
    localStorage.removeItem('currentId')
  } catch {
    // Without storage the main workspace stays.
  }
  location.assign(pageId ? `/#/page/${encodeURIComponent(pageId)}` : '/')
}
