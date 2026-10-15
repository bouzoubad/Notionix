import { describe, expect, it } from 'vitest'
import { canonicalDoc } from '../src/core/transfer/canonicalDoc'
import { gettingStartedPage } from '../src/renderer/src/onboarding/gettingStarted'

describe('getting started page', () => {
  it('is a valid document of the editor, on the desktop and on the web', () => {
    for (const web of [false, true]) {
      const page = gettingStartedPage(web)
      expect(canonicalDoc(JSON.parse(page.content!))).not.toBeNull()
    }
  })
})
