import { useEffect, useState } from 'react'
import type { PublicPage } from '../shared/types'
import { coverStyle } from '../renderer/src/components/covers'
import { SubEditor } from '../renderer/src/editor/SubEditor'
import { json } from './http'

/** A published page, read-only, for anyone with its link: /p/<token>[/<page id>]. */
export function PublicView({
  token,
  pageId
}: {
  token: string
  pageId: string | null
}): React.JSX.Element {
  const [page, setPage] = useState<PublicPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const path = pageId
      ? `/api/public/${encodeURIComponent(token)}/pages/${encodeURIComponent(pageId)}`
      : `/api/public/${encodeURIComponent(token)}`
    json<{ page: PublicPage }>(path)
      .then(({ page }) => {
        if (cancelled) return
        setPage(page)
        document.title = `${page.title || 'Sans titre'} · Notionix`
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [token, pageId])

  if (error) return <div className="web-error">{error}</div>
  if (!page) return <div className="web-error">Chargement…</div>
  const link = (id: string): string =>
    id === page.root.id ? `/p/${token}` : `/p/${token}/${encodeURIComponent(id)}`
  return (
    <div className="public-page">
      <header className="public-bar">
        {page.id !== page.root.id && (
          <a href={link(page.root.id)}>← {page.root.title || 'Sans titre'}</a>
        )}
        <span className="public-badge">Page publique, en lecture seule</span>
      </header>
      {page.cover && <div className="page-cover" style={coverStyle(page.cover)} />}
      <div className="page-body">
        {page.icon && <div className="public-icon">{page.icon}</div>}
        <h1 className="public-title">{page.title || 'Sans titre'}</h1>
        {page.table ? (
          <div className="table-view">
            <table className="db-table">
              <thead>
                <tr>
                  {page.table.columns.map((c) => (
                    <th key={c}>
                      <span className="col-head">{c}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.table.rows.map((r) => (
                  <tr key={r.id}>
                    {r.cells.map((c, i) => (
                      <td key={i}>
                        <div className="cell">
                          {i === 0 ? <a href={link(r.id)}>{c || 'Sans titre'}</a> : c}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <SubEditor key={page.id} editable={false} content={JSON.parse(page.content)} />
        )}
        {page.children.length > 0 && (
          <nav className="public-children">
            {page.children.map((c) => (
              <a key={c.id} href={link(c.id)}>
                {c.icon ?? '📄'} {c.title || 'Sans titre'}
              </a>
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}
