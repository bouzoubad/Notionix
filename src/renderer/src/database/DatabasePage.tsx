import { useState } from 'react'
import type { PageSummary } from '../../../shared/types'
import { PageDecorations } from '../components/PageDecorations'
import { useStore } from '../store'
import { PageTopBar } from '../components/PageTopBar'
import { canEditPage } from '../platform'
import { DatabaseViewer } from './DatabaseViewer'
import { useDatabase } from './useDatabase'

/** A full-page database: breadcrumbs, icon and cover, title, then its views. */
export function DatabasePage({ page }: { page: PageSummary }): React.JSX.Element {
  const db = useDatabase(page.id)
  const patch = useStore((s) => s.patch)
  const [title, setTitle] = useState(page.title)

  return (
    <div className={`page database-page${canEditPage(page) ? '' : ' read-only'}`}>
      <PageTopBar page={page} title={title} />
      <PageDecorations page={page} />
      <div className="db-body">
        <input
          className="page-title"
          value={title}
          readOnly={!canEditPage(page)}
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
