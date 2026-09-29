/**
 * What the QQ channel is FOR: the remote-control vocabulary, as a static list.
 *
 * Split from `QqbotSection.tsx` because it is a different kind of thing from the
 * rest of that page. The page's job is a form — read the snapshot, edit two
 * fields, send save/probe — while this is product copy that never changes with
 * the connection. It also carries the answer the page used to be missing: two
 * credential fields with no statement of purpose never told a reader that
 * configuring this would let them drive a running nova from their phone.
 *
 * Every line names a slash command the kernel already answers, so this block
 * describes a capability rather than configuring one.
 */
import { SETTINGS_COPY } from './copy.js';
import css from './QqbotSection.module.css';

/**
 * Render the remote-control guide.
 * @returns the guide element tree.
 */
export function QqbotGuide(): JSX.Element {
  return (
    <div className={css.guide}>
      <div className={css.guideTitle}>{SETTINGS_COPY['qqbot.guideTitle']}</div>
      <ul className={css.guideList}>
        {GUIDE.map((line) => <li key={line} className={css.guideItem}>{line}</li>)}
      </ul>
    </div>
  );
}

/** The commands the channel accepts, in the order a reader meets them. */
const GUIDE: readonly string[] = [
  SETTINGS_COPY['qqbot.guidePerm'],
  SETTINGS_COPY['qqbot.guideApprove'],
  SETTINGS_COPY['qqbot.guideModel'],
  SETTINGS_COPY['qqbot.guideWorkspace'],
  SETTINGS_COPY['qqbot.guideSession'],
];
