import { useState } from 'react'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps
} from '@tiptap/react'
import { Callout } from '../../../shared/callout'
import { t } from '../../../shared/i18n'

const ICONS = ['💡', '⚠️', '❗', '✅', 'ℹ️', '📌', '🔥', '🚀', '📝', '❓', '⭐', '🎯']

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <NodeViewWrapper as="aside" className="callout" data-type="callout">
      <span className="callout-icon-wrap" contentEditable={false}>
        <button
          className="callout-icon"
          title={t('Changer l’icône')}
          disabled={!editor.isEditable}
          onClick={() => setOpen(!open)}
        >
          {node.attrs.icon}
        </button>
        {open && (
          <span className="callout-icons" onMouseLeave={() => setOpen(false)}>
            {ICONS.map((icon) => (
              <button
                key={icon}
                onClick={() => {
                  updateAttributes({ icon })
                  setOpen(false)
                }}
              >
                {icon}
              </button>
            ))}
          </span>
        )}
      </span>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  )
}

/** Callout with a clickable icon; same schema as the shared Callout node. */
export const InteractiveCallout = Callout.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  }
})
