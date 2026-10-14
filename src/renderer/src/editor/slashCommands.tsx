/* eslint-disable react-refresh/only-export-components */
import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion, { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { pickImages } from './images'
import { useStore } from '../store'

export interface SlashItem {
  title: string
  hint: string
  keywords: string[]
  run: (editor: Editor, range: Range) => void
}

const chain = (editor: Editor, range: Range): ReturnType<Editor['chain']> =>
  editor.chain().focus().deleteRange(range)

export const SLASH_ITEMS: SlashItem[] = [
  {
    title: 'Texte',
    hint: 'Paragraphe simple',
    keywords: ['text', 'paragraph', 'p'],
    run: (e, r) => chain(e, r).setParagraph().run()
  },
  {
    title: 'Titre 1',
    hint: 'Grand titre',
    keywords: ['h1', 'heading', 'titre'],
    run: (e, r) => chain(e, r).setHeading({ level: 1 }).run()
  },
  {
    title: 'Titre 2',
    hint: 'Titre moyen',
    keywords: ['h2', 'heading'],
    run: (e, r) => chain(e, r).setHeading({ level: 2 }).run()
  },
  {
    title: 'Titre 3',
    hint: 'Petit titre',
    keywords: ['h3', 'heading'],
    run: (e, r) => chain(e, r).setHeading({ level: 3 }).run()
  },
  {
    title: 'Liste à puces',
    hint: 'Liste simple',
    keywords: ['bullet', 'ul', 'liste'],
    run: (e, r) => chain(e, r).toggleBulletList().run()
  },
  {
    title: 'Liste numérotée',
    hint: 'Liste ordonnée',
    keywords: ['number', 'ol', 'liste'],
    run: (e, r) => chain(e, r).toggleOrderedList().run()
  },
  {
    title: 'Liste de tâches',
    hint: 'Cases à cocher',
    keywords: ['todo', 'task', 'checkbox', 'tache'],
    run: (e, r) => chain(e, r).toggleTaskList().run()
  },
  {
    title: 'Citation',
    hint: 'Bloc de citation',
    keywords: ['quote', 'blockquote'],
    run: (e, r) => chain(e, r).toggleBlockquote().run()
  },
  {
    title: 'Code',
    hint: 'Bloc de code',
    keywords: ['code', 'snippet'],
    run: (e, r) => chain(e, r).toggleCodeBlock().run()
  },
  {
    title: 'Image',
    hint: 'Depuis un fichier',
    keywords: ['image', 'photo', 'picture', 'img'],
    run: (e, r) => {
      chain(e, r).run()
      pickImages(e)
    }
  },
  {
    title: 'Tableau',
    hint: 'Lignes et colonnes',
    keywords: ['table', 'tableau', 'grille'],
    run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  },
  {
    title: 'Toggle',
    hint: 'Contenu repliable',
    keywords: ['toggle', 'details', 'replier', 'accordeon'],
    run: (e, r) => chain(e, r).setDetails().run()
  },
  {
    title: 'Callout',
    hint: 'Encadré avec icône',
    keywords: ['callout', 'encadre', 'note', 'aside'],
    run: (e, r) => chain(e, r).setCallout().run()
  },
  {
    title: 'Base de données',
    hint: 'Base affichée dans la page',
    keywords: ['database', 'base', 'table', 'bdd', 'tableau'],
    run: (e, r) => {
      chain(e, r).run()
      const parentId = useStore.getState().currentId
      void useStore
        .getState()
        .createDatabaseAndLink(parentId, (id) => e.chain().focus().insertDatabaseView(id).run())
    }
  },
  {
    title: 'Séparateur',
    hint: 'Ligne horizontale',
    keywords: ['divider', 'hr', 'separateur'],
    run: (e, r) => chain(e, r).setHorizontalRule().run()
  }
]

interface MenuProps {
  items: SlashItem[]
  selected: number
  onHover: (index: number) => void
  onPick: (index: number) => void
}

function SlashMenu({ items, selected, onHover, onPick }: MenuProps): React.JSX.Element {
  if (items.length === 0) {
    return (
      <div className="slash-menu">
        <div className="slash-empty">Aucun résultat</div>
      </div>
    )
  }
  return (
    <div className="slash-menu">
      {items.map((item, i) => (
        <button
          key={item.title}
          className={i === selected ? 'slash-item active' : 'slash-item'}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(i)}
        >
          <span className="slash-title">{item.title}</span>
          <span className="slash-hint">{item.hint}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * The suggestion props and selected index live here, not in React state, so a
 * key pressed right after a keystroke always acts on the current range.
 */
function createMenuController(): ReturnType<
  NonNullable<Parameters<typeof Suggestion<SlashItem, SlashItem>>[0]['render']>
> {
  let component: ReactRenderer<unknown, MenuProps> | null = null
  let latest: SuggestionProps<SlashItem, SlashItem> | null = null
  let selected = 0

  const pick = (i: number): void => {
    const item = latest?.items[i]
    if (item) latest?.command(item)
  }
  const draw = (): void => {
    if (!latest || !component) return
    component.updateProps({
      items: latest.items,
      selected,
      onHover: (i) => {
        selected = i
        draw()
      },
      onPick: pick
    })
    place()
  }
  /** Follow the caret: also called on scroll, since the editor scrolls after a keystroke. */
  const place = (): void => {
    const rect = latest?.clientRect?.()
    const el = component?.element as HTMLElement | undefined
    if (!rect || !el) return
    const gap = 6
    const below = rect.bottom + gap
    const fitsBelow = below + el.offsetHeight <= window.innerHeight
    el.style.position = 'fixed'
    el.style.left = `${rect.left}px`
    el.style.top = `${fitsBelow ? below : Math.max(gap, rect.top - gap - el.offsetHeight)}px`
    el.style.zIndex = '50'
  }
  /** Leaving the editor (dialog, sidebar click…) ends the suggestion instead of leaving the menu floating. */
  const dismiss = (): void => {
    if (latest) exitSuggestion(latest.editor.view)
  }
  const close = (): void => {
    window.removeEventListener('scroll', place, true)
    latest?.editor.off('blur', dismiss)
    component?.element.remove()
    component?.destroy()
    component = null
    latest = null
  }

  return {
    onStart: (props) => {
      latest = props
      selected = 0
      component = new ReactRenderer(SlashMenu, {
        props: { items: props.items, selected, onHover: () => {}, onPick: pick },
        editor: props.editor
      })
      document.body.appendChild(component.element)
      window.addEventListener('scroll', place, true)
      props.editor.on('blur', dismiss)
      draw()
    },
    onUpdate: (props) => {
      if (props.query !== latest?.query) selected = 0
      latest = props
      draw()
    },
    onKeyDown: ({ event }) => {
      if (!latest) return false
      const n = Math.max(latest.items.length, 1)
      if (event.key === 'ArrowDown') {
        selected = (selected + 1) % n
        draw()
        return true
      }
      if (event.key === 'ArrowUp') {
        selected = (selected - 1 + n) % n
        draw()
        return true
      }
      if (event.key === 'Enter') {
        pick(selected)
        return true
      }
      if (event.key === 'Escape') {
        dismiss()
        return true
      }
      return false
    },
    onExit: close
  }
}

export const SlashCommands = Extension.create({
  name: 'slashCommands',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        items: ({ query }) => {
          const q = query.toLowerCase()
          return SLASH_ITEMS.filter(
            (i) => !q || i.title.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q))
          )
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: createMenuController
      })
    ]
  }
})
