/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import type { Node as PmNode } from '@tiptap/pm/model'
import {
  Audio,
  ButtonBlock,
  FileBlock,
  PageLink,
  SyncedBlock,
  TableOfContents,
  Video,
  type ButtonAttrs
} from '../../../shared/blocks'
import { assetKind, assetNameFromSrc } from '../../../shared/assets'
import { useStore } from '../store'
import { displaySrc } from '../platform'
import { PageSubEditor, SubEditor } from './SubEditor'
import { PageIcon } from '../components/PageIcon'
import { iconText } from '../icons'
import { t } from '../../../shared/i18n'

/** Atom blocks keep their own events (buttons, inputs, nested editors). */
const isolated = {
  stopEvent: ({ event }: { event: Event }) =>
    !(event.type.startsWith('drag') || event.type === 'drop')
}

const formatSize = (bytes: number): string =>
  bytes < 1024
    ? t('{n} o', { n: bytes })
    : bytes < 1024 * 1024
      ? t('{n} Ko', { n: Math.round(bytes / 1024) })
      : t('{n} Mo', { n: (bytes / 1024 / 1024).toFixed(1) })

// ---------------------------------------------------------------------------
// Table of contents

function TocView({ editor }: ReactNodeViewProps): React.JSX.Element {
  const [headings, setHeadings] = useState<{ level: number; text: string; pos: number }[]>([])
  useEffect(() => {
    const collect = (): void => {
      const out: { level: number; text: string; pos: number }[] = []
      editor.state.doc.descendants((node: PmNode, pos: number) => {
        if (node.type.name === 'heading')
          out.push({ level: node.attrs.level, text: node.textContent, pos })
      })
      setHeadings(out)
    }
    collect()
    editor.on('update', collect)
    return () => {
      editor.off('update', collect)
    }
  }, [editor])
  const go = (pos: number): void => {
    const dom = editor.view.nodeDOM(pos)
    if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <NodeViewWrapper className="toc" contentEditable={false}>
      {headings.length === 0 ? (
        <span className="toc-empty">
          {t('Ajoutez des titres pour remplir la table des matières.')}
        </span>
      ) : (
        headings.map((h) => (
          <button key={h.pos} className={`toc-item level-${h.level}`} onClick={() => go(h.pos)}>
            {h.text || t('Titre sans texte')}
          </button>
        ))
      )}
    </NodeViewWrapper>
  )
}

export const InteractiveTableOfContents = TableOfContents.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TocView, isolated)
  }
})

// ---------------------------------------------------------------------------
// Link to a page

function PageLinkView({ node }: ReactNodeViewProps): React.JSX.Element {
  const id = String(node.attrs.pageId ?? '')
  const page = useStore((s) => s.pages.find((p) => p.id === id))
  const open = useStore((s) => s.open)
  return (
    <NodeViewWrapper className="page-link-block" contentEditable={false}>
      {page && !page.trashedAt ? (
        <button onClick={() => open(id)}>
          <span className="page-link-icon">
            <PageIcon icon={page.icon} fallback={page.kind === 'database' ? '🗃️' : '📄'} />
          </span>
          <span className="page-link-title">{page.title || t('Sans titre')}</span>
        </button>
      ) : (
        <span className="page-link-missing">{t('↗ Page supprimée ou inaccessible')}</span>
      )}
    </NodeViewWrapper>
  )
}

export const InteractivePageLink = PageLink.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView, isolated)
  }
})

// ---------------------------------------------------------------------------
// Files and media

function FileView({ node }: ReactNodeViewProps): React.JSX.Element {
  const src = String(node.attrs.src ?? '')
  const name = String(node.attrs.name ?? t('Fichier'))
  const size = Number(node.attrs.size ?? 0)
  const showNotice = useStore((s) => s.showNotice)
  const isPdf = assetNameFromSrc(src)?.endsWith('.pdf')
  return (
    <NodeViewWrapper className="file-block" contentEditable={false}>
      <span className="file-icon">{isPdf ? '📕' : '📎'}</span>
      <span className="file-name">{name}</span>
      {size > 0 && <span className="file-size">{formatSize(size)}</span>}
      <button
        onClick={() =>
          void window.api.assets.download(src, name).catch((e) =>
            showNotice(
              t('Téléchargement impossible : {error}', {
                error: e instanceof Error ? e.message : String(e)
              })
            )
          )
        }
      >
        {t('Télécharger')}
      </button>
    </NodeViewWrapper>
  )
}

export const InteractiveFileBlock = FileBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FileView, isolated)
  }
})

function MediaView({ node }: ReactNodeViewProps): React.JSX.Element {
  const src = displaySrc(String(node.attrs.src ?? ''))
  return (
    <NodeViewWrapper className={`media-block ${node.type.name}`} contentEditable={false}>
      {node.type.name === 'video' ? (
        <video controls preload="metadata" src={src} />
      ) : (
        <audio controls preload="metadata" src={src} />
      )}
    </NodeViewWrapper>
  )
}

export const InteractiveVideo = Video.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MediaView, isolated)
  }
})
export const InteractiveAudio = Audio.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MediaView, isolated)
  }
})

/** Stores files and inserts them: videos and audios as players, others as file blocks. */
export async function insertFiles(
  editor: ReactNodeViewProps['editor'],
  files: File[],
  pos?: number
): Promise<void> {
  let at = pos
  for (const file of files) {
    try {
      const src = await window.api.assets.saveFile(
        new Uint8Array(await file.arrayBuffer()),
        file.name
      )
      const kind = assetKind(assetNameFromSrc(src) ?? '')
      const node =
        kind === 'image'
          ? { type: 'image', attrs: { src, alt: file.name.replace(/\.[^.]+$/, '') } }
          : kind === 'video' || kind === 'audio'
            ? { type: kind, attrs: { src } }
            : { type: 'fileBlock', attrs: { src, name: file.name, size: file.size } }
      if (at === undefined) editor.chain().focus().insertContent(node).run()
      else {
        editor.chain().insertContentAt(at, node).focus().run()
        at = editor.state.selection.to
      }
    } catch (e) {
      useStore.getState().showNotice(
        t('Fichier non ajouté ({name}) : {error}', {
          name: file.name,
          error: e instanceof Error ? e.message : String(e)
        })
      )
    }
  }
}

/** Opens the system file picker; `accept` narrows the types. */
export function pickFiles(editor: ReactNodeViewProps['editor'], accept = ''): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = accept
  input.onchange = () => {
    const files = [...(input.files ?? [])]
    if (files.length) void insertFiles(editor, files)
  }
  input.click()
}

// ---------------------------------------------------------------------------
// Synced block

function SyncedView({ node, editor, selected }: ReactNodeViewProps): React.JSX.Element {
  const sourceId = String(node.attrs.sourceId ?? '')
  const [copied, setCopied] = useState(false)
  return (
    <NodeViewWrapper className={`synced-block${selected ? ' selected' : ''}`}>
      <div className="synced-bar" contentEditable={false}>
        <span>{t('🔁 Bloc synchronisé')}</span>
        <button
          onClick={() => {
            // Copying the block and pasting it elsewhere shows the same content there.
            const html = `<div data-type="synced" data-source-id="${sourceId}"></div>`
            if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
              useStore
                .getState()
                .showNotice(
                  t(
                    'Copie directe indisponible ici : sélectionnez le bloc avec sa poignée ⋮⋮ puis Ctrl+C.'
                  )
                )
              return
            }
            void navigator.clipboard
              ?.write([
                new ClipboardItem({
                  'text/html': new Blob([html], { type: 'text/html' }),
                  'text/plain': new Blob([t('Bloc synchronisé')], { type: 'text/plain' })
                })
              ])
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          {copied ? t('Copié : collez-le dans une autre page') : t('Copier et synchroniser')}
        </button>
      </div>
      <PageSubEditor pageId={sourceId} editable={editor.isEditable} />
    </NodeViewWrapper>
  )
}

export const InteractiveSyncedBlock = SyncedBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(SyncedView, { ...isolated, ignoreMutation: () => true })
  }
})

// ---------------------------------------------------------------------------
// Button

function ButtonView({
  node,
  editor,
  getPos,
  updateAttributes
}: ReactNodeViewProps): React.JSX.Element {
  const attrs = node.attrs as ButtonAttrs
  const pages = useStore((s) => s.pages)
  const showNotice = useStore((s) => s.showNotice)
  const [configuring, setConfiguring] = useState(false)
  const databases = pages.filter((p) => p.kind === 'database' && !p.trashedAt)

  const press = async (): Promise<void> => {
    if (attrs.action === 'addRow') {
      if (!attrs.databaseId) return showNotice(t('Choisissez la base de données du bouton.'))
      try {
        await window.api.databases.createRow(attrs.databaseId, {})
        await useStore.getState().remoteChange()
        showNotice(t('Ligne ajoutée.'))
      } catch (e) {
        showNotice(
          t('Ajout impossible : {error}', { error: e instanceof Error ? e.message : String(e) })
        )
      }
      return
    }
    if (!editor.isEditable) return
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (pos === undefined) return
    let template: unknown
    try {
      template = JSON.parse(attrs.template)
    } catch {
      template = [{ type: 'paragraph' }]
    }
    editor
      .chain()
      .focus()
      .insertContentAt(pos + node.nodeSize, template as object[])
      .run()
  }

  return (
    <NodeViewWrapper className="button-block" contentEditable={false}>
      <button className="button-block-button" onClick={() => void press()}>
        {attrs.label || t('Bouton')}
      </button>
      {editor.isEditable && (
        <button
          className="button-block-settings"
          title={t('Configurer')}
          onClick={() => setConfiguring(!configuring)}
        >
          ⚙
        </button>
      )}
      {configuring && (
        <div className="button-config">
          <label>
            {t('Libellé')}
            <input
              value={attrs.label}
              onChange={(e) => updateAttributes({ label: e.target.value })}
            />
          </label>
          <label>
            {t('Action')}
            <select
              value={attrs.action}
              onChange={(e) =>
                updateAttributes({ action: e.target.value as ButtonAttrs['action'] })
              }
            >
              <option value="insert">{t('Insérer des blocs sous le bouton')}</option>
              <option value="addRow">{t('Ajouter une ligne à une base')}</option>
            </select>
          </label>
          {attrs.action === 'insert' ? (
            <div className="button-template">
              <span>{t('Blocs insérés :')}</span>
              <SubEditor
                editable
                content={{ type: 'doc', content: safeTemplate(attrs.template) }}
                onChange={(json) =>
                  updateAttributes({
                    template: JSON.stringify((json as { content?: unknown[] }).content ?? [])
                  })
                }
              />
            </div>
          ) : (
            <label>
              {t('Base de données')}
              <select
                value={attrs.databaseId ?? ''}
                onChange={(e) => updateAttributes({ databaseId: e.target.value || null })}
              >
                <option value="">{t('Choisir…')}</option>
                {databases.map((d) => (
                  <option key={d.id} value={d.id}>
                    {iconText(d.icon, '🗃️')} {d.title || t('Sans titre')}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button onClick={() => setConfiguring(false)}>{t('Fermer')}</button>
        </div>
      )}
    </NodeViewWrapper>
  )
}

function safeTemplate(raw: string): unknown[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) && v.length ? v : [{ type: 'paragraph' }]
  } catch {
    return [{ type: 'paragraph' }]
  }
}

export const InteractiveButtonBlock = ButtonBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ButtonView, { ...isolated, ignoreMutation: () => true })
  }
})

/** Every interactive block view, for the page editor. */
export const BLOCK_VIEWS = [
  InteractiveTableOfContents,
  InteractivePageLink,
  InteractiveFileBlock,
  InteractiveVideo,
  InteractiveAudio,
  InteractiveSyncedBlock,
  InteractiveButtonBlock
]
