import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../../../shared/i18n'

/**
 * Keeps an error in one part of the window (a page that fails to show) from
 * emptying the whole app: that part shows a message and can be tried again.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; attempt: number }
> {
  state = { error: null as Error | null, attempt: 0 }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Page not shown:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error)
      return (
        <div className="page-error" role="alert">
          <p>{t('Cette page n’a pas pu s’afficher.')}</p>
          <button onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}>
            {t('Réessayer')}
          </button>
        </div>
      )
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}
