import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

/** 最外层兜底：任何面板渲染异常都不要让整窗变成白屏。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ui] ${this.props.label || '界面'}渲染失败`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-crash">
        <div className="app-crash-card">
          <h2>界面出错了</h2>
          <p>当前面板渲染异常，页面和标签数据不会丢失。可以重试或重启应用。</p>
          <pre>{String(this.state.error.message || this.state.error)}</pre>
          <div className="app-crash-actions">
            <button className="mini-btn primary" onClick={() => this.setState({ error: null })}>
              重试
            </button>
            <button className="mini-btn" onClick={() => window.location.reload()}>
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}
