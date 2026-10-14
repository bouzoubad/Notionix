import { useState } from 'react'
import type { PageSummary } from '../../../shared/types'
import { PageDecorations } from '../components/PageDecorations'
import { ancestorsOf, useStore } from '../store'
import { DatabaseViewer } from './DatabaseViewer'
import { useDatabase } from './useDatabase'

/** A full-page database: breadcrumbs, icon and cover, title, then its views. */
export function DatabasePage({ page }: { page: PageSummary }): React.JSX.Element {
  const db = useDatabase(page.id)
  const pages = useStore((s) => s.pages)
  const open = useStore((s) => s.open)
  const patch = useStore((s) => s.patch)
  const [title, setTitle] = useState(page.title)
  const crumbs = ancestorsOf(pages, page.id)

  return (
    <div className="page database-page">
      <div className="breadcrumbs">
        {crumbs.map((c) => (
          <button key={c.id} onClick={() => open(c.id)}>
            {c.icon ?? ''} {c.title || 'Sans titre'}
          </button>
        ))}
        <span>
          {page.icon ?? '🗃️'} {title || 'Sans titre'}
        </span>
      </div>
      <PageDecorations page={page} />
      <div className="db-body">
        <input
          className="page-title"
          value={title}
          placeholder="Base de données sans titre"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== page.title && void patch(page.id, { title })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <DatabaseViewer databaseId={page.id} db={db} />
      </div>
    </div>
  )
}
