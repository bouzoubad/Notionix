import { parseAppearance, type Appearance } from '../shared/appearance'
import { json } from './http'

/** The person's colours (Apparence), kept in their account on the server. */
export const accountAppearance = {
  load: async (): Promise<Appearance | null> => {
    const { appearance } = await json<{ appearance: unknown }>('/api/me/appearance')
    return appearance ? parseAppearance(appearance) : null
  },
  save: async (appearance: Appearance): Promise<void> => {
    await json('/api/me/appearance', { method: 'PUT', json: { appearance } })
  }
}
