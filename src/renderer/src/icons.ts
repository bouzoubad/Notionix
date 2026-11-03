/** Icons are an emoji, a stored image (notionix-asset://…), or a pictogram (icon:<name>:<colour>). */
export const isImageIcon = (icon: string | null | undefined): icon is string =>
  !!icon && icon.startsWith('notionix-asset://')

/** Icon as text, where only text fits (menus, notices): an image shows as 🖼️, a pictogram as the fallback. */
export function iconText(icon: string | null | undefined, fallback = '📄'): string {
  if (!icon) return fallback
  if (icon.startsWith('notionix-asset://')) return '🖼️'
  return icon.startsWith('icon:') ? fallback : icon
}
