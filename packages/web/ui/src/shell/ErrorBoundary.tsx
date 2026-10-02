/**
 * The render-error boundary: a broken component shows a notice, never a blank page.
 *
 * **Why this exists.** React unmounts the whole tree when a render throws, and
 * this app had no boundary at all — so one bad expression ANYWHERE (measured:
 * `process.platform` inside the files panel, which is not defined in a browser)
 * replaced the entire product with an empty `#root`. The reader's report was
 * 「侧边栏功能处于完全不可用状态」, and it was literally true: opening the sidebar
 * blanked the app. A panel that cannot draw must cost the reader the panel.
 *
 * Two boundaries, on purpose: the entry wraps the whole app (last resort), and
 * the right column wraps its contents (so a panel bug degrades to a notice
 * inside the column while the conversation stays usable). `resetKey` gives a
 * caught error an exit: switching panel or tab mounts a fresh try instead of
 * leaving the notice up for the rest of the session.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { SHELL_COPY } from './copy.js';
import css from './ErrorBoundary.module.css';

export interface ErrorBoundaryProps {
  /** Which part is being guarded — named in the notice (`SHELL_COPY`). */
  label: string;
  children: ReactNode;
  /**
   * Changing this clears a caught error. The identity of what is on screen, not
   * a counter: the reader switching tabs is asking for a different component,
   * and that component deserves its own try.
   */
  resetKey?: string | number | undefined;
}

interface ErrorBoundaryState {
  /** The caught error's message, or null while nothing has thrown. */
  message: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The console is the only channel left: the notice tells the reader what
    // happened, and the stack is what a developer needs to fix it.
    console.error(`${this.props.label} failed to render`, error, info.componentStack);
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.message !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ message: null });
    }
  }

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <div className={css.notice} role="alert">
        <p className={css.title}>{SHELL_COPY['error.title']}</p>
        <p className={css.note}>
          {SHELL_COPY['error.note']
            .replace('{label}', this.props.label)
            .replace('{message}', this.state.message)}
        </p>
        <button
          type="button"
          className={css.reload}
          onClick={() => { window.location.reload(); }}
        >
          {SHELL_COPY['error.reload']}
        </button>
      </div>
    );
  }
}
