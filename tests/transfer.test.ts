import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../src/main/db/database'
import { PageRepository } from '../src/main/db/pageRepository'
import { canonicalDoc } from '../src/main/transfer/canonicalDoc'
import { docToMarkdown } from '../src/main/transfer/docToMarkdown'
import { exportPagesAsMarkdown, zipMarkdown } from '../src/main/transfer/markdownExport'
import { markdownToDoc, newStats, type JsonNode } from '../src/main/transfer/markdownToDoc'
import {
  importNotionExport,
  planNotionImport,
  splitFrontMatter
} from '../src/main/transfer/notionImport'
import { parseNotionName, resolveRelative } from '../src/main/transfer/notionNames'
import type { Page, PageSummary } from '../src/shared/types'
import type { SourceFile } from '../src/main/transfer/sources'
import { AssetStore } from '../src/main/assets'

const ID_A = 'a'.repeat(32)
const ID_B = 'b'.repeat(32)
const ID_C = 'c'.repeat(32)
const ID_DB = 'd'.repeat(32)
const ID_ROW = 'e'.repeat(32)

const noLinks = (): undefined => undefined
const convert = (
  md: string,
  resolve: (h: string) => string | undefined = noLinks
): { doc: JsonNode; stats: ReturnType<typeof newStats> } => {
  const stats = newStats()
  const doc = markdownToDoc(md, resolve, stats)
  const canonical = canonicalDoc(doc)
  expect(canonical, 'document must satisfy the editor schema').not.toBeNull()
  return { doc: canonical!, stats }
}
const flat = (node: JsonNode): string =>
  node.text ?? (node.content ?? []).map(flat).join(node.type === 'doc' ? '\n' : '')

describe('Notion names', () => {
  it('splits title and id, keeps id-less names', () => {
    expect(parseNotionName(`Ma page ${ID_A}`)).toEqual({ title: 'Ma page', id: ID_A })
    expect(parseNotionName('Sans id')).toEqual({ title: 'Sans id', id: null })
    expect(parseNotionName(`X ${ID_A.toUpperCase()}`).id).toBe(ID_A)
  })
  it('resolves relative links without escaping the export', () => {
    expect(resolveRelative('A 1', 'B%20x%C3%A9.md')).toBe('A 1/B xé.md')
    expect(resolveRelative('A/B', '../C.md')).toBe('A/C.md')
    expect(resolveRelative('A', '../../x.md')).toBeNull()
    expect(resolveRelative('A', 'x.md#frag')).toBe('A/x.md')
  })
})

describe('markdownToDoc', () => {
  it('converts blocks and orders marks for the schema', () => {
    const { doc } = convert(
      '# Titre\n\nUn **gras *et italique*** et `code` ~~barré~~.\n\n---\n\n> citation\n\n```ts\nconst a = 1\n```\n'
    )
    expect(doc.content?.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'horizontalRule',
      'blockquote',
      'codeBlock'
    ])
    const para = doc.content![1].content!
    expect(para.find((n) => n.text === 'et italique')?.marks?.map((m) => m.type)).toEqual([
      'bold',
      'italic'
    ])
    expect(doc.content![4].attrs?.language).toBe('ts')
  })

  it('builds task lists only when every item is a task, otherwise keeps the markers as text', () => {
    const tasks = convert('- [ ] a\n- [x] b\n').doc.content![0]
    expect(tasks.type).toBe('taskList')
    expect(tasks.content?.map((i) => i.attrs?.checked)).toEqual([false, true])
    const mixed = convert('- [ ] a\n- b\n').doc.content![0]
    expect(mixed.type).toBe('bulletList')
    expect(flat(mixed)).toContain('[ ] a')
  })

  it('keeps nested and ordered lists', () => {
    const doc = convert('3. trois\n   - sous-point\n4. quatre\n').doc
    const list = doc.content![0]
    expect(list.type).toBe('orderedList')
    expect(list.attrs?.start).toBe(3)
    expect(list.content![0].content?.map((n) => n.type)).toEqual(['paragraph', 'bulletList'])
  })

  it('maps callouts to callout blocks with their icon, in both Notion layouts', () => {
    const callout = convert('<aside>\n💡 Astuce\n\nSuite\n\n</aside>\n').doc.content![0]
    expect(callout.type).toBe('callout')
    expect(callout.attrs?.icon).toBe('💡')
    expect(flat(callout)).toBe('AstuceSuite')
    const compact = convert('<aside>\n⚠️ Sur un seul bloc\n</aside>\n').doc.content![0]
    expect(compact).toMatchObject({ type: 'callout', attrs: { icon: '⚠️' } })
    expect(flat(compact)).toBe('Sur un seul bloc')
    const plain = convert('<aside>\nSans icône\n</aside>\n').doc.content![0]
    expect(plain.attrs?.icon).toBeUndefined() // the schema default (💡) applies
  })

  it('maps toggles to details blocks, including nested ones', () => {
    const doc = convert(
      '<details>\n<summary>Plus</summary>\n\nCorps\n\n<details>\n<summary>Encore</summary>\n\nFond\n\n</details>\n\n</details>\n\nAprès\n'
    ).doc
    const toggle = doc.content![0]
    expect(toggle.type).toBe('details')
    expect(toggle.content?.map((n) => n.type)).toEqual(['detailsSummary', 'detailsContent'])
    expect(flat(toggle.content![0])).toBe('Plus')
    const inner = toggle.content![1].content!
    expect(inner.map((n) => n.type)).toEqual(['paragraph', 'details'])
    expect(flat(inner[1])).toBe('EncoreFond')
    expect(flat(doc.content![1])).toBe('Après')
  })

  it('builds real tables and image blocks', () => {
    const { doc } = convert('| a | **b** |\n| - | - |\n| 1 | 2 |\n\nAvant ![alt](img.png) après\n')
    const table = doc.content![0]
    expect(table.type).toBe('table')
    expect(table.content!.map((row) => row.content!.map((c) => c.type))).toEqual([
      ['tableHeader', 'tableHeader'],
      ['tableCell', 'tableCell']
    ])
    expect(flat(table.content![1])).toBe('12')
    expect(doc.content!.slice(1).map((n) => n.type)).toEqual(['paragraph', 'image', 'paragraph'])
    expect(doc.content![2].attrs).toMatchObject({ src: 'img.png', alt: 'alt' })
  })

  it('resolves page links, keeps http(s) links and drops unsafe or unresolved ones', () => {
    const resolve = (h: string): string | undefined =>
      h === 'Autre.md' ? 'notionix://page/p1' : undefined
    const { doc, stats } = convert(
      '[interne](Autre.md) [web](https://example.com) [mal](javascript:alert(1)) [perdu](Absent.md)\n',
      resolve
    )
    const links = (doc.content![0].content ?? []).filter((n) =>
      n.marks?.some((m) => m.type === 'link')
    )
    expect(links.map((n) => n.marks?.find((m) => m.type === 'link')?.attrs?.href)).toEqual([
      'notionix://page/p1',
      'https://example.com'
    ])
    expect(flat(doc)).toContain('mal')
    expect(flat(doc)).toContain('perdu')
    expect(stats.linksResolved).toBe(1)
    expect(stats.linksUnresolved).toBe(1)
  })

  it('never fails on empty or odd input', () => {
    expect(convert('').doc.content).toEqual([{ type: 'paragraph' }])
    expect(() => convert('<div><b>x</b></div>\n\n- \n\n1.\n')).not.toThrow()
  })
})

describe('splitFrontMatter', () => {
  it('extracts the title and database properties', () => {
    expect(
      splitFrontMatter('# Ma ligne\n\nStatut: En cours\nURL: https://x.y\n\nCorps\n', true)
    ).toEqual({
      title: 'Ma ligne',
      body: '**Statut :** En cours\n\n**URL :** https://x.y\n\n\nCorps\n'
    })
  })
  it('leaves normal pages alone', () => {
    expect(splitFrontMatter('# T\n\nNote: texte\n', false).body).toContain('Note: texte')
  })
})

const file = (path: string, content: string | Uint8Array): SourceFile => {
  const buf = Buffer.from(content)
  return { path, size: buf.length, read: async () => buf }
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

const exportFiles = (): Record<string, string | Uint8Array> => ({
  [`Accueil ${ID_A}.md`]: `# Accueil\n\nVoir [Détails](Accueil%20${ID_A}/D%C3%A9tails%20${ID_B}.md) et [Projets](Projets%20${ID_DB}.csv).\n\n- [ ] faire\n- [x] fait\n`,
  [`Accueil ${ID_A}/Détails ${ID_B}.md`]: `# Détails\n\n<aside>\n💡 Note\n\n</aside>\n\n![x](img.png)\n\n![web](https://example.com/a.png)\n\n![absent](absent.png)\n`,
  [`Accueil ${ID_A}/img.png`]: PNG,
  [`Projets ${ID_DB}_all.csv`]: 'Name,Status\nRow,Todo\n',
  [`Projets ${ID_DB}.csv`]: 'Name,Status\nRow,Todo\n',
  [`Projets ${ID_DB}/Row ${ID_ROW}.md`]: `# Row\n\nStatus: Todo\n\nContenu de la ligne\n`,
  [`Dossier orphelin/Libre ${ID_C}.md`]: '# Libre\n\ntexte\n'
})

describe('planNotionImport', () => {
  it('builds the tree: sub-pages, database rows, containers; stores images', async () => {
    const files = Object.entries(exportFiles()).map(([p, c]) => file(p, c))
    const saved: string[] = []
    const plan = await planNotionImport(files, {
      existingIdForSource: () => undefined,
      saveAsset: async (_bytes, name) => {
        saved.push(name)
        return `notionix-asset://file/${'0'.repeat(64)}.png`
      }
    })
    expect(saved).toEqual(['img.png'])
    const byTitle = Object.fromEntries(plan.nodes.map((n) => [n.title, n]))
    expect(Object.keys(byTitle).sort((a, b) => a.localeCompare(b))).toEqual([
      'Accueil',
      'Détails',
      'Dossier orphelin',
      'Libre',
      'Projets',
      'Row'
    ])
    expect(byTitle['Détails'].parentKey).toBe(byTitle['Accueil'].key)
    expect(byTitle['Row'].parentKey).toBe(byTitle['Projets'].key)
    expect(byTitle['Projets'].kind).toBe('database')
    expect(byTitle['Libre'].parentKey).toBe('Dossier orphelin')
    expect(byTitle['Dossier orphelin'].kind).toBe('container')
    expect(byTitle['Accueil'].parentKey).toBeNull()
    expect(plan.attachmentsIgnored).toBe(0)
    expect(plan.databases).toBe(1)
    expect(plan.linksResolved).toBe(2)
    expect(plan.imagesImported).toBe(1)
    expect(plan.imagesMissing).toBe(2) // the remote one and the absent one
    const details = JSON.parse(byTitle['Détails'].content) as JsonNode
    expect(details.content!.map((n) => n.type)).toEqual(['callout', 'image', 'paragraph'])
    expect(flat(details.content![2])).toBe('Image distante : https://example.com/a.png')
    // parents always come before their children
    const index = new Map(plan.nodes.map((n, i) => [n.key, i]))
    for (const n of plan.nodes)
      if (n.parentKey) expect(index.get(n.parentKey)!).toBeLessThan(index.get(n.key)!)
    const row = JSON.parse(byTitle['Row'].content) as JsonNode
    expect(flat(row)).toContain('Status :')
  })
})

describe('importNotionExport', () => {
  let repo: PageRepository
  beforeEach(() => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')
    migrate(db)
    repo = new PageRepository(db)
  })
  const dir = (): string => mkdtempSync(join(tmpdir(), 'nx-test-'))
  const zipOf = (files: Record<string, string | Uint8Array>): Uint8Array =>
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])
      )
    )
  let assets: AssetStore
  beforeEach(() => {
    assets = new AssetStore(join(dir(), 'assets'))
  })

  it('imports a zip, links pages, searches content, and is idempotent', async () => {
    const root = dir()
    const zip = join(root, 'export.zip')
    writeFileSync(zip, zipOf({ ...exportFiles(), '__MACOSX/._x': 'junk' }))
    const first = await importNotionExport(repo, zip, assets, new Date('2026-10-14T10:00:00Z'))
    expect(first).toMatchObject({
      created: 7,
      skipped: 0,
      databases: 1,
      attachmentsIgnored: 0,
      imagesImported: 1,
      imagesMissing: 2,
      linksResolved: 2
    })
    const pages = repo.list()
    const container = pages.find((p) => p.id === first.containerId)!
    expect(container.title).toBe('Importé de Notion (2026-10-14)')
    const accueil = pages.find((p) => p.title === 'Accueil')!
    const details = pages.find((p) => p.title === 'Détails')!
    expect(accueil.parentId).toBe(container.id)
    expect(details.parentId).toBe(accueil.id)
    expect(repo.get(accueil.id)!.content).toContain(`notionix://page/${details.id}`)
    expect(repo.search('Contenu de la ligne').map((h) => h.title)).toEqual(['Row'])
    const src = /notionix-asset:\/\/file\/[0-9a-f]{64}\.png/.exec(repo.get(details.id)!.content)![0]
    expect(await assets.read(src)).toEqual(new Uint8Array(PNG))

    const second = await importNotionExport(repo, zip, assets)
    expect(second).toMatchObject({ created: 0, skipped: 6, containerId: null })
    expect(repo.list()).toHaveLength(pages.length)
  })

  it('attaches new pages of a later export to the pages already imported', async () => {
    const root = dir()
    const zip1 = join(root, 'one.zip')
    writeFileSync(zip1, zipOf({ [`Accueil ${ID_A}.md`]: '# Accueil\n\nv1\n' }))
    await importNotionExport(repo, zip1, assets)
    const zip2 = join(root, 'two.zip')
    writeFileSync(
      zip2,
      zipOf({
        [`Accueil ${ID_A}.md`]: '# Accueil\n\nv2\n',
        [`Accueil ${ID_A}/Nouvelle ${ID_B}.md`]: '# Nouvelle\n\nnouveau\n'
      })
    )
    const result = await importNotionExport(repo, zip2, assets)
    expect(result).toMatchObject({ created: 1, skipped: 1 })
    const pages = repo.list()
    const accueil = pages.find((p) => p.title === 'Accueil')!
    expect(pages.find((p) => p.title === 'Nouvelle')!.parentId).toBe(accueil.id)
    expect(repo.get(accueil.id)!.content).toContain('v1') // existing pages are never overwritten
  })

  it('reads part archives nested inside the main zip and extracted folders', async () => {
    const root = dir()
    const part1 = zipOf({ [`A ${ID_A}.md`]: '# A\n\none\n' })
    const part2 = zipOf({ [`B ${ID_B}.md`]: '# B\n\ntwo\n' })
    const outer = join(root, 'outer.zip')
    writeFileSync(outer, zipSync({ 'Export-1-Part-1.zip': part1, 'Export-1-Part-2.zip': part2 }))
    const nested = await importNotionExport(repo, outer, assets)
    expect(nested.created).toBe(3) // container + A + B

    const folder = join(root, 'extracted')
    for (const [p, c] of Object.entries({
      [`C ${ID_C}/Sub ${ID_ROW}.md`]: '# Sub\n\nx\n',
      [`C ${ID_C}.md`]: '# C\n'
    })) {
      mkdirSync(dirname(join(folder, p)), { recursive: true })
      writeFileSync(join(folder, p), c)
    }
    const fromDir = await importNotionExport(repo, folder, assets)
    expect(fromDir.created).toBe(3)
    expect(repo.list().find((p) => p.title === 'Sub')!.parentId).toBe(
      repo.list().find((p) => p.title === 'C')!.id
    )
  })

  it('rejects a file that is not a zip', async () => {
    const bad = join(dir(), 'not-a.zip')
    writeFileSync(bad, 'hello')
    await expect(importNotionExport(repo, bad, assets)).rejects.toThrow()
    expect(repo.list()).toHaveLength(0)
  })
})

describe('Markdown export', () => {
  const richDoc: JsonNode = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Titre #1' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Du ' },
          { type: 'text', text: 'gras', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' et ' },
          {
            type: 'text',
            text: 'lien',
            marks: [{ type: 'link', attrs: { href: 'https://example.com/a_(b)' } }]
          },
          { type: 'text', text: ' * étoile _ souligné [crochets] <b>' }
        ]
      },
      { type: 'paragraph', content: [{ type: 'text', text: '- pas une liste' }] },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'un' }] },
              {
                type: 'orderedList',
                attrs: { start: 1 },
                content: [
                  {
                    type: 'listItem',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'sous' }] }]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'fait' }] }]
          }
        ]
      },
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cité' }] }]
      },
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [{ type: 'text', text: 'const x = "```"' }]
      },
      { type: 'horizontalRule' },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'un' }] }]
          }
        ]
      },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'autre liste' }] }]
          }
        ]
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nom' }] }]
              },
              {
                type: 'tableHeader',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'a | b', marks: [{ type: 'bold' }] }]
                  }
                ]
              }
            ]
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }]
              },
              { type: 'tableCell', content: [{ type: 'paragraph' }] }
            ]
          }
        ]
      },
      {
        type: 'callout',
        attrs: { icon: '⚠️' },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Attention', marks: [{ type: 'italic' }] }]
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'point' }] }]
              }
            ]
          }
        ]
      },
      {
        type: 'details',
        content: [
          { type: 'detailsSummary', content: [{ type: 'text', text: 'Plus <de> détails' }] },
          {
            type: 'detailsContent',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'caché' }] }]
          }
        ]
      },
      {
        type: 'image',
        attrs: { src: 'notionix-asset://file/' + 'a'.repeat(64) + '.png', alt: 'logo' }
      }
    ]
  }

  it('round-trips a rich document through Markdown', () => {
    const md = docToMarkdown(
      richDoc,
      () => null,
      (src) => src
    )
    const back = canonicalDoc(markdownToDoc(md, noLinks, newStats()))!
    const want = canonicalDoc(richDoc)!
    expect(JSON.stringify(strip(back))).toBe(JSON.stringify(strip(want)))
  })

  it('exports a page tree like Notion does, with relative links, images and unique names', async () => {
    const t = 1
    const mk = (
      id: string,
      parentId: string | null,
      title: string,
      position: number
    ): PageSummary => ({
      id,
      parentId,
      title,
      icon: null,
      cover: null,
      position,
      favorite: false,
      trashedAt: null,
      createdAt: t,
      updatedAt: t,
      version: 1,
      kind: 'page',
      isTemplate: false
    })
    const summaries = [
      mk('1', null, 'Accueil', 1),
      mk('2', '1', 'Détails / suite', 1),
      mk('3', null, 'Accueil', 2),
      mk('4', '1', 'Libre', 2)
    ]
    const docs: Record<string, JsonNode> = {
      '1': {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'vers',
                marks: [{ type: 'link', attrs: { href: 'notionix://page/2' } }]
              }
            ]
          }
        ]
      },
      '2': {
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: 'notionix-asset://file/' + 'a'.repeat(64) + '.png' } },
          { type: 'image', attrs: { src: 'notionix-asset://file/' + 'b'.repeat(64) + '.png' } },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'retour',
                marks: [{ type: 'link', attrs: { href: 'notionix://page/3' } }]
              }
            ]
          }
        ]
      }
    }
    const image = new Uint8Array([1, 2, 3])
    const { files, attachments } = await exportPagesAsMarkdown(
      summaries,
      (id) =>
        ({
          ...summaries.find((s) => s.id === id),
          content: JSON.stringify(docs[id] ?? { type: 'doc' })
        }) as unknown as Page,
      async (src) => (src.includes('a'.repeat(64)) ? image : null), // the second file is missing
      null
    )
    const assetName = 'a'.repeat(64) + '.png'
    expect(attachments).toEqual([{ path: `Accueil/Détails - suite/${assetName}`, bytes: image }])
    expect(files[1].markdown).toContain(`![](D%C3%A9tails%20-%20suite/${assetName})`)
    expect(files[1].markdown).not.toContain('b'.repeat(64))
    expect(files.map((f) => f.path)).toEqual([
      'Accueil.md',
      'Accueil/Détails - suite.md',
      'Accueil/Libre.md',
      'Accueil (2).md'
    ])
    expect(files[0].markdown).toContain('[vers](Accueil/D%C3%A9tails%20-%20suite.md)')
    expect(files[1].markdown).toContain('[retour](../Accueil%20(2).md)')
    const unzipped = unzipSync(zipMarkdown(files, attachments))
    expect(Object.keys(unzipped)).toContain('Accueil/Détails - suite.md')
    expect(unzipped[`Accueil/Détails - suite/${assetName}`]).toEqual(image)
  })
})

const strip = (n: JsonNode): JsonNode => {
  const { attrs, ...rest } = n
  const out: JsonNode = { ...rest }
  if (attrs?.level) out.attrs = { level: attrs.level }
  if (n.type === 'orderedList') out.attrs = { start: attrs?.start }
  if (n.type === 'callout') out.attrs = { icon: attrs?.icon }
  if (n.type === 'image') out.attrs = { src: attrs?.src, alt: attrs?.alt }
  if (n.type === 'taskItem') out.attrs = { checked: attrs?.checked }
  if (n.type === 'link') out.attrs = attrs
  if (n.content) out.content = n.content.map(strip)
  return out
}

describe('AssetStore', () => {
  const store = (): AssetStore =>
    new AssetStore(join(mkdtempSync(join(tmpdir(), 'nx-assets-')), 'a'))

  it('stores an image once under its content hash and reads it back', async () => {
    const s = store()
    const src = await s.save(new Uint8Array(PNG), 'photo.jpeg')
    expect(src).toMatch(/^notionix-asset:\/\/file\/[0-9a-f]{64}\.png$/) // type comes from the bytes
    expect(await s.save(new Uint8Array(PNG), 'autre.png')).toBe(src)
    expect(await s.read(src)).toEqual(new Uint8Array(PNG))
  })

  it('rejects non-images and never resolves names outside the store', async () => {
    const s = store()
    await expect(s.save(strToU8('<script>alert(1)</script>'), 'x.png')).rejects.toThrow(
      /non pris en charge/
    )
    expect(
      await s.save(strToU8('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'i.svg')
    ).toMatch(/\.svg$/)
    expect(s.pathOf('../../etc/passwd')).toBeNull()
    expect(s.pathOf(`${'0'.repeat(64)}.png`)).toBeNull()
    expect(await s.read('https://example.com/x.png')).toBeNull()
  })
})
