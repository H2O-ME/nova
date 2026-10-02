/**
 * The render-error boundary (`shell/ErrorBoundary.tsx`).
 *
 * The load-bearing behaviour, and the reason this file exists: **a render error
 * must not blank the app.** React unmounts the whole tree when a render throws
 * and nothing catches it — measured in the real product, where one
 * `process.platform` read inside the files panel replaced the entire page with
 * an empty `#root` (the operator's 「侧边栏完全不可用」).
 *
 * Error boundaries do not run during server rendering, so this lane asserts the
 * two halves directly: the state the boundary derives from a thrown value, and
 * the notice it draws for that state.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorBoundary } from '../src/shell/ErrorBoundary.js';
import { SHELL_COPY } from '../src/shell/copy.js';

/** A boundary in the caught state (the class's own render, without a DOM). */
function caught(label: string, message: string): string {
  const boundary = new ErrorBoundary({ label, children: null });
  boundary.state = { message };
  return renderToStaticMarkup(boundary.render() as JSX.Element);
}

describe('render-error boundary', () => {
  it('turns a thrown value into a message, Error or not', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('boom')).message).toBe('boom');
    // A component can throw anything; a notice that says "[object Object]" is
    // still better than an empty page, and this is the honest reading of it.
    expect(ErrorBoundary.getDerivedStateFromError('nope').message).toBe('nope');
  });

  it('names what broke, what the reason was, and the way out', () => {
    const markup = caught(SHELL_COPY['error.label.rightbar'], 'process is not defined');
    expect(markup).toContain(SHELL_COPY['error.title']);
    expect(markup).toContain(SHELL_COPY['error.label.rightbar']);
    expect(markup).toContain('process is not defined');
    expect(markup).toContain(SHELL_COPY['error.reload']);
    // An alert, not a silent box: a reader who is not looking at the column
    // still gets told that something failed.
    expect(markup).toContain('role="alert"');
  });
});
