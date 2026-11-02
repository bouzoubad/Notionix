import type { DesktopServer, ProxyRequest } from '../shared/desktop'
import type { Transport } from '../web/http'

/**
 * Requests of the web client's API, sent by the main process: it holds the
 * session, and answers from what it kept when the server is out of reach.
 */
export function desktopTransport(server: DesktopServer): Transport {
  return async (path, init) => {
    let body: string | Uint8Array | undefined
    if (typeof init.body === 'string') body = init.body
    else if (init.body != null) body = new Uint8Array(await new Response(init.body).arrayBuffer())
    const res = await server.request(path, {
      method: init.method as ProxyRequest['method'],
      headers: init.headers,
      body
    })
    return new Response(res.body as BodyInit | null, { status: res.status, headers: res.headers })
  }
}
