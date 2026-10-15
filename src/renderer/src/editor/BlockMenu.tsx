import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { BlockMenuRequest } from './blockHandle'
import { COLOR_LABELS, COLORED_BLOCKS, COLORS, type BlockColor } from '../../../shared/colors'
import { t } from '../../../shared/i18n'

interface Target {
  name: string
  label: string
  run: (editor: Editor) => void
}

/** What a block can become; the text is kept. */
const TARGETS: Target[] = [
  { name: 'paragraph', label: t('Texte'), run: (e) => e.chain().clearNodes().setParagraph().run() },
  {
    name: 'h1',
    label: t('Titre 1'),
    run: (e) => e.chain().clearNodes().setHeading({ level: 1 }).run()
  },
  {
    name: 'h2',
    label: t('Titre 2'),
    run: (e) => e.chain().clearNodes().setHeading({ level: 2 }).run()
  },
  {
    name: 'h3',
    label: t('Titre 3'),
    run: (e) => e.chain().clearNodes().setHeading({ level: 3 }).run()
  },
  {
    name: 'bullet',
    label: t('Liste à puces'),
    run: (e) => e.chain().clearNodes().toggleBulletList().run()
  },
  {
    name: 'ordered',
    label: t('Liste numérotée'),
    run: (e) => e.chain().clearNodes().toggleOrderedList().run()
  },
  {
    name: 'task',
    label: t('Liste de tâches'),
    run: (e) => e.chain().clearNodes().toggleTaskList().run()
  },
  { name: 'toggle', label: t('Toggle'), run: (e) => e.chain().clearNodes().setDetails().run() },
  ...[1, 2, 3].map((level) => ({
    name: `toggle-h${level}`,
    label: t('Titre {level} repliable', { level }),
    run: (e: Editor) => e.chain().clearNodes().setDetails().setToggleHeading(level).run()
  })),
  {
    name: 'quote',
    label: t('Citation'),
    run: (e) => e.chain().clearNodes().toggleBlockquote().run()
  },
  { name: 'callout', label: t('Callout'), run: (e) => e.chain().clearNodes().setCallout().run() },
  { name: 'code', label: t('Code'), run: (e) => e.chain().clearNodes().setCodeBlock().run() }
]

/** Menu of a block, opened from its handle. */
export function BlockMenu({ editor }: { editor: Editor }): React.JSX.Element | null {
  const [request, setRequest] = useState<BlockMenuRequest | null>(null)
  const [section, setSection] = useState<'main' | 'turn' | 'color'>('main')

  useEffect(() => {
    const onOpen = (e: Event): void => {
      setRequest((e as CustomEvent<BlockMenuRequest>).detail)
      setSection('main')
    }
    window.addEventListener('notionix:block-menu', onOpen)
    return () => window.removeEventListener('notionix:block-menu', onOpen)
  }, [])
  useEffect(() => {
    if (!request) return
    const close = (e: MouseEvent | KeyboardEvent): void => {
      if (
        e instanceof KeyboardEvent
          ? e.key === 'Escape'
          : !(e.target as HTMLElement).closest('.block-menu')
      )
        setRequest(null)
    }
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', close)
      document.addEventListener('keydown', close)
    })
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [request])

  if (!request) return null
  const node = editor.state.doc.nodeAt(request.pos)
  if (!node) return null
  const pos = request.pos
  const done = (): void => setRequest(null)

  /** Puts the cursor in the block so text commands apply to it. */
  const inside = (): Editor => {
    const from = Math.min(pos + 1, editor.state.doc.content.size)
    const to = Math.max(from, pos + node.nodeSize - 1)
    editor.chain().focus().setTextSelection({ from, to }).run()
    return editor
  }
  const setColor = (color: BlockColor | null): void => {
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setNodeAttribute(pos, 'blockColor', color)
        return true
      })
      .run()
    done()
  }
  const colorable = COLORED_BLOCKS.includes(node.type.name)

  return (
    <div className="block-menu" style={{ left: request.left, top: request.top }}>
      {section === 'main' && (
        <>
          <button onClick={() => setSection('turn')}>{t('Transformer en ›')}</button>
          {colorable && <button onClick={() => setSection('color')}>{t('Couleur ›')}</button>}
          <button
            onClick={() => {
              editor
                .chain()
                .focus()
                .insertContentAt(pos + node.nodeSize, node.toJSON())
                .run()
              done()
            }}
          >
            {t('Dupliquer')}
          </button>
          <button
            onClick={() => {
              editor
                .chain()
                .focus()
                .command(({ tr }) => {
                  tr.delete(pos, pos + node.nodeSize)
                  return true
                })
                .run()
              done()
            }}
          >
            {t('Supprimer')}
          </button>
        </>
      )}
      {section === 'turn' &&
        TARGETS.map((target) => (
          <button
            key={target.name}
            onClick={() => {
              const level =
                target.name === 'toggle'
                  ? 0
                  : Number(target.name.match(/^toggle-h(\d)$/)?.[1] ?? -1)
              if (level >= 0 && node.isTextblock) {
                // A line becomes the title of the toggle, like in Notion.
                editor
                  .chain()
                  .focus()
                  .insertContentAt(
                    { from: pos, to: pos + node.nodeSize },
                    {
                      type: 'details',
                      attrs: { headingLevel: level },
                      content: [
                        { type: 'detailsSummary', content: node.content.toJSON() ?? [] },
                        { type: 'detailsContent', content: [{ type: 'paragraph' }] }
                      ]
                    }
                  )
                  .run()
              } else target.run(inside())
              done()
            }}
          >
            {target.label}
          </button>
        ))}
      {section === 'color' && (
        <>
          <span className="palette-title">{t('Couleur du texte')}</span>
          <button onClick={() => setColor(null)}>{t('Par défaut')}</button>
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)}>
              <span className="swatch-dot" style={{ color: `var(--nx-${c})` }}>
                A
              </span>{' '}
              {COLOR_LABELS[c]}
            </button>
          ))}
          <span className="palette-title">{t('Fond')}</span>
          {COLORS.map((c) => (
            <button key={`${c}-bg`} onClick={() => setColor(`${c}_background`)}>
              <span className="swatch-dot" style={{ background: `var(--nx-${c}-bg)` }}>
                A
              </span>{' '}
              {t('Fond {color}', { color: COLOR_LABELS[c].toLowerCase() })}
            </button>
          ))}
        </>
      )}
    </div>
  )
}
