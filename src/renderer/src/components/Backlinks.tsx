import { useEffect, useState } from 'react'
import { PageIcon } from './PageIcon'
import type { PageSummary } from '../../../shared/types'
import { useStore } from '../store'

/** "N rétroliens": the pages linking to this one, listed on demand. */
export function Backlinks({ pageId }: { pageId: string }): React.JSX.Element | null {
  const revision = useStore((s) => s.revision)
  const updatedAt = useStore((s) => s.pages.length)
  const open = useStore((s) => s.open)
  const [links, setLinks] = useState<PageSummary[]>([])
  const [shown, setShown] = useState(false)
  useEffect(() => {
    let cancelled = false
    window.api.pages
      .backlinks(pageId)
      .then((l) => !cancelled && setLinks(l))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [pageId, revision, updatedAt])
  if (links.length === 0) return null
  return (
    <div className="backlinks">
      <button className="backlinks-toggle" onClick={() => setShown(!shown)}>
        ↙ {links.length} rétrolien{links.length > 1 ? 's' : ''}
      </button>
      {shown && (
        <div className="backlinks-list">
          {links.map((p) => (
            <button key={p.id} onClick={() => open(p.id)}>
              <PageIcon icon={p.icon} fallback={p.kind === 'database' ? '🗃️' : '📄'} />{' '}
              {p.title || 'Sans titre'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
