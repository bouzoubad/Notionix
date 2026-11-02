import { X509Certificate } from 'crypto'
import { isIP } from 'net'
import type { Session } from 'electron'

/** A certificate as Electron presents it: PEM, and the one that issued it (as sent by the server). */
export interface PresentedCertificate {
  data: string
  issuerCert?: PresentedCertificate | null
}

const SERVER_AUTH = '1.3.6.1.5.5.7.3.1'
/** A server sends its certificate and a few intermediates, never dozens. */
const MAX_CHAIN = 6

/** The authorities a Notionix server's certificate may come from (PEM texts); invalid ones are left out. */
export function loadAuthorities(pems: string[]): X509Certificate[] {
  const authorities: X509Certificate[] = []
  for (const pem of pems) {
    try {
      const cert = new X509Certificate(pem)
      if (cert.ca && cert.checkIssued(cert) && cert.verify(cert.publicKey)) authorities.push(cert)
    } catch {
      // Not a certificate: ignored.
    }
  }
  return authorities
}

const current = (cert: X509Certificate, now: number): boolean =>
  Date.parse(cert.validFrom) <= now && now <= Date.parse(cert.validTo)

/**
 * Whether the certificate a server presents for `hostname` comes from one of
 * `authorities`: every link of the chain signed by the next, each one valid
 * today, intermediates being authorities, and the server's own certificate
 * made for this name or address. The same checks as the system's, against
 * the authorities shipped with the app instead of the system's.
 */
export function trustedByAuthority(
  hostname: string,
  presented: PresentedCertificate,
  authorities: X509Certificate[],
  now = Date.now()
): boolean {
  if (authorities.length === 0) return false
  try {
    const chain: X509Certificate[] = []
    for (let c: PresentedCertificate | null | undefined = presented; c; c = c.issuerCert) {
      if (chain.length === MAX_CHAIN) return false
      chain.push(new X509Certificate(c.data))
    }
    const [leaf] = chain
    if (!leaf || leaf.ca) return false
    const name = hostname.replace(/^\[|\]$/g, '')
    const forThisServer = isIP(name) ? leaf.checkIP(name) : leaf.checkHost(name)
    if (!forThisServer) return false
    const usage = leaf.keyUsage
    if (Array.isArray(usage) && usage.length > 0 && !usage.includes(SERVER_AUTH)) return false
    for (let i = 0; i < chain.length; i++) {
      const cert = chain[i]
      if (!current(cert, now)) return false
      if (i > 0 && !cert.ca) return false
      // The authority itself may be sent: the chain ends there (the previous one was checked against it).
      if (i > 0 && authorities.some((a) => a.fingerprint256 === cert.fingerprint256)) return true
      const issuer = chain[i + 1]
      if (issuer) {
        if (!cert.checkIssued(issuer) || !cert.verify(issuer.publicKey)) return false
        continue
      }
      // The last one sent: issued by one of the authorities.
      return authorities.some(
        (a) => current(a, now) && cert.checkIssued(a) && cert.verify(a.publicKey)
      )
    }
    return false
  } catch {
    return false
  }
}

/**
 * Makes the app's connections (requests, real-time, images) also accept the
 * servers whose certificate comes from one of `authorities`, without asking
 * people to install that authority on their computer. Everything else keeps
 * the system's verdict.
 */
export function trustServerAuthorities(session: Session, authorities: X509Certificate[]): void {
  if (authorities.length === 0) return
  session.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode === 0) return callback(-3)
    callback(trustedByAuthority(request.hostname, request.certificate, authorities) ? 0 : -3)
  })
}
