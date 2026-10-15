import { useEffect, useRef } from 'react'

/** Floating panel under its anchor; closes on a click outside or Escape. */
export function Popover({
  onClose,
  children,
  className = '',
  align = 'left'
}: {
  onClose: () => void
  children: React.ReactNode
  className?: string
  align?: 'left' | 'right'
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // Listeners are registered once; they call the latest onClose. Re-registering
  // them on every render (onClose is often an inline function) would drop an
  // Escape or a click that happens while a save re-renders the menu.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    // Listening from the start: an Escape right after opening must close it.
    // The event that opened the popover (dispatched before) is ignored.
    const opened = performance.now()
    const onDown = (e: MouseEvent): void => {
      if (e.timeStamp < opened) return
      if (ref.current && !ref.current.contains(e.target as Node)) close.current()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.timeStamp >= opened && e.key === 'Escape') close.current()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])
  return (
    <div ref={ref} className={`popover ${align === 'right' ? 'align-right' : ''} ${className}`}>
      {children}
    </div>
  )
}
