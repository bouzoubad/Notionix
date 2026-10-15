import { useState } from 'react'
import type { PageSummary } from '../../../shared/types'
import { ancestorsOf, useStore } from '../store'
import { platform } from '../platform'
import { ShareMenu } from './ShareMenu'

/** Breadcrumbs of a page, and its actions (sharing…), above its content. */
export function PageTopBar({
  page,
  title
}: {
  page: PageSummary
  /** The title as being typed, shown in the last crumb */
  title: string
}): React.JSX.Element {
  const pages = useStore((s) => s.pages)
  const open = useStore((s) => s.open)
  const [menu, setMenu] = useState<'share' | null>(null)
  const crumbs = ancestorsOf(pages, page.id)
  const web = platform().session !== null
  const shared = page.access === 'restricted' || page.publicToken !== null

  return (
    <div className="breadcrumbs">
      {crumbs.map((c) => (
        <button key={c.id} onClick={() => open(c.id)}>
          {c.icon ?? ''} {c.title || 'Sans titre'}
        </button>
      ))}
      <span className="crumb-current">
        {page.icon ?? (page.kind === 'database' ? '🗃️' : '')} {title || 'Sans titre'}
      </span>
      <div className="topbar-actions">
        {web && (
          <span className="topbar-anchor">
            <button
              className={menu === 'share' ? 'active' : ''}
              onClick={() => setMenu(menu === 'share' ? null : 'share')}
            >
              {shared ? '🔒 Partager' : 'Partager'}
            </button>
            {menu === 'share' && <ShareMenu page={page} onClose={() => setMenu(null)} />}
          </span>
        )}
      </div>
    </div>
  )
}
