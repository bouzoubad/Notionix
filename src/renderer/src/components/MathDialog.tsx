import { useState } from 'react'
import katex from 'katex'
import { useStore } from '../store'
import { t } from '../../../shared/i18n'

/** Edits a LaTeX equation with a live preview; an empty equation is removed. */
export function MathDialog(): React.JSX.Element | null {
  const edit = useStore((s) => s.mathEdit)
  const close = useStore((s) => s.setMathEdit)
  const [latex, setLatex] = useState(edit?.latex ?? '')
  if (!edit) return null
  const preview = katex.renderToString(latex, {
    throwOnError: false,
    displayMode: !edit.inline
  })
  const done = (value: string | null): void => {
    edit.apply(value === null ? null : value.trim())
    close(null)
  }
  return (
    <div className="overlay" onMouseDown={() => done(latex)}>
      <div className="dialog math-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{edit.inline ? t('Équation en ligne') : t('Équation')}</h3>
        <textarea
          autoFocus
          aria-label="LaTeX"
          value={latex}
          placeholder="\frac{a}{b}"
          spellCheck={false}
          onChange={(e) => setLatex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || edit.inline)) {
              e.preventDefault()
              done(latex)
            }
            if (e.key === 'Escape') done(edit.latex)
          }}
        />
        <div className="math-preview" dangerouslySetInnerHTML={{ __html: preview }} />
        <div className="math-actions">
          <span className="muted">
            {edit.inline ? t('Entrée pour valider') : t('⌘ Entrée pour valider')}
          </span>
          <button onClick={() => done('')}>{t('Supprimer')}</button>
          <button className="primary" onClick={() => done(latex)}>
            {t('Valider')}
          </button>
        </div>
      </div>
    </div>
  )
}
