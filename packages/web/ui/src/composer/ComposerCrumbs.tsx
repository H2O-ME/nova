/**
 * The drilled `@` listing's breadcrumb header — the harness `ui-input-trigger`
 * `MenuView`'s crumbs nav (MIT), over our crumb rows. Pinned above the
 * scrolling viewport: it is not an option, so it sits outside the listbox.
 * A crumb is a mousedown button (the textarea keeps focus, same as a row);
 * the current step renders as a disabled label, not an action.
 */
import { Fragment } from 'react';
import { ChevronRight } from './ComposerMenu.js';
import { REFERENCE_CRUMBS_ARIA } from './composer-text.js';
import { cx } from './cx.js';
import type { ReferenceCrumb } from './reference-crumbs.js';
import css from './ComposerMenu.module.css';

export function ComposerCrumbs({
  crumbs,
  onCrumb,
}: {
  crumbs: readonly ReferenceCrumb[];
  /** A step before the current one was pressed: drill back to its directory. */
  onCrumb: (crumb: ReferenceCrumb) => void;
}): JSX.Element {
  return (
    <nav className={css.crumbs} aria-label={REFERENCE_CRUMBS_ARIA}>
      {crumbs.map((crumb, index) => (
        <Fragment key={`${String(index)}-${crumb.path}`}>
          {index > 0 && (
            <span className={css.crumbSeparator} aria-hidden="true"><ChevronRight /></span>
          )}
          <button
            type="button"
            // Both classes, always: `.crumbCurrent` only overrides ink and
            // cursor — it is not a second shape. Alone it would leave the
            // button with the UA's own border and fill (the harness composes
            // them the same way).
            className={cx(css.crumb, crumb.current && css.crumbCurrent)}
            aria-current={crumb.current ? 'location' : undefined}
            disabled={crumb.current}
            // mousedown, not click: the composer keeps focus, same as a row.
            onMouseDown={(event) => {
              event.preventDefault();
              onCrumb(crumb);
            }}
          >
            {crumb.label}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
