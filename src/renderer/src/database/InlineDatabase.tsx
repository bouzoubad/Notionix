import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { DatabaseView } from '../../../shared/databaseView'
import { useStore } from '../store'
import { DatabaseViewer } from './DatabaseViewer'
import { useDatabase } from './useDatabase'

function InlineDatabaseView({ node }: ReactNodeViewProps): React.JSX.Element {
  const databaseId = String(node.attrs.databaseId ?? '')
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
            {page.icon ?? '🗃️'} {page.title || 'Base de données sans titre'}
          </button>
          <DatabaseViewer databaseId={databaseId} db={db} />
        </>
      )}
    </NodeViewWrapper>
  )
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
