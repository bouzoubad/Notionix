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
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Registered after the click that opened the popover has finished.
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
    })
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div ref={ref} className={`popover ${align === 'right' ? 'align-right' : ''} ${className}`}>
      {children}
    </div>
  )
}
