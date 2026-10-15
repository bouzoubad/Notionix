import { useEffect, useState } from 'react'
import { json } from './http'

interface Field {
  id: string
  name: string
  type: string
  options?: { id: string; name: string }[]
}

/** A database form shared with a public link: /f/<token>. */
export function PublicForm({ token }: { token: string }): React.JSX.Element {
  const [form, setForm] = useState<{ title: string; fields: Field[] } | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    json<{ form: { title: string; fields: Field[] } }>(`/api/form/${encodeURIComponent(token)}`)
      .then(({ form }) => {
        setForm(form)
        document.title = form.title
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [token])
  if (error && !form) return <div className="web-error">{error}</div>
  if (!form) return <div className="web-error">Chargement…</div>
  if (state === 'sent')
    return (
      <div className="public-form">
        <h1>{form.title}</h1>
        <p>Merci, votre réponse a été enregistrée.</p>
        <button
          onClick={() => {
            setValues({})
            setState('idle')
          }}
        >
          Envoyer une autre réponse
        </button>
      </div>
    )
  const set = (id: string, v: unknown): void => setValues((x) => ({ ...x, [id]: v }))
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setState('sending')
    setError(null)
    try {
      await json(`/api/form/${encodeURIComponent(token)}`, { json: values })
      setState('sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('idle')
    }
  }
  return (
    <form className="public-form" onSubmit={(e) => void submit(e)}>
      <h1>{form.title}</h1>
      {form.fields.map((f) => (
        <label key={f.id} className="public-field">
          <span>{f.name}</span>
          <FieldInput field={f} value={values[f.id]} onChange={(v) => set(f.id, v)} />
        </label>
      ))}
      {error && <p className="error">{error}</p>}
      <button
        className="primary"
        type="submit"
        disabled={state === 'sending' || !String(values.title ?? '').trim()}
      >
        {state === 'sending' ? 'Envoi…' : 'Envoyer'}
      </button>
    </form>
  )
}

function FieldInput({
  field,
  value,
  onChange
}: {
  field: Field
  value: unknown
  onChange: (v: unknown) => void
}): React.JSX.Element {
  switch (field.type) {
    case 'checkbox':
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      )
    case 'number':
      return (
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      )
    case 'date':
      return (
        <input
          type="date"
          value={(value as { start?: string } | undefined)?.start ?? ''}
          onChange={(e) => onChange(e.target.value ? { start: e.target.value } : null)}
        />
      )
    case 'select':
    case 'status':
      return (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Choisir…</option>
          {field.options?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )
    case 'multi_select': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <span className="public-options">
          {field.options?.map((o) => (
            <label key={o.id}>
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...selected, o.id] : selected.filter((x) => x !== o.id)
                  )
                }
              />
              {o.name}
            </label>
          ))}
        </span>
      )
    }
    case 'text':
      return (
        <textarea rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      )
    default:
      return (
        <input
          type={
            field.type === 'email'
              ? 'email'
              : field.type === 'url'
                ? 'url'
                : field.type === 'phone'
                  ? 'tel'
                  : 'text'
          }
          required={field.id === 'title'}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}
