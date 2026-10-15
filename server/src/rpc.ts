import { isPropertyType, type PropertyType, type PropertyValue } from '../../src/shared/database'
import type { Role } from './auth'
import type { Workspace } from './workspace'

/** A call refused because of its arguments (HTTP 400). */
export class RpcError extends Error {}

const id = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v))
    throw new RpcError('Identifiant invalide.')
  return v
}
const parent = (v: unknown): string | null => (v === null ? null : id(v))
const int = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
    throw new RpcError('Position invalide.')
  return v
}
const record = (v: unknown): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new RpcError('Valeurs invalides.')
  return v as Record<string, unknown>
}
const text = (v: unknown): string => {
  if (typeof v !== 'string') throw new RpcError('Texte attendu.')
  return v
}
const optional = <T>(v: unknown, parse: (v: unknown) => T): T | undefined =>
  v === undefined ? undefined : parse(v)
const propertyType = (v: unknown): PropertyType => {
  if (!isPropertyType(v)) throw new RpcError('Type de propriété inconnu.')
  return v
}
const nullableText = (v: unknown): string | null => (v === null ? null : text(v))

interface Method {
  /** Changes the workspace: needs the editor role, and is announced to every client */
  write: boolean
  run: (ws: Workspace, args: unknown[]) => unknown
}

const read = (run: Method['run']): Method => ({ write: false, run })
const write = (run: Method['run']): Method => ({ write: true, run })

/**
 * The operations of NotionixApi the web client calls, with each argument
 * checked. Page content is not among the editable fields: it is edited
 * through the page's shared document.
 */
const METHODS: Record<string, Method> = {
  'pages.list': read((ws) => ws.pages.list()),
  'pages.get': read((ws, [p]) => ws.pages.get(id(p))),
  'pages.create': write((ws, [p]) => ws.pages.create(parent(p))),
  'pages.update': write((ws, [p, patch]) => {
    const r = record(patch)
    return ws.pages.update(id(p), {
      title: optional(r.title, text),
      icon: optional(r.icon, nullableText),
      cover: optional(r.cover, nullableText),
      favorite: optional(r.favorite, (v) => v === true)
    })
  }),
  'pages.move': write((ws, [p, to, index]) => ws.pages.move(id(p), parent(to), int(index))),
  'pages.trash': write((ws, [p]) => ws.pages.trash(id(p))),
  'pages.restore': write((ws, [p]) => ws.pages.restore(id(p))),
  'pages.deleteForever': write((ws, [p]) => ws.pages.deleteForever(id(p))),
  'pages.duplicate': write((ws, [p]) => ws.pages.duplicate(id(p))),
  'pages.search': read((ws, [q]) => ws.pages.search(text(q))),
  'databases.create': write((ws, [p]) => ws.databases.create(parent(p))),
  'databases.get': read((ws, [p]) => ws.databases.get(id(p))),
  'databases.getRow': read((ws, [p]) => ws.databases.getRow(id(p))),
  'databases.updateSchema': write((ws, [p, schema]) => ws.databases.updateSchema(id(p), schema)),
  'databases.createRow': write((ws, [p, init]) => {
    const r = init === undefined ? {} : record(init)
    return ws.databases.createRow(id(p), {
      title: optional(r.title, text),
      properties: optional(r.properties, record) as Record<string, PropertyValue> | undefined,
      templateId: optional(r.templateId, parent)
    })
  }),
  'databases.updateRow': write((ws, [p, values]) => ws.databases.updateRow(id(p), record(values))),
  'databases.setTemplate': write((ws, [p, flag]) => ws.databases.setTemplate(id(p), flag === true)),
  'databases.changePropertyType': write((ws, [p, property, type]) =>
    ws.databases.changePropertyType(id(p), text(property), propertyType(type))
  )
}

/** Operations reading page content, which must include the edits in progress. */
const READS_CONTENT = new Set([
  'pages.get',
  'pages.duplicate',
  'pages.search',
  'databases.createRow'
])

export interface RpcCall {
  method: Method
  args: unknown[]
  readsContent: boolean
}

/** Finds a method and checks the caller may run it; null for an unknown method. */
export function resolveCall(name: string, args: unknown, role: Role): RpcCall | 'forbidden' | null {
  const method = Object.hasOwn(METHODS, name) ? METHODS[name] : undefined
  if (!method) return null
  if (method.write && role === 'reader') return 'forbidden'
  if (!Array.isArray(args)) throw new RpcError('Arguments invalides.')
  return { method, args, readsContent: READS_CONTENT.has(name) }
}
