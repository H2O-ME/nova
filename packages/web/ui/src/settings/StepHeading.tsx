/**
 * One step heading for the 模型 page.
 *
 * The page is a three-step flow — add a provider → fetch its catalog → pick the
 * models and their capabilities — but it was three sibling `<h2>`s in one scroll
 * column, so a reader saw three parallel titles and no indication that they are
 * a sequence (the reported 「不是让用户看不懂」). The steps are therefore numbered
 * IN the heading, which is the part the page owns: the sections cannot reorder
 * themselves, and the shell that stacks them is another task's file.
 *
 * The vocabulary is the reference's: a numbered marker, the title, then one line
 * of intent. The marker is `aria-hidden` — the step number is also written into
 * the heading's own accessible name, so a screen reader hears "第 1 步，供应商"
 * rather than an orphaned digit.
 */
import css from './StepHeading.module.css';

export interface StepHeadingProps {
  /** Which step this is, counting from 1. */
  step: number;
  /** The step's title. */
  title: string;
  /** One line saying what this step produces. */
  intro: string;
}

/**
 * Render a numbered step heading.
 * @param props - see StepHeadingProps.
 * @returns the heading element tree.
 */
export function StepHeading({ step, title, intro }: StepHeadingProps): JSX.Element {
  const label = `第 ${String(step)} 步`;
  return (
    <>
      <h2 className={css.heading}>
        {/* The step number is written as words, not as a bare digit: "第 1 步"
            reads correctly aloud and needs no hidden duplicate. */}
        <span className={css.mark}>{label}</span>
        <span className={css.title}>{title}</span>
      </h2>
      <p className={css.intro}>{intro}</p>
    </>
  );
}
