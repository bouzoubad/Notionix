import { displaySrc } from '../platform'
import { isImageIcon } from '../icons'

/** A page's icon: its emoji or its image. */
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
  return <>{icon ?? fallback}</>
}
