import { getSchema } from '@tiptap/core'
import { DOMParser as SchemaParser, type Schema } from '@tiptap/pm/model'
import { createLowlight } from 'lowlight'
import MarkdownIt from 'markdown-it'
import { unzipSync } from 'fflate'
import { createDocumentExtensions } from '../../../shared/editorExtensions'
import type { PageId } from '../../../shared/types'
import { md5Hex } from './md5'

/** What an import of documents created, and what it left out. */
export interface DocumentImportSummary {
  pages: number
  images: number
  /** Images or attachments not taken (unreadable, absent, unsupported) */
  missing: number
  /** Files not recognised */
  skipped: string[]
  /** The first page created, to open it */
  firstId: PageId | null
}

/** The formats this import reads, for the file chooser. */
export const DOCUMENT_ACCEPT =
  '.docx,.html,.htm,.md,.markdown,.txt,.enex,.zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

let schema: Schema | null = null
const documentSchema = (): Schema =>
  (schema ??= getSchema(createDocumentExtensions(createLowlight())))

const baseName = (path: string): string =>
  (path.split('/').pop() ?? path)
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim() || 'Sans titre'

function base64Bytes(data: string): Uint8Array {
  const binary = atob(data.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Resolves an image of the source to a stored src; null drops it. */
type ImageResolver = (src: string) => Promise<string | null>

class Importer {
  readonly summary: DocumentImportSummary = {
    pages: 0,
    images: 0,
    missing: 0,
    skipped: [],
    firstId: null
  }

  /** Stores image bytes; null when the image is refused (the caller counts it). */
  async saveImage(bytes: Uint8Array, name: string): Promise<string | null> {
    try {
      const src = await window.api.assets.save(bytes, name)
      this.summary.images += 1
      return src
    } catch {
      return null
    }
  }

  /** Images inline (data:) are stored; web images stay links; others are dropped. */
  async resolveCommon(
    src: string,
    other: ImageResolver = async () => null
  ): Promise<string | null> {
    if (/^https?:\/\//i.test(src)) return src
    const data = /^data:(image\/[a-z+.-]+);base64,(.*)$/is.exec(src)
    const resolved = data
      ? await this.saveImage(base64Bytes(data[2]), `image.${data[1].split('/')[1]}`)
      : await other(src)
    if (resolved === null) this.summary.missing += 1
    return resolved
  }

  /**
   * Converts HTML to the editor's document: parsed inertly, images stored,
   * then read through the editor schema, which keeps only what it knows.
   */
  async htmlToContent(body: HTMLElement, resolve: ImageResolver): Promise<string> {
    body
      .querySelectorAll('script, style, link, meta, iframe, object, embed, noscript, form')
      .forEach((el) => el.remove())
    for (const img of Array.from(body.querySelectorAll('img'))) {
      const src = img.getAttribute('src') ?? ''
      const stored = src ? await this.resolveCommon(src, resolve) : null
      if (stored) img.setAttribute('src', stored)
      else img.remove()
    }
    body.querySelectorAll('a[href]').forEach((a) => {
      if (!/^(https?:|mailto:|notionix:)/i.test(a.getAttribute('href') ?? ''))
        a.removeAttribute('href')
    })
    const doc = SchemaParser.fromSchema(documentSchema()).parse(body)
    return JSON.stringify(doc.toJSON())
  }

  async createPage(
    parentId: PageId | null,
    title: string,
    content: string,
    icon?: string
  ): Promise<PageId> {
    const page = await window.api.pages.createWith(parentId, {
      title: title.slice(0, 500),
      content,
      ...(icon ? { icon } : {})
    })
    this.summary.pages += 1
    this.summary.firstId ??= page.id
    return page.id
  }

  /** A page from an HTML document; its first heading becomes the title when there is no <title>. */
  async htmlPage(
    parentId: PageId | null,
    html: string,
    fallbackTitle: string,
    resolve: ImageResolver = async () => null,
    pick?: (doc: Document) => { title: string | null; body: HTMLElement } | null
  ): Promise<PageId> {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const picked = pick?.(doc)
    let title = picked?.title ?? doc.title.trim()
    const body = picked?.body ?? doc.body
    const first = body.firstElementChild
    if (!title && first?.tagName === 'H1') {
      title = first.textContent?.trim() ?? ''
      first.remove()
    }
    return this.createPage(
      parentId,
      title || fallbackTitle,
      await this.htmlToContent(body, resolve)
    )
  }

  async docx(parentId: PageId | null, file: File): Promise<void> {
    const { default: mammoth } = await import('mammoth/mammoth.browser.min.js')
    const result = await mammoth.convertToHtml(
      { arrayBuffer: await file.arrayBuffer() },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const bytes = new Uint8Array(await image.readAsArrayBuffer())
          const src = await this.saveImage(
            bytes,
            `image.${image.contentType.split('/')[1] ?? 'png'}`
          )
          if (src === null) this.summary.missing += 1
          // A refused image has no src: it is dropped when the HTML is read.
          return { src: src ?? '' }
        })
      }
    )
    await this.htmlPage(parentId, result.value, baseName(file.name))
  }

  async markdown(parentId: PageId | null, text: string, name: string): Promise<void> {
    // Raw HTML in the Markdown is shown as text, not interpreted.
    const html = new MarkdownIt({ html: false, linkify: true }).render(text)
    await this.htmlPage(parentId, `<body>${html}</body>`, baseName(name))
  }

  async plainText(parentId: PageId | null, text: string, name: string): Promise<void> {
    const doc = document.implementation.createHTMLDocument('')
    for (const block of text.split(/\r?\n\s*\r?\n/)) {
      const p = doc.createElement('p')
      p.textContent = block.replace(/\r?\n/g, ' ').trim()
      if (p.textContent) doc.body.append(p)
    }
    await this.createPage(
      parentId,
      baseName(name),
      await this.htmlToContent(doc.body, async () => null)
    )
  }

  /**
   * Evernote export (.enex): each note becomes a page, with its images
   * (named in the note by the MD5 of their data) and its checkboxes.
   */
  async enex(parentId: PageId | null, text: string, name: string): Promise<void> {
    const xml = new DOMParser().parseFromString(text, 'application/xml')
    if (xml.querySelector('parsererror')) throw new Error(`${name} : fichier Evernote illisible.`)
    const notes = Array.from(xml.getElementsByTagName('note'))
    const parent =
      notes.length > 1
        ? await this.createPage(parentId, baseName(name), emptyDoc(), '🐘')
        : parentId
    for (const note of notes) {
      const title = note.getElementsByTagName('title')[0]?.textContent?.trim() || 'Sans titre'
      const resources = new Map<string, { bytes: Uint8Array; mime: string }>()
      for (const resource of Array.from(note.getElementsByTagName('resource'))) {
        const data = resource.getElementsByTagName('data')[0]?.textContent ?? ''
        const mime = resource.getElementsByTagName('mime')[0]?.textContent ?? ''
        const bytes = base64Bytes(data)
        resources.set(md5Hex(bytes), { bytes, mime })
      }
      const enml = note.getElementsByTagName('content')[0]?.textContent ?? ''
      const doc = new DOMParser().parseFromString(enml, 'text/html')
      const root = (doc.querySelector('en-note') as HTMLElement | null) ?? doc.body
      // Checkboxes: a line starting with <en-todo> becomes a to-do item.
      for (const todo of Array.from(root.querySelectorAll('en-todo'))) {
        const line = todo.parentElement
        const checked = todo.getAttribute('checked') === 'true'
        todo.remove()
        if (!line || line === root) continue
        const list = doc.createElement('ul')
        list.setAttribute('data-type', 'taskList')
        const item = doc.createElement('li')
        item.setAttribute('data-type', 'taskItem')
        item.setAttribute('data-checked', String(checked))
        const p = doc.createElement('p')
        p.append(...Array.from(line.childNodes))
        item.append(p)
        list.append(item)
        line.replaceWith(list)
      }
      for (const media of Array.from(root.querySelectorAll('en-media'))) {
        const resource = resources.get(media.getAttribute('hash') ?? '')
        if (resource?.mime.startsWith('image/')) {
          const img = doc.createElement('img')
          img.setAttribute('src', `enex:${media.getAttribute('hash')}`)
          media.replaceWith(img)
        } else {
          this.summary.missing += 1
          media.remove()
        }
      }
      const content = await this.htmlToContent(root, async (src) => {
        const resource = resources.get(src.replace(/^enex:/, ''))
        return resource
          ? this.saveImage(resource.bytes, `image.${resource.mime.split('/')[1]}`)
          : null
      })
      await this.createPage(parent, title, content)
    }
  }

  /**
   * A zip of HTML pages: Confluence's HTML export (its index.html gives the
   * page tree) or Google Docs' "Web page" download. Images come from the zip.
   */
  async htmlZip(parentId: PageId | null, file: File): Promise<void> {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    const decoder = new TextDecoder()
    const pages = Object.keys(entries).filter(
      (p) => /\.html?$/i.test(p) && !p.startsWith('__MACOSX')
    )
    if (!pages.length) throw new Error(`${file.name} : aucune page HTML dans l’archive.`)
    const index = pages.find((p) => /(^|\/)index\.html?$/i.test(p))
    const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1)
    const join = (dir: string, href: string): string => {
      const parts = (dir + decodeURIComponent(href.split(/[?#]/)[0])).split('/')
      const out: string[] = []
      for (const part of parts) {
        if (part === '..') out.pop()
        else if (part !== '.' && part !== '') out.push(part)
      }
      return out.join('/')
    }

    // Parent of each page, from the nested lists of the index (Confluence).
    const parentOf = new Map<string, string | null>()
    if (index) {
      const doc = new DOMParser().parseFromString(decoder.decode(entries[index]), 'text/html')
      for (const link of Array.from(doc.querySelectorAll('li > a[href]'))) {
        const path = join(dirOf(index), link.getAttribute('href') ?? '')
        if (!entries[path]) continue
        const outer = link.parentElement?.parentElement
          ?.closest('li')
          ?.querySelector(':scope > a[href]')
        parentOf.set(path, outer ? join(dirOf(index), outer.getAttribute('href') ?? '') : null)
      }
    }
    const order = pages.filter((p) => p !== index || pages.length === 1)
    // Parents before their children.
    const depth = (p: string, seen = 0): number => {
      const parent = parentOf.get(p)
      return parent && seen < 50 ? 1 + depth(parent, seen + 1) : 0
    }
    order.sort((a, b) => depth(a) - depth(b))

    const container =
      order.length > 1
        ? await this.createPage(parentId, baseName(file.name), emptyDoc(), '📚')
        : parentId
    const created = new Map<string, PageId>()
    for (const path of order) {
      const resolve: ImageResolver = async (src) => {
        const bytes = entries[join(dirOf(path), src)]
        return bytes ? this.saveImage(bytes, src.split('/').pop() ?? 'image') : null
      }
      const parentPath = parentOf.get(path)
      const parent = (parentPath && created.get(parentPath)) || container
      const html = decoder.decode(entries[path])
      const id = await this.htmlPage(parent, html, baseName(path), resolve, (doc) => {
        // Confluence: the page body, and its title without the space name.
        const main = doc.getElementById('main-content')
        if (!main) return null
        const title = doc.getElementById('title-text')?.textContent?.trim() ?? null
        return { title: title?.replace(/^[^:]+ : /, '') ?? null, body: main }
      })
      created.set(path, id)
    }
  }

  async file(parentId: PageId | null, file: File): Promise<void> {
    const ext = file.name.toLowerCase().split('.').pop() ?? ''
    if (ext === 'docx') return this.docx(parentId, file)
    if (ext === 'zip') return this.htmlZip(parentId, file)
    if (ext === 'enex') return this.enex(parentId, await file.text(), file.name)
    if (ext === 'html' || ext === 'htm') {
      await this.htmlPage(parentId, await file.text(), baseName(file.name))
      return
    }
    if (ext === 'md' || ext === 'markdown')
      return this.markdown(parentId, await file.text(), file.name)
    if (ext === 'txt') return this.plainText(parentId, await file.text(), file.name)
    this.summary.skipped.push(file.name)
  }
}

const emptyDoc = (): string => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })

/**
 * Imports documents from other tools as pages: Word (.docx, also Google Docs
 * downloaded as Word), HTML, Markdown, text, Evernote (.enex), Confluence or
 * Google Docs HTML exports (.zip). Everything is converted here, then created
 * like any page.
 */
export async function importDocuments(
  files: File[],
  parentId: PageId | null
): Promise<DocumentImportSummary> {
  const importer = new Importer()
  for (const file of files) await importer.file(parentId, file)
  return importer.summary
}
