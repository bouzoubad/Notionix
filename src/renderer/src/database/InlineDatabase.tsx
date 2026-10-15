import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { DatabaseView } from '../../../shared/databaseView'
import { useStore } from '../store'
import { DatabaseViewer } from './DatabaseViewer'
import { useDatabase } from './useDatabase'
import type { ViewDef } from '../../../shared/database'

function InlineDatabaseView({ node, updateAttributes }: ReactNodeViewProps): React.JSX.Element {
  const databaseId = String(node.attrs.databaseId ?? '')
  const linked = typeof node.attrs.views === 'string' ? parseViews(node.attrs.views) : null
  const page = useStore((s) => s.pages.find((p) => p.id === databaseId))
  const open = useStore((s) => s.open)
  const db = useDatabase(databaseId)
  return (
    <NodeViewWrapper
      className="inline-database"
      contentEditable={false}
      data-database-id={databaseId}
    >
      {!page || page.trashedAt ? (
        <div className="inline-database-missing">Base de données supprimée ou introuvable.</div>
      ) : (
        <>
          <button className="inline-database-title" onClick={() => open(databaseId)}>
            {linked && <span className="linked-mark">↗ </span>}
            {page.icon ?? '🗃️'} {page.title || 'Base de données sans titre'}
          </button>
          <DatabaseViewer
            databaseId={databaseId}
            db={db}
            linkedViews={
              linked
                ? {
                    views: linked,
                    onChange: (views) => updateAttributes({ views: JSON.stringify(views) })
                  }
                : undefined
            }
          />
        </>
      )}
    </NodeViewWrapper>
  )
}

/** Views of a linked block, checked like a schema's. */
function parseViews(raw: string): ViewDef[] | null {
  try {
    const views = JSON.parse(raw)
    return Array.isArray(views) ? views : null
  } catch {
    return null
  }
}

/**
 * The inline block keeps its own events: typing in a cell or opening a menu
 * must not be handled by the page editor around it.
 */
export const InteractiveDatabaseView = DatabaseView.extend({
  addNodeView() {
    return ReactNodeViewRenderer(InlineDatabaseView, {
      stopEvent: ({ event }) => !(event.type.startsWith('drag') || event.type === 'drop'),
      ignoreMutation: () => true
    })
  }
})
