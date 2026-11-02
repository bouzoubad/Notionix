import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { loadAuthorities, trustedByAuthority, type PresentedCertificate } from '../src/main/trust'
import { macDownloadUrls, parseActivationLink, type DownloadsInfo } from '../src/shared/desktop'

// Shaped like Caddy's internal authority: root -> intermediate -> certificate for 127.0.0.1.
const pem = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures/tls', `${name}.crt`), 'utf8')
const root = pem('root')
const intermediate = pem('intermediate')
const leaf = pem('leaf')
/** Same name as the root, another key: an impostor. */
const otherRoot = pem('other-root')

const chain = (...certs: string[]): PresentedCertificate => {
  const [first, ...rest] = certs
  return { data: first, issuerCert: rest.length ? chain(...rest) : undefined }
}
const sent = chain(leaf, intermediate)

describe('servers trusted by the authorities shipped with the app', () => {
  const authorities = loadAuthorities([root])

  it('accepts the certificate a server of that authority presents for its address', () => {
    expect(trustedByAuthority('127.0.0.1', sent, authorities)).toBe(true)
    expect(trustedByAuthority('localhost', sent, authorities)).toBe(true)
    // The authority itself may be sent too.
    expect(trustedByAuthority('127.0.0.1', chain(leaf, intermediate, root), authorities)).toBe(true)
  })

  it('refuses another name, another authority, a broken or outdated chain', () => {
    expect(trustedByAuthority('192.168.1.20', sent, authorities)).toBe(false)
    expect(trustedByAuthority('example.com', sent, authorities)).toBe(false)
    expect(trustedByAuthority('127.0.0.1', sent, loadAuthorities([otherRoot]))).toBe(false)
    expect(trustedByAuthority('127.0.0.1', sent, [])).toBe(false)
    // Without its intermediate, the certificate does not reach the authority.
    expect(trustedByAuthority('127.0.0.1', chain(leaf), authorities)).toBe(false)
    // An authority is not a server's certificate.
    expect(trustedByAuthority('127.0.0.1', chain(intermediate, root), authorities)).toBe(false)
    expect(
      trustedByAuthority('127.0.0.1', chain(leaf, intermediate), authorities, Date.UTC(2200, 0))
    ).toBe(false)
    expect(
      trustedByAuthority('127.0.0.1', chain(leaf, intermediate), authorities, Date.UTC(2001, 0))
    ).toBe(false)
    expect(trustedByAuthority('127.0.0.1', { data: 'garbage' }, authorities)).toBe(false)
  })

  it('only keeps real authorities', () => {
    expect(loadAuthorities([root, 'garbage', leaf, intermediate])).toHaveLength(1)
  })

  it('ships the authority of the team server', () => {
    const shipped = loadAuthorities([
      readFileSync(join(__dirname, '../resources/authorities/gamma.crt'), 'utf8')
    ])
    expect(shipped).toHaveLength(1)
    expect(shipped[0].fingerprint256).toBe(
      'F5:14:6A:10:61:25:99:8D:07:32:88:80:72:B7:85:31:F2:C8:32:51:98:16:59:D7:8D:1F:46:3C:8E:FB:32:5B'
    )
  })
})

describe('activation links and downloads', () => {
  it('reads an activation link shared through Keeper', () => {
    const key = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'
    expect(parseActivationLink(` https://192.168.111.219:8443/activate/${key} `)).toEqual({
      url: 'https://192.168.111.219:8443',
      token: key
    })
    expect(parseActivationLink('https://192.168.111.219:8443')).toBeNull()
    expect(parseActivationLink('https://s/activate/court')).toBeNull()
    expect(parseActivationLink(`https://s/activate/${key}/../x`)).toBeNull()
  })

  it('gives a new person the plain HTTP download behind HTTPS', () => {
    const info: DownloadsInfo = {
      mac: { name: 'notionix-1.0.0-universal.dmg', version: '1.0.0', size: 1 },
      plainPort: 8081
    }
    expect(macDownloadUrls('https://192.168.111.219:8443', info)).toEqual({
      direct: 'https://192.168.111.219:8443/download/mac',
      shared: 'http://192.168.111.219:8081/download/mac'
    })
    expect(macDownloadUrls('https://gamma', { ...info, plainPort: 80 })?.shared).toBe(
      'http://gamma/download/mac'
    )
    expect(macDownloadUrls('http://gamma:8080', info)?.shared).toBe(
      'http://gamma:8080/download/mac'
    )
    expect(macDownloadUrls('https://gamma', { ...info, mac: null })).toBeNull()
  })
})
