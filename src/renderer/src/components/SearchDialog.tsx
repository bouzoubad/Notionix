import { useEffect, useRef, useState } from 'react'
import type { SearchHit } from '../../../shared/types'
import { recentPageIds, useStore } from '../store'

const mark = (html: string): string =>
  html
    .replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    .replace(/&#60;mark&#62;/g, '<mark>')
    .replace(/&#60;\/mark&#62;/g, '</mark>')

export function SearchDialog(): React.JSX.Element {
  const setOpen = useStore((s) => s.setSearchOpen)
  const open = useStore((s) => s.open)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [sel, setSel] = useState(0)
  const seq = useRef(0)

  const pages = useStore((s) => s.pages)
  // Without a query: the pages opened lately.
  const recent: SearchHit[] = recentPageIds()
    .map((id) => pages.find((p) => p.id === id && !p.trashedAt))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, title: p.title, icon: p.icon, snippet: '' }))
  useEffect(() => {
    const n = ++seq.current
    if (!q.trim()) return
    window.api.pages.search(q).then((h) => {
      if (n !== seq.current) return
      setHits(h)
      setSel(0)
    })
  }, [q])

  const list = q.trim() ? hits : recent
  const go = (h?: SearchHit): void => {
    if (!h) return
    open(h.id)
    setOpen(false)
  }

  return (
    <div className="overlay" onMouseDown={() => setOpen(false)}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Rechercher dans les pages…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel(Math.min(sel + 1, list.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel(Math.max(sel - 1, 0))
            }
            if (e.key === 'Enter') go(list[sel])
          }}
        />
        <div className="results">
          {!q.trim() && recent.length > 0 && <div className="menu-label">Récents</div>}
          {list.map((h, i) => (
            <button
              key={h.id}
              className={i === sel ? 'hit active' : 'hit'}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(h)}
            >
              <span>
                {h.icon ?? '📄'} {h.title || 'Sans titre'}
              </span>
              <small dangerouslySetInnerHTML={{ __html: mark(h.snippet) }} />
            </button>
          ))}
          {q.trim() && hits.length === 0 && <p className="empty">Aucun résultat</p>}
        </div>
      </div>
    </div>
  )
}
