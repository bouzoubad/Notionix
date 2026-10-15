import { coverStyle } from '../components/covers'
import { PageIcon } from '../components/PageIcon'
import { RowSummary } from './RowSummary'
import type { ViewProps } from './viewTypes'
import { t } from '../../../shared/i18n'

export function GalleryView({
  schema,
  view,
  rows,
  onOpenRow,
  onAddRow
}: ViewProps): React.JSX.Element {
  return (
    <div className="gallery">
      {rows.map((row) => (
        <button key={row.id} className="gallery-card" onClick={() => onOpenRow(row.id)}>
          <span className="gallery-cover" style={row.cover ? coverStyle(row.cover) : undefined}>
            {!row.cover && (
              <span className="gallery-icon">
                <PageIcon icon={row.icon} fallback="📄" />
              </span>
            )}
          </span>
          <span className="card-title">
            {row.title || <span className="muted">{t('Sans titre')}</span>}
          </span>
          <RowSummary schema={schema} view={view} row={row} />
        </button>
      ))}
      <button className="gallery-card gallery-add" onClick={() => onAddRow()}>
        {t('+ Nouveau')}
      </button>
    </div>
  )
}
