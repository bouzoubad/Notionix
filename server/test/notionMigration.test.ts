import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Accounts } from '../src/auth'
import { openDatabase } from '../src/db'
import { Workspaces } from '../src/workspaces'
import { fetchNotion, migrateNotion } from '../src/notionMigration'
import { NotionClient } from '../../src/core/notion/client'
import { crawlNotion } from '../../src/core/notion/crawl'
import {
  convertBlocks,
  localDate,
  notionIdOfLink,
  type ConvertContext
} from '../../src/core/notion/convert'
import { lucideFor, pictogramFor } from '../../src/core/notion/icons'
import { parseSchema, type DatabaseSchema } from '../../src/shared/database'
import type { NotionBlock, NotionRichText } from '../../src/core/notion/types'

// --- A small Notion workspace, served by a fake API --------------------------

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const P1 = id(1)
const P2 = id(2)
const P3 = id(3)
const D1 = id(10)
const DS1 = id(11)
const R1 = id(12)
const R2 = id(13)
const SYNC = id(20)
const OLD_IMPORT_HEX = id(1).replace(/-/g, '')

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8])
const S3 = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/space'
const EMOJI_URL = 'https://s3-us-west-2.amazonaws.com/public.notion-static.com/e1/logo.png'

const text = (content: string, extra: Partial<NotionRichText> = {}): NotionRichText => ({
  type: 'text',
  plain_text: content,
  text: { content, link: null },
  annotations: {},
  ...extra
})
const title = (t: string): Record<string, unknown> => ({
  title: { id: 'title', type: 'title', title: [text(t)] }
})
const block = (
  n: number,
  type: string,
  data: Record<string, unknown>,
  children?: NotionBlock[]
): NotionBlock => ({
  object: 'block',
  id: id(100 + n),
  type,
  has_children: !!children?.length,
  [type]: data,
  ...(children ? { __children: children } : {})
})
const page = (
  pid: string,
  parent: Record<string, unknown>,
  props: Record<string, unknown>,
  icon: unknown = null
) => ({
  object: 'page',
  id: pid,
  created_time: '2025-03-01T10:00:00.000Z',
  last_edited_time: '2025-04-01T10:00:00.000Z',
  created_by: { object: 'user', id: 'u1' },
  last_edited_by: { object: 'user', id: 'u2' },
  in_trash: false,
  icon,
  cover: null,
  parent,
  properties: props
})

const P1_BLOCKS: NotionBlock[] = [
  block(1, 'heading_1', { rich_text: [text('Titre')], color: 'blue', is_toggleable: false }),
  block(2, 'paragraph', {
    rich_text: [
      text('gras', { annotations: { bold: true, color: 'red_background' } }),
      text(' lien', { href: `https://www.notion.so/Sous-page-${P2.replace(/-/g, '')}` }),
      {
        type: 'mention',
        plain_text: '@Alice',
        mention: { type: 'user', user: { id: 'u1', name: 'Alice' } }
      },
      {
        type: 'mention',
        plain_text: ':logo-pse:',
        mention: {
          type: 'custom_emoji',
          custom_emoji: { id: 'e1', name: 'Logo PSE', url: EMOJI_URL }
        }
      },
      { type: 'equation', plain_text: 'x^2', equation: { expression: 'x^2' } },
      {
        type: 'mention',
        plain_text: '2025-05-01',
        mention: { type: 'date', date: { start: '2025-05-01T08:30:00.000+00:00' } }
      }
    ],
    color: 'default'
  }),
  block(3, 'bulleted_list_item', { rich_text: [text('un')] }),
  block(4, 'bulleted_list_item', { rich_text: [text('deux')] }, [
    block(5, 'paragraph', { rich_text: [text('sous')] })
  ]),
  block(6, 'to_do', { rich_text: [text('tâche')], checked: true }),
  block(7, 'toggle', { rich_text: [text('plier')] }, [
    block(8, 'paragraph', { rich_text: [text('dedans')] })
  ]),
  block(9, 'heading_2', { rich_text: [text('Section pliable')], is_toggleable: true }, [
    block(10, 'paragraph', { rich_text: [text('caché')] })
  ]),
  block(11, 'callout', {
    rich_text: [text('attention')],
    icon: { type: 'emoji', emoji: '⚠️' },
    color: 'yellow_background'
  }),
  block(12, 'code', { rich_text: [text('const a = 1')], language: 'typescript', caption: [] }),
  block(13, 'table', { table_width: 2, has_column_header: true, has_row_header: false }, [
    block(14, 'table_row', { cells: [[text('A')], [text('B')]] }),
    block(15, 'table_row', { cells: [[text('1')], [text('2')]] })
  ]),
  block(16, 'column_list', {}, [
    block(17, 'column', {}, [block(18, 'paragraph', { rich_text: [text('gauche')] })]),
    block(19, 'column', {}, [block(20, 'paragraph', { rich_text: [text('droite')] })])
  ]),
  block(21, 'image', {
    type: 'file',
    file: { url: `${S3}/img/photo.png?X-Amz-Signature=1` },
    caption: [text('Légende')]
  }),
  {
    object: 'block',
    id: P2,
    type: 'child_page',
    has_children: true,
    child_page: { title: 'Sous-page' }
  },
  {
    object: 'block',
    id: D1,
    type: 'child_database',
    has_children: false,
    child_database: { title: 'Tâches' }
  },
  {
    object: 'block',
    id: SYNC,
    type: 'synced_block',
    has_children: true,
    synced_block: { synced_from: null },
    __children: [block(22, 'paragraph', { rich_text: [text('partagé')] })]
  } as NotionBlock,
  block(23, 'synced_block', { synced_from: { block_id: SYNC } }, [
    block(24, 'paragraph', { rich_text: [text('partagé')] })
  ]),
  block(25, 'ai_block', {})
]

const STATUS = {
  id: 'st%3A1',
  name: 'Statut',
  type: 'status',
  status: {
    options: [
      { id: 'o1', name: 'Pas commencé', color: 'default' },
      { id: 'o2', name: 'En cours', color: 'blue' },
      { id: 'o3', name: 'Fini', color: 'green' }
    ],
    groups: [
      { id: 'g1', name: 'To-do', option_ids: ['o1'] },
      { id: 'g2', name: 'In progress', option_ids: ['o2'] },
      { id: 'g3', name: 'Complete', option_ids: ['o3'] }
    ]
  }
}
const DS1_SCHEMA = {
  object: 'data_source',
  id: DS1,
  parent: { type: 'database_id', database_id: D1 },
  properties: {
    Nom: { id: 'title', name: 'Nom', type: 'title', title: {} },
    Statut: STATUS,
    Tags: {
      id: 'tg',
      name: 'Tags',
      type: 'multi_select',
      multi_select: {
        options: [
          { id: 't1', name: 'A', color: 'red' },
          { id: 't2', name: 'B', color: 'default' }
        ]
      }
    },
    Date: { id: 'dt', name: 'Date', type: 'date', date: {} },
    Owner: { id: 'ow', name: 'Owner', type: 'people', people: {} },
    Prix: { id: 'px', name: 'Prix', type: 'number', number: { format: 'euro' } },
    Formule: {
      id: 'fx',
      name: 'Formule',
      type: 'formula',
      formula: { expression: 'prop("Prix") * 2' }
    },
    Liens: {
      id: 'rl',
      name: 'Liens',
      type: 'relation',
      relation: {
        data_source_id: DS1,
        type: 'dual_property',
        dual_property: { synced_property_id: 'rl2' }
      }
    },
    Liés: {
      id: 'rl2',
      name: 'Liés',
      type: 'relation',
      relation: {
        data_source_id: DS1,
        type: 'dual_property',
        dual_property: { synced_property_id: 'rl' }
      }
    },
    Total: {
      id: 'tt',
      name: 'Total',
      type: 'rollup',
      rollup: { relation_property_id: 'rl', rollup_property_id: 'px', function: 'sum' }
    },
    ID: { id: 'ui', name: 'ID', type: 'unique_id', unique_id: { prefix: 'TÂCHE' } },
    Pièce: { id: 'fl', name: 'Pièce', type: 'files', files: {} },
    Lieu: { id: 'pl', name: 'Lieu', type: 'place', place: {} }
  }
}
const row = (pid: string, name: string, extra: Record<string, unknown>) =>
  page(
    pid,
    { type: 'data_source_id', data_source_id: DS1, database_id: D1 },
    {
      Nom: { id: 'title', type: 'title', title: [text(name)] },
      ...extra
    }
  )
const ROWS = [
  row(R1, 'Première', {
    Statut: { id: 'st%3A1', type: 'status', status: { id: 'o2', name: 'En cours' } },
    Tags: { id: 'tg', type: 'multi_select', multi_select: [{ id: 't1', name: 'A' }] },
    Date: { id: 'dt', type: 'date', date: { start: '2025-06-01', end: null } },
    Owner: {
      id: 'ow',
      type: 'people',
      people: [
        { object: 'user', id: 'u1' },
        { object: 'user', id: 'u2' }
      ]
    },
    Prix: { id: 'px', type: 'number', number: 12.5 },
    Liens: { id: 'rl', type: 'relation', relation: [{ id: R2 }], has_more: false },
    ID: { id: 'ui', type: 'unique_id', unique_id: { prefix: 'TÂCHE', number: 1 } },
    Pièce: {
      id: 'fl',
      type: 'files',
      files: [{ type: 'file', name: 'plan.stl', file: { url: `${S3}/f/plan.stl?sig=2` } }]
    }
  }),
  row(R2, 'Seconde', {
    ID: { id: 'ui', type: 'unique_id', unique_id: { prefix: 'TÂCHE', number: 2 } }
  })
]

function fakeNotion(options: { personal?: boolean } = {}): typeof fetch {
  const list = (results: unknown[]) => ({ results, has_more: false, next_cursor: null })
  const pages: Record<string, unknown> = {
    [P1]: page(P1, { type: 'workspace', workspace: true }, title('Accueil'), {
      type: 'emoji',
      emoji: '📘'
    }),
    [P2]: page(P2, { type: 'page_id', page_id: P1 }, title('Sous-page'), {
      type: 'icon',
      icon: { name: 'gear', color: 'blue' }
    }),
    [P3]: page(P3, { type: 'workspace', workspace: true }, title('Privée'), {
      type: 'custom_emoji',
      custom_emoji: { id: 'e1', name: 'Logo PSE', url: EMOJI_URL }
    }),
    [R1]: ROWS[0],
    [R2]: ROWS[1]
  }
  const children: Record<string, NotionBlock[]> = {
    [P1]: P1_BLOCKS,
    [P2]: [block(30, 'paragraph', { rich_text: [text('Bonjour')] })],
    [P3]: [block(31, 'paragraph', { rich_text: [text('rouge')], color: 'red_background' })],
    [R1]: [block(32, 'paragraph', { rich_text: [text('Détail')] })],
    [R2]: []
  }
  const walk = (blocks: NotionBlock[]): void => {
    for (const b of blocks) {
      const kids = (b as { __children?: NotionBlock[] }).__children
      if (kids) {
        children[b.id] = kids
        delete (b as { __children?: NotionBlock[] }).__children
        b.has_children = true
        walk(kids)
      }
    }
  }
  walk(P1_BLOCKS)
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
      })
    if (url.hostname !== 'api.notion.com') {
      if (url.pathname.endsWith('.png') || url.pathname.endsWith('.stl'))
        return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
      return new Response('nope', { status: 404 })
    }
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ntn_test')
    const path = url.pathname.replace('/v1', '')
    if (path === '/users/me')
      return json({
        object: 'user',
        id: 'bot',
        type: 'bot',
        bot: { owner: { type: 'user', user: { id: 'u1', person: { email: 'alice@example.com' } } } }
      })
    if (path === '/users' && options.personal)
      return json({ code: 'restricted_resource', message: 'Not available to personal tokens' }, 403)
    if (path === '/users')
      return json(
        list([
          {
            object: 'user',
            id: 'u1',
            type: 'person',
            name: 'Alice',
            person: { email: 'alice@example.com' }
          },
          {
            object: 'user',
            id: 'u2',
            type: 'person',
            name: 'Bob',
            person: { email: 'bob@example.com' }
          },
          { object: 'user', id: 'bot', type: 'bot', name: 'Migration' }
        ])
      )
    if (path === '/custom_emojis')
      return json(list([{ id: 'e1', name: 'Logo PSE', url: EMOJI_URL }]))
    if (path === '/search')
      return json(list([pages[P1], pages[P2], pages[P3], DS1_SCHEMA, pages[R1], pages[R2]]))
    if (path === `/databases/${D1}`)
      return json({
        object: 'database',
        id: D1,
        title: [text('Tâches')],
        description: [text('Suivi')],
        is_inline: true,
        icon: null,
        cover: null,
        parent: { type: 'block_id', block_id: D1 },
        created_time: '2025-03-01T10:00:00.000Z',
        last_edited_time: '2025-04-01T10:00:00.000Z',
        data_sources: [{ id: DS1, name: 'Tâches' }]
      })
    if (path === `/data_sources/${DS1}`) return json(DS1_SCHEMA)
    if (path === `/data_sources/${DS1}/query`) return json(list(ROWS))
    if (path === '/views') {
      expect(url.searchParams.get('database_id')).toBe(D1)
      return json(list([{ id: 'v1' }]))
    }
    if (path === '/views/v1')
      return json({
        object: 'view',
        id: 'v1',
        name: 'Par statut',
        type: 'board',
        data_source_id: DS1,
        filter: {
          and: [
            { property: 'tg', multi_select: { contains: 'A' } },
            { or: [{ property: 'Prix', number: { greater_than: 10 } }] }
          ]
        },
        sorts: [{ property: 'Date', direction: 'descending' }],
        configuration: {
          type: 'board',
          group_by: { type: 'status', property_id: 'st%3A1' },
          properties: [
            { property_id: 'tg', visible: true },
            { property_id: 'px', visible: false }
          ]
        }
      })
    if (path.startsWith('/pages/'))
      return json(
        pages[path.slice('/pages/'.length)] ?? {},
        pages[path.slice('/pages/'.length)] ? 200 : 404
      )
    const childrenOf = /^\/blocks\/([^/]+)\/children$/.exec(path)
    if (childrenOf) return json(list(children[childrenOf[1]] ?? []))
    if (path === '/comments')
      return json(
        list(
          url.searchParams.get('block_id') === P1
            ? [
                {
                  object: 'comment',
                  id: id(500),
                  discussion_id: id(501),
                  parent: { type: 'page_id', page_id: P1 },
                  created_time: '2025-05-02T09:00:00.000Z',
                  created_by: { object: 'user', id: 'u2' },
                  rich_text: [text('À relire')]
                }
              ]
            : []
        )
      )
    return json({ code: 'object_not_found', message: path }, 404)
  }) as typeof fetch
}

async function crawled(options: { personal?: boolean } = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'nx-notion-'))
  const fetch = fakeNotion(options)
  const client = new NotionClient({
    token: 'ntn_test',
    fetch,
    intervalMs: 0,
    sleep: async () => undefined
  })
  const index = await crawlNotion(client, dir, { fetch })
  // A personal token cannot list the people.
  expect(index.errors.map((e) => e.id)).toEqual(options.personal ? ['users'] : [])
  return dir
}

async function server(): Promise<{
  dataDir: string
  db: ReturnType<typeof openDatabase>
  alice: string
}> {
  const dataDir = mkdtempSync(join(tmpdir(), 'nx-notion-data-'))
  const db = openDatabase(dataDir)
  const accounts = new Accounts(db, 30)
  const alice = await accounts.create({
    email: 'alice@example.com',
    name: 'Alice',
    role: 'editor',
    password: 'mot-de-passe-1'
  })
  return { dataDir, db, alice: alice.id }
}

describe('Notion migration', () => {
  it('reads links, dates and pictograms the way Notionix writes them', () => {
    expect(notionIdOfLink(`https://www.notion.so/acme/Page-${OLD_IMPORT_HEX}?pvs=4`)).toBe(P1)
    expect(notionIdOfLink(`/${OLD_IMPORT_HEX}#abc`)).toBe(P1)
    expect(notionIdOfLink('https://example.com/x')).toBeNull()
    expect(localDate('2025-05-01T08:30:00.000+00:00', 'Europe/Paris')).toBe('2025-05-01T10:30')
    expect(localDate('2025-05-01', 'Europe/Paris')).toBe('2025-05-01')
    expect(lucideFor('light-bulb')).toBe('lightbulb')
    expect(lucideFor('folder')).toBe('folder')
    expect(pictogramFor('gear', 'lightgray').icon).toBe('icon:settings:default')
    expect(pictogramFor('zzz-unknown', 'red')).toEqual({
      icon: 'icon:file-text:red',
      matched: false
    })
  })

  it('reads a workspace from the API and writes it into Notionix, once', async () => {
    const dir = await crawled()
    expect(existsSync(join(dir, 'objects', `${P1}.json`))).toBe(true)
    const files = JSON.parse(readFileSync(join(dir, 'files.json'), 'utf8')) as Record<
      string,
      { file: string | null }
    >
    expect(files[`${S3}/img/photo.png`]?.file).toMatch(/\.png$/)

    const { dataDir, db, alice } = await server()
    // An earlier import of an export: its pages go to the trash.
    const registry = new Workspaces(db, dataDir)
    const oldContainer = registry.main.pages.create(null)
    registry.main.pages.update(oldContainer.id, { title: 'Importé de Notion (2026-11-03)' })
    registry.main.pages.importNodes(
      [
        {
          id: id(900),
          parentId: oldContainer.id,
          title: 'Accueil',
          content: '{"type":"doc","content":[{"type":"paragraph"}]}',
          source: `notion:${OLD_IMPORT_HEX}`,
          existing: false
        }
      ],
      'x'
    )
    const teamspaces = join(dir, 'teamspaces.json')
    writeFileSync(
      teamspaces,
      JSON.stringify({
        teamspaces: [
          {
            id: 'team-wiki',
            name: 'Wiki',
            icon: '/icons/book_blue.svg',
            memberEmails: ['alice@example.com', 'carol@example.com'],
            pages: [P1.replace(/-/g, '')]
          }
        ]
      })
    )

    // A trial writes nothing.
    const trial = await migrateNotion(db, dataDir, {
      dir,
      teamspacesFile: teamspaces,
      dryRun: true,
      replaceImports: true
    })
    expect(readFileSync(trial.reportFile, 'utf8')).toContain('essai')
    expect(registry.list()).toHaveLength(1)

    const { plan, reportFile } = await migrateNotion(db, dataDir, {
      dir,
      teamspacesFile: teamspaces,
      dryRun: false,
      replaceImports: true
    })
    const report = readFileSync(reportFile, 'utf8')
    expect(report).toContain('carol@example.com')
    expect(report).toContain('bob@example.com')
    expect(report).toContain('Privée')

    // The teamspace became a workspace with its members and pictogram.
    const wiki = registry.list().find((w) => w.name === 'Wiki')!
    expect(wiki.memberIds).toEqual([alice])
    expect(wiki.icon).toBe('icon:book:blue')
    const ws = registry.get(wiki.id)!
    const home = ws.pages.get(P1)!
    expect(home.title).toBe('Accueil')
    expect(home.icon).toBe('📘')
    expect(home.createdAt).toBe(Date.parse('2025-03-01T10:00:00.000Z'))
    expect(home.createdBy).toBe(alice)
    const types = new Set<string>()
    const walk = (n: { type: string; content?: unknown[] }): void => {
      types.add(n.type)
      for (const c of (n.content ?? []) as { type: string }[]) walk(c)
    }
    walk(JSON.parse(home.content))
    for (const t of [
      'heading',
      'bulletList',
      'taskList',
      'details',
      'callout',
      'codeBlock',
      'table',
      'tableHeader',
      'columns',
      'image',
      'pageLink',
      'databaseView',
      'syncedBlock',
      'customEmoji',
      'mention',
      'inlineMath'
    ])
      expect(types, t).toContain(t)
    expect(home.content).toContain(`notionix://page/${P2}`)
    expect(home.content).toContain('var(--nx-red-bg)')
    expect(ws.pages.get(P2)!.icon).toBe('icon:settings:blue')
    expect(ws.pages.get(P2)!.parentId).toBe(P1)
    // Both synced blocks show the same hidden page.
    const syncedIds = [...home.content.matchAll(/"sourceId":"([^"]+)"/g)].map((m) => m[1])
    expect(syncedIds).toHaveLength(2)
    expect(new Set(syncedIds).size).toBe(1)
    expect(ws.pages.get(syncedIds[0])!.content).toContain('partagé')

    // The database: its schema, view and rows.
    const database = ws.databases.get(D1)!
    const schema: DatabaseSchema = parseSchema(JSON.stringify(database.schema))
    const prop = (name: string) => schema.properties.find((p) => p.name === name)!
    expect(prop('Statut').type).toBe('status')
    expect(prop('Statut').options!.map((o) => o.group)).toEqual(['todo', 'in_progress', 'done'])
    expect(prop('Liens').relationDatabaseId).toBe(D1)
    expect(prop('Liens').syncedPropertyId).toBe(prop('Liés').id)
    expect(prop('Total').rollup).toEqual({
      relationPropertyId: prop('Liens').id,
      targetPropertyId: prop('Prix').id,
      aggregate: 'sum'
    })
    expect(prop('Formule').formula).toBe('prop("Prix") * 2')
    expect(prop('ID').idPrefix).toBe('TÂCHE')
    expect(schema.properties.some((p) => p.name === 'Lieu')).toBe(false)
    const view = schema.views[0]
    expect(view).toMatchObject({ name: 'Par statut', type: 'board', groupBy: prop('Statut').id })
    expect(view.sorts).toEqual([{ propertyId: prop('Date').id, direction: 'desc' }])
    expect(view.filters[0]).toMatchObject({
      propertyId: prop('Tags').id,
      operator: 'contains',
      value: prop('Tags').options![0].id
    })
    expect(view.filterGroups?.[0].filters[0]).toMatchObject({
      propertyId: prop('Prix').id,
      operator: 'gt',
      value: 10
    })
    expect(view.hidden).toContain(prop('Prix').id)
    const rows = database.rows
    expect(rows.map((r) => r.title)).toEqual(['Première', 'Seconde'])
    const first = rows[0].properties
    expect(first[prop('Statut').id]).toBe(prop('Statut').options![1].id)
    expect(first[prop('Date').id]).toEqual({ start: '2025-06-01' })
    expect(first[prop('Owner').id]).toEqual([alice])
    expect(first[prop('Liens').id]).toEqual([R2])
    expect(first[prop('ID').id]).toBe(1)
    // A file Notionix does not keep as is travels in a zip.
    expect(String((first[prop('Pièce').id] as string[])[0])).toMatch(
      /^notionix-asset:\/\/file\/[0-9a-f]{64}\.zip#plan\.stl$/
    )
    const asset = String((first[prop('Pièce').id] as string[])[0])
      .split('#')[0]
      .split('/')
      .pop()!
    expect(existsSync(join(dataDir, 'workspaces', wiki.id, 'assets', asset))).toBe(true)

    // The comment, with its author kept by name when they have no account.
    expect(ws.team.comments(P1)[0]).toMatchObject({ body: 'Bob : À relire', threadId: id(501) })

    // A page of no teamspace goes under one page of the main workspace, with its team emoji.
    const main = registry.main.pages
    const privee = main.get(P3)!
    expect(privee.icon).toMatch(/^notionix-asset:\/\/file\/[0-9a-f]{64}\.png$/)
    const privateRoot = main.get(privee.parentId!)!
    expect(privateRoot.title).toContain('hors espaces')
    // Private pages of the token's creator stay private to them.
    expect(privateRoot).toMatchObject({ access: 'restricted', createdBy: alice })
    expect(db.prepare('SELECT name FROM custom_emojis').all()).toEqual([{ name: 'logo_pse' }])

    // The earlier import is in the trash, its provenance freed.
    expect(main.get(id(900))!.trashedAt).not.toBeNull()
    expect(main.get(oldContainer.id)!.trashedAt).not.toBeNull()
    expect(plan.nodes.filter((n) => n.kind === 'synced')).toHaveLength(1)

    // Running it again adds nothing.
    const again = await migrateNotion(db, dataDir, {
      dir,
      teamspacesFile: teamspaces,
      dryRun: false,
      replaceImports: true
    })
    expect(readFileSync(again.reportFile, 'utf8')).toMatch(
      /« Wiki » : 0 page\(s\) créée\(s\), 6 déjà là/
    )
    expect(registry.list()).toHaveLength(2)
    expect(main.get(P3)!.trashedAt).toBeNull()
  })

  it('with a personal token, finds people from the Notion app', async () => {
    const dir = await crawled({ personal: true })
    const { dataDir, db, alice } = await server()
    const teamspaces = join(dir, 'teamspaces.json')
    writeFileSync(
      teamspaces,
      JSON.stringify({
        teamspaces: [{ id: 'team-wiki', name: 'Wiki', icon: null, memberEmails: [], pages: [P1] }],
        users: [
          { id: 'u1', email: 'alice@example.com', name: 'Alice' },
          { id: 'u2', email: 'bob@example.com', name: 'Bob' },
          { id: 'u3', email: 'eve@elsewhere.org', name: 'Eve' }
        ]
      })
    )
    // A trial only lists the accounts it would make.
    const trial = await migrateNotion(db, dataDir, {
      dir,
      teamspacesFile: teamspaces,
      dryRun: true,
      replaceImports: false,
      createAccountsFor: 'example.com'
    })
    expect(readFileSync(trial.reportFile, 'utf8')).toContain('Bob <bob@example.com>')
    const accounts = new Accounts(db, 30)
    expect(accounts.list().map((u) => u.email)).toEqual(['alice@example.com'])

    const real = await migrateNotion(db, dataDir, {
      dir,
      teamspacesFile: teamspaces,
      dryRun: false,
      replaceImports: false,
      createAccountsFor: 'example.com',
      onlyTeamspaces: true
    })
    // Only the teamspace's pages: the private one stays in Notion for later.
    expect(readFileSync(real.reportFile, 'utf8')).toMatch(/Laissées dans Notion[^\n]*\n- Privée/)
    const registry = new Workspaces(db, dataDir)
    const wiki = registry.get(registry.list().find((w) => w.name === 'Wiki')!.id)!
    expect(wiki.pages.get(P1)!.createdBy).toBe(alice)
    // People of the team's domain get a disabled account and keep their edits; others do not.
    const bob = accounts.list().find((u) => u.email === 'bob@example.com')!
    expect(bob).toMatchObject({ disabled: true, name: 'Bob', role: 'editor' })
    expect(wiki.pages.get(P1)!.updatedBy).toBe(bob.id)
    expect(accounts.list().some((u) => u.email === 'eve@elsewhere.org')).toBe(false)
    expect(registry.main.pages.get(P3)).toBeNull()
  })

  it('keeps unknown blocks as text and counts them', async () => {
    const notes: string[] = []
    const ctx: ConvertContext = {
      pageId: () => null,
      userId: () => null,
      userName: () => 'X',
      asset: async () => null,
      emoji: async () => null,
      isInlineDatabase: () => false,
      synced: async () => id(0),
      timeZone: 'Europe/Paris',
      note: (w) => notes.push(w)
    }
    const out = await convertBlocks(
      [
        block(1, 'tab', { rich_text: [text('notes')] }),
        block(2, 'image', {
          type: 'external',
          external: { url: 'https://example.com/a.png' },
          caption: []
        })
      ],
      ctx
    )
    expect(out[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'notes' }] })
    expect(JSON.stringify(out[1])).toContain('https://example.com/a.png')
    expect(notes).toEqual(['Bloc « tab » non pris en charge', 'Image non récupérée (lien gardé)'])
  })

  it('refuses a token file that holds no Notion token', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nx-tok-')), 'token')
    writeFileSync(file, 'hello')
    await expect(fetchNotion(file, tmpdir(), { blockComments: false })).rejects.toThrow(
      'Jeton Notion illisible'
    )
  })
})
