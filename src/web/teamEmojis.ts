import type { CustomEmoji } from '../shared/collab'
import { json, request } from './http'

/** The team's own emojis, kept by the server. */
export const teamEmojis = {
  list: async (): Promise<CustomEmoji[]> =>
    (await json<{ emojis: CustomEmoji[] }>('/api/emojis')).emojis,
  add: async (name: string, image: File): Promise<CustomEmoji> => {
    const res = await request(`/api/emojis?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: new Blob([new Uint8Array(await image.arrayBuffer())]),
      type: 'application/octet-stream'
    })
    return ((await res.json()) as { emoji: CustomEmoji }).emoji
  },
  remove: async (name: string): Promise<void> => {
    await request(`/api/emojis/${encodeURIComponent(name)}`, { method: 'DELETE' })
  }
}
