import { describe, expect, it } from 'vitest'
import { olderVersion, RELEASE_NOTES } from '../src/shared/changelog'
import { markdownToDoc, newStats } from '../src/core/transfer/markdownToDoc'
import { canonicalDoc } from '../src/core/transfer/canonicalDoc'

describe('release notes', () => {
  it('are well formed: unique ids, dates, pages the editor reads', () => {
    const ids = RELEASE_NOTES.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const note of RELEASE_NOTES) {
      expect(note.id).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/)
      expect(note.id.startsWith(note.date)).toBe(true)
      expect(note.title && note.summary && note.body).toBeTruthy()
      expect(canonicalDoc(markdownToDoc(note.body, () => undefined, newStats()))).not.toBeNull()
    }
    // Newest first.
    const dates = RELEASE_NOTES.map((n) => n.date)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('compares versions of the desktop app', () => {
    expect(olderVersion('1.0.0', '1.1.0')).toBe(true)
    expect(olderVersion('1.9.0', '1.10.0')).toBe(true)
    expect(olderVersion('1.1.0', '1.1.0')).toBe(false)
    expect(olderVersion('2.0.0', '1.9.9')).toBe(false)
  })
})
