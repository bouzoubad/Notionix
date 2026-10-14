import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseCsv, stringifyCsv } from '../src/main/transfer/csv'
import { inferDatabase, splitLinkedCell } from '../src/main/transfer/notionDatabase'
import { migrate } from '../src/main/db/database'
import { PageRepository } from '../src/main/db/pageRepository'
import { DatabaseRepository } from '../src/main/db/databaseRepository'
import { importNotionExport } from '../src/main/transfer/notionImport'
import { AssetStore } from '../src/main/assets'
import { displayValue, type PropertyDef } from '../src/shared/database'
import { exportPagesAsMarkdown, zipMarkdown } from '../src/main/transfer/markdownExport'

describe('CSV', () => {
  it('parses quotes, commas, line breaks and a BOM, and round-trips', () => {
    const text = '﻿Name,Notes\r\n"A, B","dit ""oui""\nsur deux lignes"\r\nC,\r\n'
    const rows = parseCsv(text)
    expect(rows).toEqual([
      ['Name', 'Notes'],
      ['A, B', 'dit "oui"\nsur deux lignes'],
      ['C', '']
    ])
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows)
  })
})

describe('inferDatabase', () => {
  const csv = [
    ['Name', 'Status', 'Tags', 'Points', 'Due', 'Done', 'Site', 'Contact', 'Notes'],
    [
      'Doc',
      'In progress',
      'Alpha, Beta',
      '3',
      'October 14, 2026',
      'Yes',
      'https://a.example',
      'a@b.fr',
      'Long text. With sentences.'
    ],
    [
      'Bug',
      'Done',
      'Beta',
      '1,5',
      'October 1, 2026 → October 3, 2026',
      'No',
      '',
      '',
      'Autre note. Encore.'
    ],
    [
      'Plan',
      'In progress',
      'Alpha',
      '',
      '',
      'No',
      'https://b.example',
      'c@d.fr',
      'Troisième. Note.'
    ],
    ['Test', 'Done', 'Gamma, Alpha', '8', 'October 20, 2026', 'Yes', '', '', 'Quatrième. Note.']
  ]
  it('infers property types from every value of a column', () => {
    const db = inferDatabase(csv)!
    expect(db.schema.properties.map((p) => [p.name, p.type])).toEqual([
      ['Name', 'title'],
      ['Status', 'select'],
      ['Tags', 'multi_select'],
      ['Points', 'number'],
      ['Due', 'date'],
      ['Done', 'checkbox'],
      ['Site', 'url'],
      ['Contact', 'email'],
      ['Notes', 'text']
    ])
    expect(db.schema.views.map((v) => v.type)).toEqual(['table', 'board'])
    const [doc, bug] = db.rows
    const prop = (name: string): PropertyDef => db.schema.properties.find((p) => p.name === name)!
    expect(doc.title).toBe('Doc')
    expect(displayValue(prop('Tags'), doc.values[prop('Tags').id])).toBe('Alpha, Beta')
    expect(bug.values[prop('Points').id]).toBe(1.5)
    expect(bug.values[prop('Due').id]).toEqual({ start: '2026-10-01', end: '2026-10-03' })
    expect(bug.values[prop('Done').id]).toBe(false)
    expect(doc.values[prop('Done').id]).toBe(true)
  })
  it('keeps unique labels as text and handles an empty file', () => {
    expect(
      inferDatabase([
        ['Name', 'Code'],
        ['a', 'X1'],
        ['b', 'X2'],
        ['c', 'X3'],
        ['d', 'X4']
      ])!.schema.properties[1].type
    ).toBe('text')
    expect(inferDatabase([])).toBeNull()
  })
})

describe('Notion database import', () => {
  it('turns a CSV and its row pages into a database with typed values', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')
    migrate(db)
    const pages = new PageRepository(db)
    const dbs = new DatabaseRepository(pages)
    const id = 'f'.repeat(32)
    const rowId = 'e'.repeat(32)
    const zip = join(mkdtempSync(join(tmpdir(), 'nx-csv-')), 'export.zip')
    writeFileSync(
      zip,
      zipSync({
        [`Tâches ${id}_all.csv`]: strToU8(
          '﻿Name,Status,Points\nÉcrire la doc,In progress,3\nSans page,Done,1\n'
        ),
        [`Tâches ${id}.csv`]: strToU8('Name,Status\nÉcrire la doc,In progress\nSans page,Done\n'),
        [`Tâches ${id}/Écrire la doc ${rowId}.md`]: strToU8(
          '# Écrire la doc\n\nStatus: In progress\nPoints: 3\n\nRédiger le guide.\n'
        )
      })
    )
    const summary = await importNotionExport(
      pages,
      zip,
      new AssetStore(join(tmpdir(), 'nx-csv-assets'))
    )
    expect(summary).toMatchObject({ created: 4, databases: 1 })
    const database = pages.list().find((p) => p.kind === 'database')!
    expect(database.title).toBe('Tâches')
    const data = dbs.get(database.id)!
    const status = data.schema.properties.find((p) => p.name === 'Status')!
    const points = data.schema.properties.find((p) => p.name === 'Points')!
    expect(status.type).toBe('select')
    expect(points.type).toBe('number')
    const rows = Object.fromEntries(data.rows.map((r) => [r.title, r]))
    expect(Object.keys(rows).sort()).toEqual(['Sans page', 'Écrire la doc'])
    expect(displayValue(status, rows['Écrire la doc'].properties[status.id])).toBe('In progress')
    expect(rows['Sans page'].properties[points.id]).toBe(1)
    expect(pages.get(rows['Écrire la doc'].id)!.content).toContain('Rédiger le guide.')
    expect(pages.get(rows['Écrire la doc'].id)!.content).not.toContain('Status')
    expect(pages.search('progress').map((h) => h.title)).toEqual(['Écrire la doc'])
  })
})

describe('database export', () => {
  it('writes a Notion-style CSV and row pages that import back with the same types and values', async () => {
    const fresh = (): { pages: PageRepository; dbs: DatabaseRepository } => {
      const db = new DatabaseSync(':memory:')
      db.exec('PRAGMA foreign_keys = ON;')
      migrate(db)
      const pages = new PageRepository(db)
      return { pages, dbs: new DatabaseRepository(pages) }
    }
    const a = fresh()
    const database = a.dbs.create(null)
    a.pages.update(database.id, { title: 'Suivi' })
    const base = a.dbs.get(database.id)!.schema
    const schema = a.dbs.updateSchema(database.id, {
      ...base,
      properties: [
        ...base.properties,
        {
          id: 's',
          name: 'Statut',
          type: 'select',
          options: [
            { id: 'o1', name: 'Ouvert', color: 'blue' },
            { id: 'o2', name: 'Fermé', color: 'gray' }
          ]
        },
        { id: 'n', name: 'Coût', type: 'number' },
        { id: 'd', name: 'Date', type: 'date' },
        { id: 'c', name: 'Urgent', type: 'checkbox' },
        { id: 't', name: 'Note', type: 'text' }
      ]
    })
    a.dbs.createRow(database.id, {
      title: 'Premier',
      properties: { s: 'o1', n: 12.5, d: { start: '2026-10-14' }, c: true, t: 'avec, virgule' }
    })
    a.dbs.createRow(database.id, {
      title: 'Second',
      properties: { s: 'o2', n: 3, d: { start: '2026-10-01', end: '2026-10-03' } }
    })
    const template = a.dbs.createRow(database.id, { title: 'Modèle', properties: { s: 'o1' } })
    a.dbs.setTemplate(template.id, true)
    expect(schema.properties).toHaveLength(6)

    const { files, attachments } = await exportPagesAsMarkdown(
      a.pages.list(),
      (id) => a.pages.get(id),
      async () => null,
      null,
      (id) => a.dbs.get(id)
    )
    expect(files.map((f) => f.path)).toEqual(['Suivi.csv', 'Suivi/Premier.md', 'Suivi/Second.md'])
    expect(files[0].markdown).toContain('Premier,Ouvert,12.5,2026-10-14,Yes,"avec, virgule"')
    expect(files[1].markdown).toContain('Statut: Ouvert\nCoût: 12.5')

    const b = fresh()
    const zip = join(mkdtempSync(join(tmpdir(), 'nx-rt-')), 'export.zip')
    writeFileSync(zip, zipMarkdown(files, attachments))
    await importNotionExport(b.pages, zip, null)
    const imported = b.pages.list().find((p) => p.kind === 'database')!
    expect(imported.title).toBe('Suivi')
    const data = b.dbs.get(imported.id)!
    expect(data.schema.properties.map((p) => [p.name, p.type])).toEqual([
      ['Nom', 'title'],
      ['Statut', 'select'],
      ['Coût', 'number'],
      ['Date', 'date'],
      ['Urgent', 'checkbox'],
      ['Note', 'text']
    ])
    const values = (title: string): string[] => {
      const row = data.rows.find((r) => r.title === title)!
      return data.schema.properties
        .slice(1)
        .map((p) => displayValue(p, row.properties[p.id] ?? null))
    }
    expect(values('Premier')).toEqual(['Ouvert', '12.5', '2026-10-14', 'Oui', 'avec, virgule'])
    expect(values('Second')).toEqual(['Fermé', '3', '2026-10-01 → 2026-10-03', 'Non', ''])
  })
})

describe('relations', () => {
  it('splits linked cells written as "Title (link)"', () => {
    expect(
      splitLinkedCell(
        'Site web (Projets%20a/Site%20web%20b.md), App (https://www.notion.so/App-0123)'
      )
    ).toEqual([
      { title: 'Site web', link: 'Projets%20a/Site%20web%20b.md' },
      { title: 'App', link: 'https://www.notion.so/App-0123' }
    ])
    expect(splitLinkedCell('Texte libre')).toBeNull()
  })

  it('infers a relation only when every value names rows of one database', () => {
    const rows: Record<string, { id: string; database: string }> = {
      Site: { id: 'r1', database: 'db1' },
      App: { id: 'r2', database: 'db1' },
      Autre: { id: 'r3', database: 'db2' }
    }
    const resolve = (title: string): { id: string; database: string } | null => rows[title] ?? null
    const db = inferDatabase(
      [
        ['Name', 'Projet', 'Mixte', 'Libre'],
        ['T1', 'Site', 'Site', 'Site'],
        ['T2', 'Site, App', 'Autre', 'Inconnu'],
        ['T3', '', '', '']
      ],
      { resolveRelation: resolve }
    )!
    const [, projet, mixte, libre] = db.schema.properties
    expect([projet.type, projet.relationDatabaseId]).toEqual(['relation', 'db1'])
    expect(mixte.type).not.toBe('relation')
    expect(libre.type).not.toBe('relation')
    expect(db.rows.map((r) => r.values[projet.id] ?? null)).toEqual([['r1'], ['r1', 'r2'], null])
  })

  it('rebuilds relations between two Notion databases and keeps the CSV row order', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')
    migrate(db)
    const pages = new PageRepository(db)
    const dbs = new DatabaseRepository(pages)
    const P = 'a'.repeat(32)
    const T = 'b'.repeat(32)
    const site = 'c'.repeat(32)
    const app = 'd'.repeat(32)
    const zip = join(mkdtempSync(join(tmpdir(), 'nx-rel-')), 'export.zip')
    writeFileSync(
      zip,
      zipSync({
        [`Projets ${P}_all.csv`]: strToU8('Name,Client\nSite web,ACME\nApplication,Globex\n'),
        [`Projets ${P}/Site web ${site}.md`]: strToU8('# Site web\n\nClient: ACME\n'),
        [`Projets ${P}/Application ${app}.md`]: strToU8('# Application\n\nClient: Globex\n'),
        [`Tâches ${T}_all.csv`]: strToU8(
          `Name,Projet\nZ dernière en titre,Site web (Projets%20${P}/Site%20web%20${site}.md)\nA première en titre,"Site web (https://www.notion.so/Site-web-${site}), Application (https://www.notion.so/Application-${app})"\nM sans projet,\n`
        )
      })
    )
    await importNotionExport(pages, zip, null)
    const byTitle = Object.fromEntries(
      pages
        .list()
        .filter((p) => p.kind === 'database')
        .map((p) => [p.title, p.id])
    )
    const tasks = dbs.get(byTitle['Tâches'])!
    const projets = dbs.get(byTitle['Projets'])!
    const rel = tasks.schema.properties.find((p) => p.name === 'Projet')!
    expect(rel.type).toBe('relation')
    expect(rel.relationDatabaseId).toBe(projets.id)
    // rows in CSV order, not alphabetical
    expect(tasks.rows.map((r) => r.title)).toEqual([
      'Z dernière en titre',
      'A première en titre',
      'M sans projet'
    ])
    const idOf = (t: string): string => projets.rows.find((r) => r.title === t)!.id
    expect(tasks.rows.map((r) => r.properties[rel.id] ?? null)).toEqual([
      [idOf('Site web')],
      [idOf('Site web'), idOf('Application')],
      null
    ])

    // export then import again: the relation survives
    const { files, attachments } = await exportPagesAsMarkdown(
      pages.list(),
      (id) => pages.get(id),
      async () => null,
      null,
      (id) => dbs.get(id)
    )
    const csv = files.find((f) => f.path.endsWith('Tâches.csv'))!.markdown
    expect(csv).toContain('Site web (Projets/Site%20web.md)')
    const db2 = new DatabaseSync(':memory:')
    db2.exec('PRAGMA foreign_keys = ON;')
    migrate(db2)
    const pages2 = new PageRepository(db2)
    const dbs2 = new DatabaseRepository(pages2)
    const zip2 = join(mkdtempSync(join(tmpdir(), 'nx-rel2-')), 'export.zip')
    writeFileSync(zip2, zipMarkdown(files, attachments))
    await importNotionExport(pages2, zip2, null)
    const t2 = dbs2.get(
      pages2.list().find((p) => p.title === 'Tâches' && p.kind === 'database')!.id
    )!
    const rel2 = t2.schema.properties.find((p) => p.name === 'Projet')!
    expect(rel2.type).toBe('relation')
    expect(
      t2.rows.map((r) => (r.properties[rel2.id] as string[] | undefined)?.length ?? 0)
    ).toEqual([1, 2, 0])
  })
})
