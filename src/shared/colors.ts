import { Extension } from '@tiptap/core'
import { OPTION_COLORS, type OptionColor } from './database'

/**
 * Text and background colors, stored as CSS variables (var(--nx-red)) so the
 * page follows the light or dark theme. Blocks carry a color name.
 */
export const COLORS = OPTION_COLORS
export type ColorName = OptionColor

export const COLOR_LABELS: Record<ColorName, string> = {
  gray: 'Gris',
  brown: 'Marron',
  orange: 'Orange',
  yellow: 'Jaune',
  green: 'Vert',
  blue: 'Bleu',
  purple: 'Violet',
  pink: 'Rose',
  red: 'Rouge'
}

export const textColor = (name: ColorName): string => `var(--nx-${name})`
export const backgroundColor = (name: ColorName): string => `var(--nx-${name}-bg)`

/** Block color: a text color ('red') or a background ('red_background'). */
export type BlockColor = ColorName | `${ColorName}_background`

const BLOCK_COLOR = new RegExp(`^(${COLORS.join('|')})(_background)?$`)
export const isBlockColor = (v: unknown): v is BlockColor =>
  typeof v === 'string' && BLOCK_COLOR.test(v)

/** Blocks that can be colored as a whole (block menu). */
export const COLORED_BLOCKS = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'callout',
  'details',
  'columns'
]

export const BlockColors = Extension.create({
  name: 'blockColors',
  addGlobalAttributes() {
    return [
      {
        types: COLORED_BLOCKS,
        attributes: {
          blockColor: {
            default: null,
            parseHTML: (el) => {
              const v = el.getAttribute('data-color')
              return isBlockColor(v) ? v : null
            },
            renderHTML: (attrs) =>
              isBlockColor(attrs.blockColor) ? { 'data-color': attrs.blockColor } : {}
          }
        }
      }
    ]
  }
})
