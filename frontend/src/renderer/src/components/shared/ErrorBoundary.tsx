import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

interface Props {
  children: ReactNode
  /** Optional label to show in the error card. */
  label?: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className="p-3 border border-neon-red bg-neon-red/5 rounded text-[11px] text-neon-red font-mono">
          <div className="mb-2 uppercase tracking-wider">
            {this.props.label ?? 'UI Error'}
          </div>
          <pre className="text-text-secondary whitespace-pre-wrap break-words text-[10px]">
            {this.state.error.message}
          </pre>
          <button
            onClick={this.reset}
            className="mt-2 px-2 py-1 border border-neon-red text-neon-red hover:bg-neon-red/10 cursor-pointer rounded text-[10px]"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
