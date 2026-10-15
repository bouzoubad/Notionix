import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../src/core/db/database'
import { PageRepository } from '../src/core/db/pageRepository'
import { DatabaseRepository } from '../src/core/db/databaseRepository'
import type { DatabaseSchema } from '../src/shared/database'

let pages: PageRepository
let dbs: DatabaseRepository

beforeEach(() => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  pages = new PageRepository(db)
  pages.actor = 'alice'
  dbs = new DatabaseRepository(pages)
})

const addProperty = (
  id: string,
  schema: DatabaseSchema,
  prop: DatabaseSchema['properties'][number]
): DatabaseSchema => dbs.updateSchema(id, { ...schema, properties: [...schema.properties, prop] })

describe('database rows with team properties', () => {
  it('numbers rows with a unique id and records who created and changed them', () => {
    const db = dbs.create(null)
    dbs.createRow(db.id, { title: 'Avant' })
    const schema = addProperty(db.id, dbs.schemaOf(db.id)!, {
      id: 'n',
      name: 'ID',
      type: 'unique_id',
      idPrefix: 'T'
    })
    const first = dbs.get(db.id)!.rows[0]
    expect(first.properties.n).toBe(1)
    const second = dbs.createRow(db.id, { title: 'Après' })
    expect(second.properties.n).toBe(2)
    // Numbers are never typed.
    expect(dbs.updateRow(second.id, { n: 99 }).properties.n).toBe(2)
    expect(second.createdBy).toBe('alice')
    const edited = pages.as('bob', () => dbs.updateRow(second.id, { title: 'Relu' }))
    expect(edited.updatedBy).toBe('bob')
    expect(schema.properties.find((p) => p.id === 'n')?.idPrefix).toBe('T')
  })

  it('keeps two-way relations in step', () => {
    const projects = dbs.create(null)
    const tasks = dbs.create(null)
    addProperty(tasks.id, dbs.schemaOf(tasks.id)!, {
      id: 'proj',
      name: 'Projet',
      type: 'relation',
      relationDatabaseId: projects.id
    })
    const site = dbs.createRow(projects.id, { title: 'Site' })
    const t1 = dbs.createRow(tasks.id, { title: 'Maquette', properties: { proj: [site.id] } })
    const schema = dbs.linkRelation(tasks.id, 'proj')
    const reverseId = schema.properties.find((p) => p.id === 'proj')!.syncedPropertyId!
    // Existing links are copied back.
    expect(dbs.getRow(site.id)!.row.properties[reverseId]).toEqual([t1.id])
    const t2 = dbs.createRow(tasks.id, { title: 'Contenu', properties: { proj: [site.id] } })
    expect(dbs.getRow(site.id)!.row.properties[reverseId]).toEqual([t1.id, t2.id])
    dbs.updateRow(t1.id, { proj: null })
    expect(dbs.getRow(site.id)!.row.properties[reverseId]).toEqual([t2.id])
    // From the other side too.
    dbs.updateRow(site.id, { [reverseId]: [t1.id] })
    expect(dbs.getRow(t1.id)!.row.properties.proj).toEqual([site.id])
    expect(dbs.getRow(t2.id)!.row.properties.proj).toBeUndefined()
  })

  it('nests sub-items under a single parent', () => {
    const db = dbs.create(null)
    const schema = dbs.enableNesting(db.id, 'subItems')
    const { parentPropertyId: parent, childrenPropertyId: children } = schema.subItems!
    const a = dbs.createRow(db.id, { title: 'A' })
    const b = dbs.createRow(db.id, { title: 'B' })
    const c = dbs.createRow(db.id, { title: 'C', properties: { [parent]: [a.id] } })
    expect(dbs.getRow(a.id)!.row.properties[children]).toEqual([c.id])
    // Moving C under B takes it away from A.
    dbs.updateRow(c.id, { [parent]: [a.id, b.id] })
    expect(dbs.getRow(c.id)!.row.properties[parent]).toEqual([b.id])
    expect(dbs.getRow(a.id)!.row.properties[children]).toBeUndefined()
    expect(dbs.getRow(b.id)!.row.properties[children]).toEqual([c.id])
    expect(dbs.enableNesting(db.id, 'dependencies').dependencies).toBeTruthy()
  })
})
