import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { BlockMenuRequest } from './blockHandle'
import { COLOR_LABELS, COLORED_BLOCKS, COLORS, type BlockColor } from '../../../shared/colors'
import { TURN_TARGETS, turnBlockInto } from './turnInto'
import { t } from '../../../shared/i18n'

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
        TURN_TARGETS.map((target) => (
          <button
            key={target.name}
            onClick={() => {
              turnBlockInto(editor, pos, target)
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
