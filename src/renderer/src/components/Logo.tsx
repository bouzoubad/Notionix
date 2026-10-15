import wordmarkLight from '../assets/logo-wordmark-light.png'
import wordmarkDark from '../assets/logo-wordmark-dark.png'
import tileLight from '../assets/logo-tile-light.png'
import tileDark from '../assets/logo-tile-dark.png'

const SOURCES = {
  wordmark: { light: wordmarkLight, dark: wordmarkDark },
  tile: { light: tileLight, dark: tileDark }
}

/** Notionix logo that follows the theme: forced one, or the system's colour scheme. */
export function Logo({
  variant,
  className
}: {
  variant: keyof typeof SOURCES
  className?: string
}): React.JSX.Element {
  const { light, dark } = SOURCES[variant]
  // Both are in the page; the style sheet shows the one of the theme (forced or the system's).
  return (
    <>
      <img
        src={light}
        alt="Notionix"
        className={`logo-light ${className ?? ''}`}
        draggable={false}
      />
      <img src={dark} alt="Notionix" className={`logo-dark ${className ?? ''}`} draggable={false} />
    </>
  )
}
