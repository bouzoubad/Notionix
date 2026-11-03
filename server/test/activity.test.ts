import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Accounts } from '../src/auth'
import { openDatabase } from '../src/db'
import { clientOf } from '../../src/shared/clients'

const DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) notionix/1.1.5 Chrome/142.0.7444.265 Electron/39.8.10 Safari/537.36'
const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15'

describe('what a session is used from', () => {
  it('reads the desktop app version and the browser', () => {
    expect(clientOf(DESKTOP)).toBe('desktop:1.1.5')
    expect(clientOf(SAFARI)).toBe('web:Safari')
    expect(
      clientOf(
        'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
      )
    ).toBe('web:Chrome')
    expect(clientOf('Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/131.0')).toBe('web:Firefox')
    expect(clientOf('Mozilla/5.0 Chrome/140.0 Safari/537.36 Edg/140.0')).toBe('web:Edge')
    expect(clientOf('curl/8.7.1')).toBe('other:curl')
    expect(clientOf(undefined)).toBe('other:')
  })

  it('notes when a session was last used, not only when it was opened', async () => {
    let now = Date.UTC(2026, 10, 2, 9)
    const accounts = new Accounts(
      openDatabase(mkdtempSync(join(tmpdir(), 'nx-act-'))),
      30,
      () => now
    )
    const user = await accounts.create({
      email: 'a@example.com',
      name: 'A',
      role: 'editor',
      password: 'mot-de-passe-1'
    })
    const { token } = await accounts.login('a@example.com', 'mot-de-passe-1', clientOf(DESKTOP))
    expect(accounts.sessionsByUser()).toEqual([
      {
        userId: user.id,
        count: 1,
        lastAt: now,
        clients: [{ client: 'desktop:1.1.5', seenAt: now, update: null }]
      }
    ])
    // The next morning, the same session (the app stays signed in).
    const morning = (now = Date.UTC(2026, 10, 3, 8))
    expect(accounts.authenticate(token, clientOf(DESKTOP))?.id).toBe(user.id)
    // Within the minute: not written again.
    now += 20_000
    accounts.authenticate(token, clientOf(DESKTOP))
    // Updated by the app itself to 1.1.6: the same session tells it.
    now += 30_000
    accounts.authenticate(token, 'desktop:1.1.6')
    const [s] = accounts.sessionsByUser()
    expect(s.lastAt).toBe(morning + 50_000)
    expect(s.clients).toEqual([{ client: 'desktop:1.1.6', seenAt: morning + 50_000, update: null }])
  })
})
