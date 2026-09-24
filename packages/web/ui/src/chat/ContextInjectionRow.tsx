/**
 * The disclosure row for one section of the seeded context fragment — port of
 * the harness `ui-chat` `ContextInjectionRow.tsx`: a 24px row naming what the
 * context is and which producer contributed it, expanding into a bounded code
 * body.
 *
 * The harness reads four facts off a durable context node (`content`, `source`,
 * `provenance`, `form`) and picks a body per declared form. This kernel records
 * the fragment as one user message with tagged sections, so the same four facts
 * arrive as: the section's bytes (`text`), the tag (producer), and the form
 * `core` read off that section's own syntax — `snapshot` for the environment's
 * `key=value` lines, `catalog` for the skills index, `text` otherwise. An
 * unknown tag still renders, in the text form, which is the harness's own rule
 * for a form this build has never seen.
 */
import { useState } from 'react';
import { DisclosureRow } from './DisclosureRow.js';
import { InjectionGlyph14 } from './glyphs.js';
import { CONTEXT_ROW_TITLE, contextLabel } from './context-copy.js';
import css from './ContextInjectionRow.module.css';

export interface ContextInjectionRowProps {
  /** The fragment tag this section came from (names the producer). */
  tag: string;
  /** Which body shape the section's bytes support (`core` decided). */
  form: 'snapshot' | 'catalog' | 'text';
  /** `snapshot`: the section's own name/value rows. */
  sections?: readonly { name: string; text: string }[] | undefined;
  /** `catalog`: the published entries. */
  entries?: readonly { name: string; description: string }[] | undefined;
  /** `catalog`: the section's non-entry lines. */
  note?: string | undefined;
  /** The model-facing bytes, verbatim. */
  text: string;
}

/** The body for one form: rows for a snapshot, a list for a catalog, bytes otherwise. */
function ContextBody({
  form,
  sections,
  entries,
  note,
  text,
}: Omit<ContextInjectionRowProps, 'tag'>): JSX.Element {
  if (form === 'snapshot' && sections !== undefined) {
    return (
      <dl className={css.sections} data-context-sections="">
        {sections.map((section) => (
          <div key={section.name} className={css.section}>
            <dt className={css.sectionName}>{section.name}</dt>
            <dd className={css.sectionText}>{section.text}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (form === 'catalog' && entries !== undefined) {
    return (
      <>
        <ul className={css.entries} data-context-entries="">
          {entries.map((entry, index) => (
            // Index key: a hand-edited or foreign log may repeat a name, and a
            // duplicate React key would drop a row the model did see.
            <li key={index} className={css.entry}>
              <code className={css.entryName}>{entry.name}</code>
              <span className={css.entryDescription}>{entry.description}</span>
            </li>
          ))}
        </ul>
        {/* The section's own closing prose is model-facing too: it stays under
            the list rather than being reprinted inside it. */}
        {note !== undefined && <p className={css.note} data-context-note="">{note}</p>}
      </>
    );
  }
  return <pre className={css.text}>{text}</pre>;
}

/**
 * Render one context section as a collapsed row with a bounded body.
 * @param props - see ContextInjectionRowProps.
 * @returns the disclosure row.
 */
export function ContextInjectionRow({
  tag,
  form,
  sections,
  entries,
  note,
  text,
}: ContextInjectionRowProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <DisclosureRow
      className={css.root}
      icon={<InjectionGlyph14 />}
      chevronClassName={css.chevron}
      title={CONTEXT_ROW_TITLE}
      collapsedContent={
        /* ToolRow's separator shape: an aria-hidden dot, so the accessible name
           stays the two readable parts and the two disclosure rows expose one
           name shape. */
        <>
          <span className={css.sep} aria-hidden="true" />
          <span className={css.source} data-context-source="">{contextLabel(tag)}</span>
        </>
      }
      keepContentWhenOpen
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen((value) => !value); }}
    >
      <div className={css.body} data-context-injection-body="" data-context-form={form}>
        <ContextBody form={form} sections={sections} entries={entries} note={note} text={text} />
      </div>
    </DisclosureRow>
  );
}