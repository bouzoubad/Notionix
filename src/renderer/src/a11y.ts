/**
 * Dialogs for keyboard and screen-reader users, wherever they are drawn
 * (`.overlay > .dialog`): announced as modal dialogs, the focus moves into
 * them, Tab stays inside, and the focus goes back where it was on closing.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

export function installDialogFocus(): () => void {
  const returnTo = new WeakMap<Element, HTMLElement | null>()
  // What had the focus outside dialogs: a dialog's own autofocus runs before it is seen here.
  let lastOutside: HTMLElement | null = null
  const onFocusIn = (e: FocusEvent): void => {
    const target = e.target
    if (target instanceof HTMLElement && !target.closest('.overlay')) lastOutside = target
  }
  document.addEventListener('focusin', onFocusIn)
  const topDialog = (): HTMLElement | null => {
    const all = document.querySelectorAll<HTMLElement>('.overlay > .dialog')
    return all[all.length - 1] ?? null
  }
  const prepare = (dialog: HTMLElement): void => {
    if (returnTo.has(dialog)) return
    returnTo.set(dialog, lastOutside)
    if (!dialog.getAttribute('role')) dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const heading = dialog.querySelector('h1, h2, h3')
    if (heading && !dialog.hasAttribute('aria-labelledby') && !dialog.hasAttribute('aria-label')) {
      heading.id ||= `dialog-title-${Math.random().toString(36).slice(2, 8)}`
      dialog.setAttribute('aria-labelledby', heading.id)
    }
    // Into the dialog, unless a field there already took the focus (autoFocus).
    queueMicrotask(() => {
      if (!dialog.contains(document.activeElement))
        (dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus()
    })
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1
  }
  const known = new Set<HTMLElement>()
  const observer = new MutationObserver(() => {
    const open = new Set(document.querySelectorAll<HTMLElement>('.overlay > .dialog'))
    for (const d of open) if (!known.has(d)) prepare(d)
    for (const d of known)
      if (!open.has(d)) {
        // Closed: back to what had the focus, if it is still there.
        // Only when the focus was lost with it: a page opened from the dialog keeps its own.
        const back = returnTo.get(d)
        const lost = !document.activeElement || document.activeElement === document.body
        if (back?.isConnected && !topDialog() && lost) back.focus()
      }
    known.clear()
    for (const d of open) known.add(d)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return
    const dialog = topDialog()
    if (!dialog) return
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null
    )
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    const inside = dialog.contains(document.activeElement)
    if (e.shiftKey && (document.activeElement === first || !inside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
      e.preventDefault()
      first.focus()
    }
  }
  // Escape closes the top dialog wherever the focus is in it, once menus
  // inside it (which mark the key as handled) are closed.
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    const dialog = topDialog()
    if (!dialog || !dialog.contains(document.activeElement)) return
    dialog.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  }
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('keydown', onEscape)
  return () => {
    observer.disconnect()
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('keydown', onEscape)
    document.removeEventListener('focusin', onFocusIn)
  }
}
