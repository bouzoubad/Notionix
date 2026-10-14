import type { CSSProperties } from 'react'

/** Gradient covers; the value stored in the page is `gradient:<index>`. */
export const GRADIENT_COVERS = [
  'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)',
  'linear-gradient(120deg, #f6d365 0%, #fda085 100%)',
  'linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%)',
  'linear-gradient(120deg, #6c6cf5 0%, #a18cd1 100%)',
  'linear-gradient(120deg, #ff9a9e 0%, #fecfef 100%)',
  'linear-gradient(120deg, #434343 0%, #000000 100%)'
]

export function coverStyle(cover: string): CSSProperties {
  const gradient = /^gradient:(\d+)$/.exec(cover)
  if (gradient)
    return { backgroundImage: GRADIENT_COVERS[Number(gradient[1])] ?? GRADIENT_COVERS[0] }
  // Covers are stored images (notionix-asset://…); anything else is ignored.
  return cover.startsWith('notionix-asset://') ? { backgroundImage: `url("${cover}")` } : {}
}
