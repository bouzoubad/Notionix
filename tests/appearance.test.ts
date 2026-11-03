import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_KEYS,
  appearanceCss,
  DEFAULT_APPEARANCE,
  parseAppearance,
  THEMES
} from '../src/shared/appearance'

describe('appearance (colours chosen per person)', () => {
  it('keeps only known themes and #rrggbb colours', () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance({ theme: 'inconnu' }).theme).toBe('notionix')
    const parsed = parseAppearance({
      theme: 'nord',
      custom: {
        dark: { 'code-text': '#FF0000', text: 'red; } body { display: none', bg: '#12345' },
        light: { link: '#00aa00', autre: '#000000' }
      }
    })
    expect(parsed).toEqual({
      theme: 'nord',
      custom: { dark: { 'code-text': '#ff0000' }, light: { link: '#00aa00' } }
    })
  })

  it('turns the theme and the own colours into custom properties for each mode', () => {
    expect(appearanceCss(DEFAULT_APPEARANCE)).toBe('')
    const css = appearanceCss({
      theme: 'sepia',
      custom: { light: {}, dark: { 'code-text': '#ff0000' } }
    })
    expect(css).toContain(":root, :root[data-theme='light'] { --bg: #fbf6ec;")
    expect(css).toContain("@media (prefers-color-scheme: dark) { :root:not([data-theme='light'])")
    expect(css).toContain(":root[data-theme='dark'] {")
    // The own colour wins over the theme's.
    expect(css).toContain('--code-text: #ff0000;')
    expect(css).not.toContain('--code-text: #ef8a6a;')
  })

  it('offers themes with safe colours for both modes', () => {
    expect(THEMES[0].id).toBe('notionix')
    const safe = /^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, 0?\.\d+\)|inherit)$/i
    for (const theme of THEMES)
      for (const mode of ['light', 'dark'] as const)
        for (const [key, value] of Object.entries(theme[mode])) {
          expect([...APPEARANCE_KEYS, 'border', 'bg-hover', 'bg-active']).toContain(key)
          expect(value).toMatch(safe)
        }
  })
})
