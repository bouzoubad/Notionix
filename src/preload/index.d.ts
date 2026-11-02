import type { NotionixApi } from '../shared/types'
import type { DesktopBridge } from '../shared/desktop'

declare global {
  interface Window {
    api: NotionixApi
    /** Desktop app only (absent in the web client) */
    desktop?: DesktopBridge
  }
}
