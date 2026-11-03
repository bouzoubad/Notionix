import type { CustomEmoji } from '../../shared/collab'
import { platform } from './platform'

let cached: CustomEmoji[] = []
let loading: Promise<CustomEmoji[]> | null = null

/** The team's emojis (empty without a server); asked again when `fresh`. */
export function customEmojis(fresh = false): Promise<CustomEmoji[]> {
  const source = platform().emojis
  if (!source) return Promise.resolve([])
  if (fresh || !loading)
    loading = source
      .list()
      .then((list) => (cached = list))
      .catch(() => cached)
  return loading
}

/** The ones known now (no wait). */
export const knownCustomEmojis = (): CustomEmoji[] => cached
