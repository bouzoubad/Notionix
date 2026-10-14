import type { NotionixApi } from '../shared/types'

declare global {
  interface Window {
    api: NotionixApi
  }
}
