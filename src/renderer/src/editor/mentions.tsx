/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react'
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { Mention, type MentionAttrs } from '../../../shared/mention'
import { newId } from '../../../shared/database'
import { useStore } from '../store'
import { platform } from '../platform'
import { createMenuController, type SlashItem } from './slashCommands'
import { PageIcon } from '../components/PageIcon'
import { iconText } from '../icons'

const pad = (n: number): string => String(n).padStart(2, '0')
const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

/** Days a typed text may name: today, tomorrow, a weekday, 15/10, 15/10/2026, 2026-10-15. */
export function datesFor(query: string, today = new Date()): { label: string; day: string }[] {
  const q = fold(query.trim())
  const at = (offset: number): Date =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)
  const out: { label: string; day: string }[] = []
  const add = (label: string, d: Date): void => {
    if (!out.some((o) => o.day === isoDay(d))) out.push({ label, day: isoDay(d) })
  }
  if (!q || 'aujourdhui'.startsWith(q.replace(/['’ ]/g, ''))) add('Aujourd’hui', at(0))
  if (!q || 'demain'.startsWith(q)) add('Demain', at(1))
  if (q && 'hier'.startsWith(q)) add('Hier', at(-1))
  if (q.length >= 2)
    WEEKDAYS.forEach((name, i) => {
      if (!name.startsWith(q)) return
      const ahead = (i - today.getDay() + 7) % 7 || 7
      add(`${name[0].toUpperCase()}${name.slice(1)} prochain`, at(ahead))
    })
  const fr = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/.exec(q)
  if (fr) {
    const year = fr[3] ? Number(fr[3].length === 2 ? `20${fr[3]}` : fr[3]) : today.getFullYear()
    const d = new Date(year, Number(fr[2]) - 1, Number(fr[1]))
    if (d.getDate() === Number(fr[1])) add(d.toLocaleDateString('fr-FR'), d)
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    if (d.getDate() === Number(iso[3])) add(d.toLocaleDateString('fr-FR'), d)
  }
  return out
}

/** Readable date of a mention: "15 oct. 2026" or "15 oct. 2026 à 09:00". */
export function formatMentionDate(date: string | null): string {
  if (!date) return 'Date'
  const [day, time] = date.split('T')
  const [y, m, d] = day.split('-').map(Number)
  const text = new Date(y, m - 1, d).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
  return time ? `${text} à ${time}` : text
}

/** Time of a date mention's reminder: its time, or 9:00 that day. */
export function reminderTime(date: string): number {
  const [day, time = '09:00'] = date.split('T')
  const [y, m, d] = day.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  return new Date(y, m - 1, d, h, min).getTime()
}

function mentionItems(query: string): SlashItem[] {
  const { people, pages, currentId } = useStore.getState()
  const q = fold(query)
  const items: SlashItem[] = []
  const me = platform().session?.user.id
  if (platform().session) {
    for (const p of people) {
      if (p.disabled || (q && !fold(p.name).includes(q) && !fold(p.email).startsWith(q))) continue
      items.push({
        icon: '👤',
        title: p.name + (p.id === me ? ' (vous)' : ''),
        hint: p.email,
        keywords: [],
        run: (e, r) =>
          e
            .chain()
            .focus()
            .deleteRange(r)
            .insertMention({ kind: 'user', id: p.id, label: p.name })
            .run()
      })
      if (items.length >= 5) break
    }
  }
  for (const d of datesFor(query)) {
    items.push({
      icon: '📅',
      title: d.label,
      hint: d.day.split('-').reverse().join('/'),
      keywords: [],
      run: (e, r) =>
        e
          .chain()
          .focus()
          .deleteRange(r)
          .insertMention({ kind: 'date', id: newId(), label: d.label, date: d.day })
          .run()
    })
    items.push({
      icon: '⏰',
      title: `Rappel ${fold(d.label) === 'aujourdhui' ? 'aujourd’hui' : d.label.toLowerCase()} 9:00`,
      hint: 'Notification à cette heure',
      keywords: [],
      run: (e, r) =>
        e
          .chain()
          .focus()
          .deleteRange(r)
          .insertMention({
            kind: 'date',
            id: newId(),
            label: d.label,
            date: `${d.day}T09:00`,
            reminder: true
          })
          .run()
    })
  }
  let shown = 0
  for (const p of pages) {
    if (p.trashedAt || p.id === currentId || (q && !fold(p.title).includes(q))) continue
    items.push({
      icon: iconText(p.icon, p.kind === 'database' ? '🗃️' : '📄'),
      title: p.title || 'Sans titre',
      hint: 'Lien vers la page',
      keywords: [],
      run: (e, r) =>
        e
          .chain()
          .focus()
          .deleteRange(r)
          .insertMention({ kind: 'page', id: p.id, label: p.title || 'Sans titre' })
          .run()
    })
    if (++shown >= 6) break
  }
  return items
}

/** "@" opens a menu of people, dates (and reminders) and pages. */
export const MentionSuggestion = Extension.create({
  name: 'mentionSuggestion',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('mentionSuggestion'),
        char: '@',
        allowSpaces: false,
        items: ({ query }) => mentionItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: createMenuController
      })
    ]
  }
})

/** "[[" links to a page, like Notion: the page menu only. */
export const PageLinkSuggestion = Extension.create({
  name: 'pageLinkSuggestion',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('pageLinkSuggestion'),
        char: '[[',
        allowSpaces: true,
        items: ({ query }) => {
          const q = fold(query)
          const { pages, currentId } = useStore.getState()
          return pages
            .filter(
              (p) =>
                !p.trashedAt &&
                p.kind !== 'synced' &&
                p.id !== currentId &&
                (!q || fold(p.title).includes(q))
            )
            .slice(0, 10)
            .map((p) => ({
              icon: iconText(p.icon, p.kind === 'database' ? '🗃️' : '📄'),
              title: p.title || 'Sans titre',
              hint: 'Lien vers la page',
              keywords: [],
              run: (e, r) =>
                e
                  .chain()
                  .focus()
                  .deleteRange(r)
                  .insertMention({ kind: 'page', id: p.id, label: p.title || 'Sans titre' })
                  .run()
            }))
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: createMenuController
      })
    ]
  }
})

/** Mentions shown live: current names and titles, clickable pages, editable dates. */
export const InteractiveMention = Mention.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MentionView, { as: 'span' })
  }
})

function MentionView({
  node,
  updateAttributes,
  deleteNode,
  editor
}: ReactNodeViewProps): React.JSX.Element {
  const attrs = node.attrs as MentionAttrs
  const person = useStore((s) =>
    attrs.kind === 'user' ? s.people.find((p) => p.id === attrs.id) : null
  )
  const page = useStore((s) =>
    attrs.kind === 'page' ? s.pages.find((p) => p.id === attrs.id) : null
  )
  const pageId = useStore((s) => s.currentId)
  const open = useStore((s) => s.open)
  const [editing, setEditing] = useState(false)

  // A date with a reminder notifies whoever set it, at its time.
  useEffect(() => {
    if (attrs.kind !== 'date' || !pageId || !editor.isEditable) return
    const at = attrs.reminder && attrs.date ? reminderTime(attrs.date) : null
    const title = useStore.getState().pages.find((p) => p.id === pageId)?.title || 'Sans titre'
    void window.api.reminders
      .set(pageId, attrs.id, at, `Rappel : ${title} (${formatMentionDate(attrs.date)})`)
      .catch(() => undefined)
  }, [attrs.kind, attrs.id, attrs.date, attrs.reminder, pageId, editor])

  let content: React.ReactNode
  if (attrs.kind === 'user') content = `@${person?.name ?? attrs.label}`
  else if (attrs.kind === 'page')
    content = page ? (
      <>
        <span className="mention-icon">
          <PageIcon icon={page.icon} fallback={page.kind === 'database' ? '🗃️' : '📄'} />
        </span>
        {page.title || 'Sans titre'}
      </>
    ) : (
      <span className="mention-missing">{attrs.label || 'Page inaccessible'}</span>
    )
  else
    content = (
      <>
        {attrs.reminder ? '⏰ ' : '@'}
        {formatMentionDate(attrs.date)}
      </>
    )

  return (
    <NodeViewWrapper as="span" className={`mention mention-${attrs.kind}`} data-mention="">
      <span
        role="button"
        onClick={() => {
          if (attrs.kind === 'page' && page) open(page.id)
          if (attrs.kind === 'date' && editor.isEditable) setEditing(true)
        }}
      >
        {content}
      </span>
      {editing && (
        <DateEditor
          attrs={attrs}
          onChange={(next) => updateAttributes(next)}
          onDelete={() => deleteNode()}
          onClose={() => setEditing(false)}
        />
      )}
    </NodeViewWrapper>
  )
}

function DateEditor({
  attrs,
  onChange,
  onDelete,
  onClose
}: {
  attrs: MentionAttrs
  onChange: (next: Partial<MentionAttrs>) => void
  onDelete: () => void
  onClose: () => void
}): React.JSX.Element {
  const [day, time = ''] = (attrs.date ?? isoDay(new Date())).split('T')
  const set = (nextDay: string, nextTime: string, reminder = attrs.reminder): void => {
    if (!nextDay) return
    const date = nextTime ? `${nextDay}T${nextTime}` : nextDay
    const [y, m, d] = nextDay.split('-').map(Number)
    onChange({ date, reminder, label: new Date(y, m - 1, d).toLocaleDateString('fr-FR') })
  }
  return (
    <span className="mention-date-editor" contentEditable={false} onMouseLeave={onClose}>
      <input type="date" value={day} onChange={(e) => set(e.target.value, time)} />
      <input type="time" value={time} onChange={(e) => set(day, e.target.value)} />
      <label>
        <input
          type="checkbox"
          checked={attrs.reminder}
          onChange={(e) => set(day, time || (e.target.checked ? '09:00' : ''), e.target.checked)}
        />
        Rappel
      </label>
      <button onClick={onDelete}>Supprimer</button>
    </span>
  )
}
