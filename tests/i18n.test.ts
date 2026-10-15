import { readFileSync } from 'fs'
import { globSync } from 'fs'
import { describe, expect, it } from 'vitest'
import en from '../src/shared/locales/en'

/** Texts given to t() as plain literals in the interface code. */
function sources(): Map<string, string> {
  const found = new Map<string, string>()
  const files = [
    ...globSync('src/renderer/src/**/*.{ts,tsx}'),
    ...globSync('src/web/**/*.{ts,tsx}'),
    ...globSync('src/shared/**/*.{ts,tsx}'),
    ...globSync('src/main/**/*.ts')
  ].filter((f) => !f.includes('/locales/') && !f.endsWith('i18n.ts'))
  // t('…'), t("…") or t(`…`) without ${…}
  const call = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(call)) {
      const raw = m[1] ?? m[2] ?? m[3]
      const source = raw.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n')
      found.set(source, file)
    }
    // tx('context', '…'): the key is "context::…"
    for (const m of text.matchAll(/\btx\(\s*'([^']*)',\s*'((?:[^'\\]|\\.)*)'/g))
      found.set(`${m[1]}::${m[2].replace(/\\(['"`\\])/g, '$1')}`, file)
  }
  return found
}

describe('English interface', () => {
  it('translates every text given to t()', () => {
    const missing = [...sources()].filter(([s]) => !(s in en)).map(([s, f]) => `${f}: ${s}`)
    expect(missing).toEqual([])
  })

  it('keeps the variables of each text', () => {
    const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const broken = Object.entries(en).filter(([fr, text]) => vars(fr).join() !== vars(text).join())
    expect(broken).toEqual([])
  })
})
