import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Optional label shown in the error message (e.g. "Overview Tab") */
  label?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-10 text-center">
          <AlertTriangle size={28} className="text-danger/60" />
          <div>
            <p className="text-sm font-semibold text-heading mb-1">
              {this.props.label ? `${this.props.label} failed to load` : 'Something went wrong'}
            </p>
            <p className="text-xs text-muted font-mono max-w-xs">{this.state.error.message}</p>
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="flex items-center gap-1.5 px-4 py-1.5 border border-border text-xs text-muted hover:text-heading hover:bg-surface2 transition-colors rounded-lg"
          >
            <RefreshCw size={11} /> Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
