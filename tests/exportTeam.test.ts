import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { migrate } from '../src/core/db/database'
import { PageRepository } from '../src/core/db/pageRepository'
import { DatabaseRepository } from '../src/core/db/databaseRepository'
import { AssetStore } from '../src/core/assets'
import { buildMarkdownArchive } from '../src/core/transfer/markdownExport'
import { unzipSync, strFromU8 } from 'fflate'
import { fileValue } from '../src/shared/database'

const doc = (...content: unknown[]): string => JSON.stringify({ type: 'doc', content })
const p = (text: string): unknown => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('Markdown export of the team blocks', () => {
  it('writes synced content, the table of contents, buttons, people and files', async () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const pages = new PageRepository(db)
    const dbs = new DatabaseRepository(pages)
    const assets = new AssetStore(mkdtempSync(join(tmpdir(), 'nx-assets-')))

    const page = pages.createWith(null, { title: 'Guide' })
    const synced = pages.create(page.id, 'inherit', 'synced')
    pages.update(synced.id, { content: doc(p('Texte partagé')) })
    pages.update(page.id, {
      content: doc(
        { type: 'tableOfContents' },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Étape 1' }] },
        { type: 'syncedBlock', attrs: { sourceId: synced.id } },
        {
          type: 'buttonBlock',
          attrs: { label: 'Nouvelle tâche', action: 'insert', template: '[]' }
        },
        { type: 'syncedBlock', attrs: { sourceId: 'disparu' } }
      )
    })

    const base = dbs.create(page.id)
    pages.update(base.id, { title: 'Suivi' })
    const schema = dbs.schemaOf(base.id)!
    dbs.updateSchema(base.id, {
      ...schema,
      properties: [
        ...schema.properties,
        { id: 'who', name: 'Responsable', type: 'person' },
        { id: 'doc', name: 'Pièces', type: 'files' }
      ]
    })
    const src = await assets.saveFile(new TextEncoder().encode('%PDF-1.4'), 'devis.pdf')
    dbs.createRow(base.id, {
      title: 'Ligne',
      properties: { who: ['u1'], doc: [fileValue(src, 'Devis.pdf')] }
    })

    const archive = await buildMarkdownArchive(pages, dbs, assets, page.id, [
      { id: 'u1', name: 'Marie Dupont', email: 'marie@example.com' }
    ])
    const files = unzipSync(archive.bytes)
    const guide = strFromU8(files['Guide.md'])
    expect(guide).toContain('- Étape 1')
    expect(guide).toContain('Texte partagé')
    expect(guide).toContain('**Nouvelle tâche**')
    // The hidden page of the synced block is not a page of its own.
    expect(Object.keys(files).some((f) => f.includes('Sans titre'))).toBe(false)
    const csv = strFromU8(files['Guide/Suivi.csv'])
    expect(csv).toContain('Marie Dupont')
    expect(csv).toMatch(/Devis\.pdf \(Suivi\/[0-9a-f]{64}\.pdf\)/)
    expect(Object.keys(files).some((f) => /^Guide\/Suivi\/[0-9a-f]{64}\.pdf$/.test(f))).toBe(true)
    const row = strFromU8(files['Guide/Suivi/Ligne.md'])
    expect(row).toContain('Responsable: Marie Dupont')
  })
})
