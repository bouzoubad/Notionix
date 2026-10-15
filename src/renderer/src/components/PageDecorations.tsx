import { useRef, useState } from 'react'
import { PageIcon } from './PageIcon'
import type { PageSummary } from '../../../shared/types'
import { useStore } from '../store'
import { GRADIENT_COVERS, coverStyle } from './covers'

const EMOJIS = [
  '📄',
  '📝',
  '📌',
  '📎',
  '📚',
  '📓',
  '📒',
  '🗂️',
  '🗃️',
  '📁',
  '🗓️',
  '📅',
  '✅',
  '☑️',
  '⭐',
  '🌟',
  '💡',
  '🔥',
  '🚀',
  '🎯',
  '🏆',
  '🎉',
  '🎨',
  '🧠',
  '💼',
  '💰',
  '📈',
  '📊',
  '🛠️',
  '⚙️',
  '🔧',
  '🧪',
  '🔬',
  '💻',
  '🖥️',
  '📱',
  '🏠',
  '🏢',
  '✈️',
  '🌍',
  '🗺️',
  '🧭',
  '☕',
  '🍀',
  '🌱',
  '🌸',
  '🌙',
  '☀️',
  '❤️',
  '💬',
  '📣',
  '🔔',
  '🔒',
  '🔑',
  '❓',
  '❗',
  '⚠️',
  'ℹ️',
  '🤝',
  '👋',
  '🙂',
  '😎',
  '🤖',
  '👀',
  '🐛',
  '🦄',
  '🎵',
  '🎬',
  '📷',
  '🎮',
  '⚽',
  '🧩'
]

/** Cover banner, icon and the "add icon / add cover" controls above a page title. */
export function PageDecorations({ page }: { page: PageSummary }): React.JSX.Element {
  const patch = useStore((s) => s.patch)
  const showNotice = useStore((s) => s.showNotice)
  const [picker, setPicker] = useState<'icon' | 'cover' | null>(null)
  // While repositioning: the position shown, saved on "Enregistrer".
  const [coverY, setCoverY] = useState<number | null>(null)
  const drag = useRef<{ startY: number; startPos: number; height: number } | null>(null)
  const imageCover = !!page.cover?.startsWith('notionix-asset://')

  /** Picks an image file and stores it, then hands its src over. */
  const chooseImage = (what: string, apply: (src: string) => Promise<void>): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const src = await window.api.assets.save(
          new Uint8Array(await file.arrayBuffer()),
          file.name
        )
        await apply(src)
      } catch (e) {
        showNotice(`${what} non ajoutée : ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    input.click()
    setPicker(null)
  }
  const chooseCoverImage = (): void =>
    chooseImage('Couverture', async (src) => {
      await patch(page.id, { cover: src, options: { ...page.options, coverY: 50 } })
    })
  const chooseIconImage = (): void =>
    chooseImage('Icône', async (src) => {
      await patch(page.id, { icon: src })
    })

  const startDrag = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (coverY === null || (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    drag.current = {
      startY: e.clientY,
      startPos: coverY,
      height: e.currentTarget.getBoundingClientRect().height
    }
    const move = (ev: MouseEvent): void => {
      const d = drag.current
      if (!d) return
      // Dragging the image down shows more of its top.
      const next = d.startPos - ((ev.clientY - d.startY) / d.height) * 100
      setCoverY(Math.min(100, Math.max(0, Math.round(next))))
    }
    const up = (): void => {
      drag.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const iconPicker = (
    <div className="picker icon-picker" onMouseLeave={() => setPicker(null)}>
      <div className="picker-actions">
        <button
          onClick={() =>
            void patch(page.id, { icon: EMOJIS[Math.floor(Math.random() * EMOJIS.length)] })
          }
        >
          Aléatoire
        </button>
        <button onClick={chooseIconImage}>Image…</button>
        {page.icon && (
          <button onClick={() => (setPicker(null), void patch(page.id, { icon: null }))}>
            Retirer
          </button>
        )}
      </div>
      <div className="emoji-grid">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => (setPicker(null), void patch(page.id, { icon: emoji }))}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )

  const coverPicker = (
    <div className="picker cover-picker" onMouseLeave={() => setPicker(null)}>
      <div className="cover-grid">
        {GRADIENT_COVERS.map((g, i) => (
          <button
            key={g}
            aria-label={`Dégradé ${i + 1}`}
            style={{ backgroundImage: g }}
            onClick={() => (setPicker(null), void patch(page.id, { cover: `gradient:${i}` }))}
          />
        ))}
      </div>
      <div className="picker-actions">
        <button onClick={chooseCoverImage}>Image…</button>
        {page.cover && (
          <button onClick={() => (setPicker(null), void patch(page.id, { cover: null }))}>
            Retirer
          </button>
        )}
      </div>
    </div>
  )

  return (
    <>
      {page.cover && (
        <div
          className={coverY === null ? 'page-cover' : 'page-cover repositioning'}
          style={coverStyle(page.cover, coverY ?? page.options.coverY)}
          onMouseDown={startDrag}
        >
          {coverY !== null && <span className="cover-hint">Faites glisser l’image</span>}
          <div className={coverY === null ? 'cover-controls' : 'cover-controls shown'}>
            {coverY === null ? (
              <>
                <button onClick={() => setPicker(picker === 'cover' ? null : 'cover')}>
                  Changer la couverture
                </button>
                {imageCover && (
                  <button onClick={() => setCoverY(page.options.coverY ?? 50)}>
                    Repositionner
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    void patch(page.id, { options: { ...page.options, coverY } })
                    setCoverY(null)
                  }}
                >
                  Enregistrer la position
                </button>
                <button onClick={() => setCoverY(null)}>Annuler</button>
              </>
            )}
          </div>
          {picker === 'cover' && coverPicker}
        </div>
      )}
      <div className={page.cover ? 'page-head with-cover' : 'page-head'}>
        {page.icon && (
          <div className="page-icon-wrap">
            <button
              className="page-icon"
              title="Changer l’icône"
              onClick={() => setPicker(picker === 'icon' ? null : 'icon')}
            >
              <PageIcon icon={page.icon} className="large" />
            </button>
            {picker === 'icon' && iconPicker}
          </div>
        )}
        <div className="page-head-actions">
          {!page.icon && (
            <span className="page-icon-wrap">
              <button
                onClick={() => {
                  void patch(page.id, { icon: EMOJIS[Math.floor(Math.random() * EMOJIS.length)] })
                }}
              >
                Ajouter une icône
              </button>
            </span>
          )}
          {!page.cover && (
            <span className="page-icon-wrap">
              <button onClick={() => setPicker(picker === 'cover' ? null : 'cover')}>
                Ajouter une couverture
              </button>
              {picker === 'cover' && coverPicker}
            </span>
          )}
        </div>
      </div>
    </>
  )
}
