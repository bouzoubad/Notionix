/** Icons are an emoji, or a stored image (notionix-asset://…). */
export const isImageIcon = (icon: string | null | undefined): icon is string =>
  !!icon && icon.startsWith('notionix-asset://')

/** Icon as text, where only text fits (menus, notices): an image shows as 🖼️. */
export const iconText = (icon: string | null | undefined, fallback = '📄'): string =>
  isImageIcon(icon) ? '🖼️' : (icon ?? fallback)
