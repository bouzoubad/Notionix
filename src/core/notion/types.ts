/**
 * The parts of Notion's API objects the migration reads. Notion sends more;
 * everything is optional where Notion may leave it out, and unknown types are
 * kept as strings so new block or property types do not break the reading.
 */

export type NotionColor = string

export interface NotionUserRef {
  object: 'user'
  id: string
}

export interface NotionUser {
  object: 'user'
  id: string
  type?: 'person' | 'bot'
  name?: string | null
  avatar_url?: string | null
  person?: { email?: string }
}

export type NotionFile =
  | {
      type: 'file'
      file: { url: string; expiry_time?: string }
      name?: string
      caption?: NotionRichText[]
    }
  | { type: 'external'; external: { url: string }; name?: string; caption?: NotionRichText[] }
  | { type: 'file_upload'; file_upload: { id: string }; name?: string; caption?: NotionRichText[] }

export type NotionIcon =
  | { type: 'emoji'; emoji: string }
  | { type: 'custom_emoji'; custom_emoji: { id: string; name?: string; url?: string } }
  | { type: 'icon'; icon: { name: string; color?: string } }
  | { type: 'external'; external: { url: string } }
  | { type: 'file'; file: { url: string; expiry_time?: string } }
  | { type: 'file_upload'; file_upload: { id: string } }

export interface NotionAnnotations {
  bold?: boolean
  italic?: boolean
  strikethrough?: boolean
  underline?: boolean
  code?: boolean
  color?: NotionColor
}

export interface NotionDate {
  start: string
  end?: string | null
  time_zone?: string | null
}

export interface NotionMention {
  type: string
  user?: { id: string; name?: string; person?: { email?: string } }
  page?: { id: string }
  database?: { id: string }
  data_source?: { id: string }
  date?: NotionDate
  link_preview?: { url: string }
  link_mention?: { href: string; title?: string }
  template_mention?: {
    type: string
    template_mention_date?: string
    template_mention_user?: string
  }
  custom_emoji?: { id: string; name?: string; url?: string }
}

export interface NotionRichText {
  type: 'text' | 'mention' | 'equation' | string
  plain_text: string
  href?: string | null
  annotations?: NotionAnnotations
  text?: { content: string; link?: { url: string } | null }
  mention?: NotionMention
  equation?: { expression: string }
}

export interface NotionParent {
  type: 'page_id' | 'database_id' | 'data_source_id' | 'block_id' | 'workspace' | string
  page_id?: string
  database_id?: string
  data_source_id?: string
  block_id?: string
  workspace?: boolean
}

/** A block: its type-specific part is under the key named by `type`. */
export interface NotionBlock {
  object: 'block'
  id: string
  type: string
  has_children?: boolean
  in_trash?: boolean
  archived?: boolean
  created_time?: string
  last_edited_time?: string
  created_by?: NotionUserRef
  /** Filled by the crawler: the block's children, in order */
  children?: NotionBlock[]
  [type: string]: unknown
}

/** The type-specific part of a block, as most types shape it. */
export interface NotionBlockData {
  rich_text?: NotionRichText[]
  color?: NotionColor
  caption?: NotionRichText[]
  checked?: boolean
  language?: string
  is_toggleable?: boolean
  icon?: NotionIcon | null
  expression?: string
  title?: string
  url?: string
  name?: string
  type?: string
  file?: { url: string }
  external?: { url: string }
  synced_from?: { block_id: string } | null
  table_width?: number
  has_column_header?: boolean
  has_row_header?: boolean
  cells?: NotionRichText[][]
  page_id?: string
  database_id?: string
  data_source_id?: string
  list_start_index?: number
}

export interface NotionPropertyValue {
  id: string
  type: string
  [type: string]: unknown
}

export interface NotionPage {
  object: 'page'
  id: string
  created_time: string
  last_edited_time: string
  created_by?: NotionUserRef
  last_edited_by?: NotionUserRef
  in_trash?: boolean
  archived?: boolean
  is_locked?: boolean
  icon: NotionIcon | null
  cover: NotionFile | null
  parent: NotionParent
  url?: string
  properties: Record<string, NotionPropertyValue>
}

export interface NotionDatabase {
  object: 'database'
  id: string
  created_time: string
  last_edited_time: string
  created_by?: NotionUserRef
  last_edited_by?: NotionUserRef
  in_trash?: boolean
  is_inline?: boolean
  is_locked?: boolean
  title: NotionRichText[]
  description?: NotionRichText[]
  icon: NotionIcon | null
  cover: NotionFile | null
  parent: NotionParent
  data_sources?: { id: string; name: string }[]
}

export interface NotionPropertySchema {
  id: string
  name: string
  type: string
  [type: string]: unknown
}

export interface NotionDataSource {
  object: 'data_source'
  id: string
  title?: NotionRichText[]
  parent?: NotionParent
  database_parent?: NotionParent
  properties: Record<string, NotionPropertySchema>
  created_time?: string
  last_edited_time?: string
}

export interface NotionView {
  object: 'view'
  id: string
  name: string
  type: string
  data_source_id?: string | null
  filter?: unknown
  sorts?: unknown[] | null
  configuration?: Record<string, unknown> | null
}

export interface NotionComment {
  object: 'comment'
  id: string
  discussion_id: string
  parent: NotionParent
  created_time: string
  last_edited_time?: string
  created_by: NotionUserRef
  rich_text: NotionRichText[]
  display_name?: { resolved_name?: string }
}

export interface NotionCustomEmoji {
  id: string
  name: string
  url: string
}
