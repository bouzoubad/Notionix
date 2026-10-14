import wordmarkLight from '../assets/logo-wordmark-light.png'
import wordmarkDark from '../assets/logo-wordmark-dark.png'
import tileLight from '../assets/logo-tile-light.png'
import tileDark from '../assets/logo-tile-dark.png'

const SOURCES = {
  wordmark: { light: wordmarkLight, dark: wordmarkDark },
  tile: { light: tileLight, dark: tileDark }
}

/** Notionix logo that follows the system colour scheme. */
export function Logo({
  variant,
  className
}: {
  variant: keyof typeof SOURCES
  className?: string
}): React.JSX.Element {
  const { light, dark } = SOURCES[variant]
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet={dark} />
      <img src={light} alt="Notionix" className={className} draggable={false} />
    </picture>
  )
}
