/** Scheme serving images stored by Notionix: notionix-asset://file/<sha256>.<ext> */
export const ASSET_SCHEME = 'notionix-asset'

export const ASSET_NAME = /^[0-9a-f]{64}\.(png|jpg|gif|webp|svg|avif|bmp)$/

export const assetSrc = (name: string): string => `${ASSET_SCHEME}://file/${name}`

/** Stored file name of an asset src, or null when `src` is not a Notionix asset. */
export function assetNameFromSrc(src: string): string | null {
  const prefix = `${ASSET_SCHEME}://file/`
  if (!src.startsWith(prefix)) return null
  const name = src.slice(prefix.length)
  return ASSET_NAME.test(name) ? name : null
}
