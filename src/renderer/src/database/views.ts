import type { ViewType } from '../../../shared/database'
import { BoardView } from './BoardView'
import { CalendarView } from './CalendarView'
import { GalleryView } from './GalleryView'
import { ListView } from './ListView'
import { TableView } from './TableView'
import type { ViewProps } from './viewTypes'

export const VIEW_COMPONENTS: Record<ViewType, (props: ViewProps) => React.JSX.Element> = {
  table: TableView,
  board: BoardView,
  list: ListView,
  gallery: GalleryView,
  calendar: CalendarView
}
