import { createElement, useEffect, useState } from 'react'
import { loadPictograms, pictogramColor, pictogramNode, type IconNode } from '../pictograms'

/** A pictogram (Lucide), drawn with the current text size in its colour. */
export function PictogramIcon({
  name,
  color,
  className = ''
}: {
  name: string
  color: string
  className?: string
}): React.JSX.Element {
  const [node, setNode] = useState<IconNode | null>(() => pictogramNode(name))
  useEffect(() => {
    if (node) return
    let cancelled = false
    void loadPictograms().then(() => !cancelled && setNode(pictogramNode(name)))
    return () => {
      cancelled = true
    }
  }, [name, node])
  return (
    <svg
      className={`pictogram ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: pictogramColor(color) }}
      aria-hidden
    >
      {node?.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  )
}
