import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import { md5Hex } from '../src/renderer/src/importers/md5'

describe('md5Hex', () => {
  it('matches Node for empty, short and multi-block inputs', () => {
    for (const size of [0, 3, 55, 56, 64, 1000]) {
      const bytes = new Uint8Array(size).map((_, i) => (i * 31 + 7) & 0xff)
      expect(md5Hex(bytes)).toBe(createHash('md5').update(bytes).digest('hex'))
    }
  })
})
