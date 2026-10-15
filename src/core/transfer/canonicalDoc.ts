import { getSchema } from '@tiptap/core'
import { Mark, type Schema } from '@tiptap/pm/model'
import { createLowlight } from 'lowlight'
import { createDocumentExtensions } from '../../shared/editorExtensions'
import type { JsonMark, JsonNode } from './markdownToDoc'

let cached: Schema | null = null

/** The editor's document schema, built without a DOM. */
export function documentSchema(): Schema {
  cached ??= getSchema(createDocumentExtensions(createLowlight()))
  return cached
}

/**
 * Orders every text node's marks the way the schema expects and validates the
 * result. Returns null when the document does not satisfy the schema.
 */
export function canonicalDoc(doc: JsonNode, schema: Schema = documentSchema()): JsonNode | null {
  const fixed = normalizeMarks(doc, schema)
  try {
    schema.nodeFromJSON(fixed).check()
  } catch {
    return null
  }
  return fixed
}

function normalizeMarks(node: JsonNode, schema: Schema): JsonNode {
  const out: JsonNode = { ...node }
  if (node.marks?.length) {
    let set = Mark.none
    for (const m of node.marks) {
      const type = schema.marks[m.type]
      if (type) set = type.create(m.attrs).addToSet(set)
    }
    out.marks = set.map((m) => m.toJSON() as JsonMark)
    if (!out.marks.length) delete out.marks
  }
  if (node.content) out.content = node.content.map((child) => normalizeMarks(child, schema))
  return out
}
