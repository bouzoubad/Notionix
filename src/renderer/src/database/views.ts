import type { ViewType } from '../../../shared/database'
import { TableView } from './TableView'
import type { ViewProps } from './viewTypes'

/** Views that can be created; the other view types are added in later steps. */
export const VIEW_COMPONENTS: Partial<Record<ViewType, (props: ViewProps) => React.JSX.Element>> = {
  table: TableView
}
