/* eslint-disable react-refresh/only-export-components */
import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion, { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { pickImages } from './images'
import { pickFiles } from './blockViews'
import { useStore } from '../store'
import { t } from '../../../shared/i18n'

export interface SlashItem {
  title: string
  hint: string
  /** Shown before the title (mention menu) */
  icon?: string
  keywords: string[]
  run: (editor: Editor, range: Range) => void
}

const chain = (editor: Editor, range: Range): ReturnType<Editor['chain']> =>
  editor.chain().focus().deleteRange(range)

export const SLASH_ITEMS: SlashItem[] = [
  {
    title: t('Page'),
    hint: t('Sous-page dans cette page'),
    keywords: ['page', 'sous-page', 'subpage', 'new', 'nouvelle'],
    run: (e, r) => {
      chain(e, r).run()
      const { currentId, load, open } = useStore.getState()
      void window.api.pages
        .create(currentId)
        .then(async (page) => {
          e.chain().focus().insertPageLink(page.id).run()
          await load()
          // Like Notion: the new page opens, ready for its title.
          open(page.id)
        })
        .catch((err) =>
          useStore.getState().showNotice(
            t('Page non créée : {error}', {
              error: err instanceof Error ? err.message : String(err)
            })
          )
        )
    }
  },
  {
    title: t('Texte'),
    hint: t('Paragraphe simple'),
    keywords: ['text', 'texte', 'paragraph', 'paragraphe', 'p'],
    run: (e, r) => chain(e, r).setParagraph().run()
  },
  {
    title: t('Titre 1'),
    hint: t('Grand titre'),
    keywords: ['h1', 'heading', 'titre', 'title'],
    run: (e, r) => chain(e, r).setHeading({ level: 1 }).run()
  },
  {
    title: t('Titre 2'),
    hint: t('Titre moyen'),
    keywords: ['h2', 'heading', 'titre', 'title'],
    run: (e, r) => chain(e, r).setHeading({ level: 2 }).run()
  },
  {
    title: t('Titre 3'),
    hint: t('Petit titre'),
    keywords: ['h3', 'heading', 'titre', 'title'],
    run: (e, r) => chain(e, r).setHeading({ level: 3 }).run()
  },
  {
    title: t('Liste à puces'),
    hint: t('Liste simple'),
    keywords: ['bullet', 'ul', 'liste', 'list', 'puces'],
    run: (e, r) => chain(e, r).toggleBulletList().run()
  },
  {
    title: t('Liste numérotée'),
    hint: t('Liste ordonnée'),
    keywords: ['number', 'ol', 'liste', 'list', 'numerotee', 'numbered'],
    run: (e, r) => chain(e, r).toggleOrderedList().run()
  },
  {
    title: t('Liste de tâches'),
    hint: t('Cases à cocher'),
    keywords: ['todo', 'task', 'checkbox', 'tache', 'liste', 'list'],
    run: (e, r) => chain(e, r).toggleTaskList().run()
  },
  {
    title: t('Citation'),
    hint: t('Bloc de citation'),
    keywords: ['quote', 'blockquote', 'citation'],
    run: (e, r) => chain(e, r).toggleBlockquote().run()
  },
  {
    title: t('Code'),
    hint: t('Bloc de code'),
    keywords: ['code', 'snippet'],
    run: (e, r) => chain(e, r).toggleCodeBlock().run()
  },
  {
    title: t('Image'),
    hint: t('Depuis un fichier'),
    keywords: ['image', 'photo', 'picture', 'img'],
    run: (e, r) => {
      chain(e, r).run()
      pickImages(e)
    }
  },
  {
    title: t('Tableau'),
    hint: t('Lignes et colonnes'),
    keywords: ['table', 'tableau', 'grille', 'grid'],
    run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  },
  {
    title: t('Toggle'),
    hint: t('Contenu repliable'),
    keywords: ['toggle', 'details', 'replier', 'accordeon', 'collapse', 'accordion'],
    run: (e, r) => chain(e, r).setDetails().run()
  },
  {
    title: t('Callout'),
    hint: t('Encadré avec icône'),
    keywords: ['callout', 'encadre', 'note', 'aside'],
    run: (e, r) => chain(e, r).setCallout().run()
  },
  {
    title: t('Base de données'),
    hint: t('Base affichée dans la page'),
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
    title: t('Vue liée de base de données'),
    hint: t('Une base existante, avec ses propres vues'),
    keywords: ['linked', 'vue', 'liee', 'base', 'database', 'view'],
    run: (e, r) => {
      chain(e, r).run()
      useStore
        .getState()
        .pickPage(
          t('Vue liée : choisir une base de données'),
          (id) => e.chain().focus().insertLinkedView(id).run(),
          'database'
        )
    }
  },
  {
    title: t('Équation'),
    hint: t('Bloc LaTeX'),
    keywords: ['equation', 'math', 'latex', 'formule', 'formula', 'tex'],
    run: (e, r) => {
      chain(e, r).run()
      window.dispatchEvent(new CustomEvent('notionix:insert-math', { detail: false }))
    }
  },
  {
    title: t('Équation en ligne'),
    hint: t('LaTeX dans le texte'),
    keywords: ['inline', 'math', 'latex', 'formule', 'formula', 'equation'],
    run: (e, r) => {
      chain(e, r).run()
      window.dispatchEvent(new CustomEvent('notionix:insert-math', { detail: true }))
    }
  },
  {
    title: t('Séparateur'),
    hint: t('Ligne horizontale'),
    keywords: ['divider', 'hr', 'separateur', 'separator', 'line'],
    run: (e, r) => chain(e, r).setHorizontalRule().run()
  },
  {
    title: t('2 colonnes'),
    hint: t('Blocs côte à côte'),
    keywords: ['columns', 'colonnes', 'layout'],
    run: (e, r) => chain(e, r).insertColumns(2).run()
  },
  {
    title: t('3 colonnes'),
    hint: t('Blocs côte à côte'),
    keywords: ['columns', 'colonnes', 'layout'],
    run: (e, r) => chain(e, r).insertColumns(3).run()
  },
  ...[1, 2, 3].map((level): SlashItem => ({
    title: t('Titre {level} repliable', { level }),
    hint: t('Titre qui replie son contenu'),
    keywords: ['toggle', 'heading', 'titre', 'repliable', 'title', 'collapsible', `h${level}`],
    run: (e, r) => chain(e, r).setDetails().setToggleHeading(level).run()
  })),
  {
    title: t('Table des matières'),
    hint: t('Titres de la page'),
    keywords: ['toc', 'sommaire', 'table', 'matieres', 'contents'],
    run: (e, r) => chain(e, r).insertTableOfContents().run()
  },
  {
    title: t('Lien vers une page'),
    hint: t('Bloc menant à une autre page'),
    keywords: ['link', 'page', 'lien'],
    run: (e, r) => {
      chain(e, r).run()
      useStore
        .getState()
        .pickPage(t('Lien vers une page'), (id) => e.chain().focus().insertPageLink(id).run())
    }
  },
  {
    title: t('Fichier'),
    hint: t('PDF, document, archive…'),
    keywords: ['file', 'fichier', 'pdf', 'piece', 'jointe', 'attachment'],
    run: (e, r) => {
      chain(e, r).run()
      pickFiles(e)
    }
  },
  {
    title: t('Vidéo'),
    hint: t('Lecteur vidéo'),
    keywords: ['video', 'film', 'mp4', 'movie'],
    run: (e, r) => {
      chain(e, r).run()
      pickFiles(e, 'video/*')
    }
  },
  {
    title: t('Audio'),
    hint: t('Lecteur audio'),
    keywords: ['audio', 'son', 'mp3', 'musique', 'sound', 'music'],
    run: (e, r) => {
      chain(e, r).run()
      pickFiles(e, 'audio/*')
    }
  },
  {
    title: t('Bloc synchronisé'),
    hint: t('Même contenu à plusieurs endroits'),
    keywords: ['synced', 'synchronise', 'sync', 'reutiliser', 'reuse'],
    run: (e, r) => {
      chain(e, r).run()
      const parentId = useStore.getState().currentId
      void window.api.pages
        .create(parentId, undefined, 'synced')
        .then((page) => e.chain().focus().insertSyncedBlock(page.id).run())
        .catch((err) =>
          useStore.getState().showNotice(
            t('Bloc non créé : {error}', {
              error: err instanceof Error ? err.message : String(err)
            })
          )
        )
    }
  },
  {
    title: t('Bouton'),
    hint: t('Insère des blocs ou ajoute une ligne'),
    keywords: ['button', 'bouton', 'action'],
    run: (e, r) => chain(e, r).insertButtonBlock().run()
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
        <div className="slash-empty">{t('Aucun résultat')}</div>
      </div>
    )
  }
  return (
    <div className="slash-menu">
      {items.map((item, i) => (
        <button
          key={`${item.title}-${i}`}
          className={i === selected ? 'slash-item active' : 'slash-item'}
          onMouseEnter={() => onHover(i)}
          // Keeping the focus in the editor: a blur would close the menu before the click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(i)}
        >
          <span className="slash-title">
            {item.icon && <span className="slash-icon">{item.icon}</span>}
            {item.title}
          </span>
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
export function createMenuController(): ReturnType<
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
