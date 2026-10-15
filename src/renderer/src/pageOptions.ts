import type { PageOptions } from '../../shared/types'

/** CSS classes of a page for its options. */
export const pageOptionClasses = (options: PageOptions): string =>
  [
    options.fullWidth ? 'opt-full-width' : '',
    options.smallText ? 'opt-small-text' : '',
    options.font && options.font !== 'default' ? `font-${options.font}` : ''
  ]
    .filter(Boolean)
    .join(' ')
