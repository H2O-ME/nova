/**
 * Focus presentation for automatic entry and restoration, ported from
 * deepseek-harness `ui-primitives/focus.ts` (c) 2026 DeepSeek — MIT License.
 */

const releases = new WeakMap<HTMLElement, () => void>();
const navigationKeys = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

/**
 * Focus an automatic destination without a focus outline until keyboard
 * navigation or blur (`styles/focus.css` suppresses ring paint while
 * `data-dsh-automatic-focus` is present; borders and shadows remain intact).
 * Tab and directional navigation restore normal focus styling.
 * @param element - control or container receiving automatic focus.
 * @param options - browser focus options, including scroll preservation.
 */
export function focusWithoutRing(element: HTMLElement, options?: FocusOptions): void {
  releases.get(element)?.();
  const release = (): void => {
    element.removeAttribute('data-dsh-automatic-focus');
    element.removeEventListener('blur', release);
    element.removeEventListener('keydown', navigate, true);
    releases.delete(element);
  };
  const navigate = (event: KeyboardEvent): void => {
    if (!event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey && navigationKeys.has(event.key)) release();
  };
  releases.set(element, release);
  element.setAttribute('data-dsh-automatic-focus', '');
  element.addEventListener('blur', release);
  element.addEventListener('keydown', navigate, true);
  element.focus(options);
  if (!element.matches(':focus')) release();
}
