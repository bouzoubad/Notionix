import type { ViewType } from '../../../shared/database'
import { BoardView } from './BoardView'
import { CalendarView } from './CalendarView'
import { GalleryView } from './GalleryView'
import { ListView } from './ListView'
import { TableView } from './TableView'
import type { ViewProps } from './viewTypes'
import { TimelineView } from './TimelineView'
import { ChartView } from './ChartView'
import { FormView } from './FormView'

export const VIEW_COMPONENTS: Record<ViewType, (props: ViewProps) => React.JSX.Element> = {
  table: TableView,
  board: BoardView,
  list: ListView,
  gallery: GalleryView,
  calendar: CalendarView,
  timeline: TimelineView,
  chart: ChartView,
  form: FormView
}
