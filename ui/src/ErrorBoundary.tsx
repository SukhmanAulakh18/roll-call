import { Component, type ReactNode } from 'react';

/** Top-level boundary: a render error shows a way out instead of a blank page. Reset clears every persisted rc.* setting. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  reset = () => {
    try { Object.keys(localStorage).filter((k) => k.startsWith('rc.')).forEach((k) => localStorage.removeItem(k)); } catch { /* storage unavailable */ }
    location.hash = '#/';
    location.reload();
  };
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <main className="page" role="alert">
        <h1>Something on this screen failed to draw</h1>
        <p className="muted">{this.state.err.message}</p>
        <p>Saved view settings (lens, theme) can cause this. Resetting clears them and reloads.</p>
        <button className="btn btn--primary" onClick={this.reset}>Reset view</button>
      </main>
    );
  }
}
