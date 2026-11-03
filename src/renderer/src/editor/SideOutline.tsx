import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { t } from '../../../shared/i18n'
import { useStore } from '../store'

interface Heading {
  pos: number
  level: number
  text: string
}

const headingsOf = (editor: Editor): Heading[] => {
  const out: Heading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading')
      out.push({ pos, level: node.attrs.level as number, text: node.textContent })
    // A heading holds no other block.
    return node.type.name !== 'heading'
  })
  return out
}

/**
 * The page's outline on its right edge, like Notion's: a short line per
 * heading (the section read now stands out); hovered or focused, the
 * headings themselves, a click going to one. Shown from two headings on.
 */
export function SideOutline({ editor }: { editor: Editor }): React.JSX.Element | null {
  const [headings, setHeadings] = useState<Heading[]>(() => headingsOf(editor))
  const [current, setCurrent] = useState(-1)
  const [open, setOpen] = useState(false)
  const commentsOpen = useStore((s) => s.comments.open)

  // The headings follow the text (grouped: not on every keystroke).
  useEffect(() => {
    let timer: number | undefined
    const update = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setHeadings(headingsOf(editor)), 250)
    }
    editor.on('update', update)
    return () => {
      window.clearTimeout(timer)
      editor.off('update', update)
    }
  }, [editor])

  // The section read now: the last heading above the top of the window.
  useEffect(() => {
    const scroller = editor.view.dom.closest('main') ?? document.documentElement
    let frame = 0
    const follow = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const top = scroller.getBoundingClientRect().top + 120
        let index = -1
        headings.forEach((h, i) => {
          const dom = editor.view.nodeDOM(h.pos)
          if (dom instanceof HTMLElement && dom.getBoundingClientRect().top <= top) index = i
        })
        setCurrent(index)
      })
    }
    follow()
    scroller.addEventListener('scroll', follow, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', follow)
    }
  }, [editor, headings])

  if (headings.length < 2 || commentsOpen) return null
  const go = (h: Heading): void => {
    const dom = editor.view.nodeDOM(h.pos)
    if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setOpen(false)
  }
  return (
    <nav
      className={`side-outline${open ? ' open' : ''}`}
      aria-label={t('Plan de la page')}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <div className="side-outline-marks" aria-hidden>
        {headings.map((h, i) => (
          <span key={h.pos} className={`level-${h.level}${i === current ? ' current' : ''}`} />
        ))}
      </div>
      <div className="side-outline-panel">
        {headings.map((h, i) => (
          <button
            key={h.pos}
            className={`level-${h.level}${i === current ? ' current' : ''}`}
            aria-current={i === current ? 'location' : undefined}
            onClick={() => go(h)}
          >
            {h.text || t('Sans titre')}
          </button>
        ))}
      </div>
    </nav>
  )
}
