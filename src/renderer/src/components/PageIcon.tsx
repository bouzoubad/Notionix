import { displaySrc } from '../platform'
import { isImageIcon } from '../icons'
import { isPictogram, parsePictogram } from '../pictograms'
import { PictogramIcon } from './PictogramIcon'

/** A page's icon: its emoji, its image, or a pictogram. */
export function PageIcon({
  icon,
  fallback = '',
  className = ''
}: {
  icon: string | null | undefined
  fallback?: string
  className?: string
}): React.JSX.Element {
  if (isImageIcon(icon))
    return (
      <img
        className={`page-icon-image ${className}`}
        src={displaySrc(icon)}
        alt=""
        draggable={false}
      />
    )
  if (isPictogram(icon)) {
    const p = parsePictogram(icon)
    if (p) return <PictogramIcon name={p.name} color={p.color} className={className} />
  }
  return <>{icon ?? fallback}</>
}
