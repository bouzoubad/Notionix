import { useState } from 'react'
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

  const chooseCoverImage = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const src = await window.api.assets.save(
          new Uint8Array(await file.arrayBuffer()),
          file.name
        )
        await patch(page.id, { cover: src })
      } catch (e) {
        showNotice(`Couverture non ajoutée : ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    input.click()
    setPicker(null)
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
        <div className="page-cover" style={coverStyle(page.cover)}>
          <div className="cover-controls">
            <button onClick={() => setPicker(picker === 'cover' ? null : 'cover')}>
              Changer la couverture
            </button>
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
              {page.icon}
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
