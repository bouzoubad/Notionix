import { describe, expect, it } from 'vitest'
import { loadEmojis, searchEmojis } from '../src/renderer/src/emoji'
import { parseUpdateReport } from '../src/shared/clients'

describe('emojis', () => {
  it('are found by French and English names, keywords and shortcodes', async () => {
    const all = await loadEmojis()
    expect(all.length).toBeGreaterThan(1500)
    // Skin tones (components) are not offered on their own.
    expect(all.some((e) => e.group === 2)).toBe(false)
    const first = (q: string): string => searchEmojis(all, q, 5)[0]?.emoji
    expect(first('rocket')).toBe('🚀')
    expect(first('fusée')).toBe('🚀')
    expect(first('fusee')).toBe('🚀')
    expect(first('coeur')).toBe('❤️')
    expect(searchEmojis(all, 'coeur', 10).map((e) => e.emoji)).toContain('💔')
    expect(first(':heart:')).toBe('❤️')
    expect(searchEmojis(all, 'xqzwv')).toEqual([])
    expect(searchEmojis(all, '', 3)).toHaveLength(3)
  })
})

describe('desktop app update reports', () => {
  it('keep known statuses and short, safe values', () => {
    expect(parseUpdateReport({ status: 'ready', version: '1.2.1' }, 5)).toEqual({
      status: 'ready',
      version: '1.2.1',
      at: 5
    })
    expect(parseUpdateReport({ status: 'downloading', version: 'x; rm', percent: 140 }, 5)).toEqual(
      { status: 'downloading', percent: 100, at: 5 }
    )
    expect(
      parseUpdateReport({ status: 'error', message: 'e'.repeat(500) }, 5)?.message
    ).toHaveLength(300)
    expect(parseUpdateReport({ status: 'pirate' }, 5)).toBeNull()
    expect(parseUpdateReport(null, 5)).toBeNull()
  })
})

describe('skin tones and pictograms', () => {
  it('offer each emoji with tones in the tone chosen', async () => {
    const { inTone } = await import('../src/renderer/src/emoji')
    const all = await loadEmojis()
    const thumb = all.find((e) => e.emoji.replace(/\uFE0F/g, '') === '👍')!
    expect(thumb.tones).toEqual(['👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿'])
    expect(inTone(thumb, 3)).toBe('👍🏽')
    expect(inTone(thumb, 0)).toBe(thumb.emoji)
    // Two people: both of the same tone.
    expect(all.some((e) => e.tones?.[0] === '🤝🏻')).toBe(true)
    // No tone: the emoji itself.
    const rocket = all.find((e) => e.emoji === '🚀')!
    expect(inTone(rocket, 4)).toBe('🚀')
  })

  it('reads and finds pictograms (Lucide)', async () => {
    const { loadPictograms, parsePictogram, pictogramIcon, searchPictograms } =
      await import('../src/renderer/src/pictograms')
    expect(parsePictogram(pictogramIcon('calendar-days', 'blue'))).toEqual({
      name: 'calendar-days',
      color: 'blue'
    })
    expect(parsePictogram('icon:rocket:violet')).toEqual({ name: 'rocket', color: 'default' })
    expect(parsePictogram('icon:../x')).toBeNull()
    const all = await loadPictograms()
    expect(all.length).toBeGreaterThan(1000)
    expect(searchPictograms(all, 'rocket')[0].name).toBe('rocket')
    expect(searchPictograms(all, 'calendar days').map((p) => p.name)).toContain('calendar-days')
  })
})
