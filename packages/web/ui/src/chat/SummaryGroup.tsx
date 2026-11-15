/**
 * A run of same-shaped work rows folded into ONE line — the reference's
 * `ConsecutiveSummaryGroup` (`v4/ConversationTurnGroup.tsx`).
 *
 * Collapsed it is the group's own statistics (「已查阅 6 项，已执行 2 命令」)
 * over the disclosure chrome every other 24px row uses; expanded it is the
 * members, in order, at the same 4px rhythm they have in the flat flow. The
 * reference does exactly this — one summary line whose click reveals the calls
 * it counted — and it is what keeps a twenty-tool turn readable at rest.
 *
 * The statistics come from `summary-group.ts` (pure, testable without a DOM);
 * this file is only the row.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { DisclosureRow } from './DisclosureRow.js';
import { summaryStatistics, type SummaryMemberKind } from './summary-group.js';
import { BashIcon, EditIcon, SearchToolIcon, ToolIcon } from '../tool/icons.js';
import css from './SummaryGroup.module.css';

/** One member: the row to render and what it counts as. */
export interface SummaryGroupMember {
  /** Stable React key (the block id). */
  key: string;
  /** The statistics category this member contributes to. */
  kind: SummaryMemberKind;
  /** The rendered row. */
  node: ReactNode;
  /** The member's work is still in flight. */
  running?: boolean | undefined;
}

export interface SummaryGroupProps {
  members: readonly SummaryGroupMember[];
}

/** The group's leading glyph: the family of its LAST member, which is the act
 *  the group ends on (the reference picks its icon item the same way). */
function groupGlyph(members: readonly SummaryGroupMember[]): JSX.Element {
  const last = members[members.length - 1];
  switch (last?.kind) {
    case 'run':
      return <BashIcon />;
    case 'explore':
      return <SearchToolIcon />;
    case 'change':
      return <EditIcon />;
    default:
      return <ToolIcon />;
  }
}

/**
 * Render one summary group.
 * @param props - see SummaryGroupProps.
 * @returns the group element.
 */
export function SummaryGroup({ members }: SummaryGroupProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  // The group's closure is its LAST member's: a group whose tail is still
  // running reads 「查阅 3 项」 (what is happening now), a settled one
  // 「已查阅 3 项」 (the reference's own split).
  const completed = members.every((member) => member.running !== true);
  const statistics = summaryStatistics(members.map((member) => member.kind), completed);
  return (
    <DisclosureRow
      icon={groupGlyph(members)}
      title={statistics}
      open={expanded}
      expandable
      expandOnRowClick
      running={!completed}
      onToggle={() => { setExpanded((value) => !value); }}
    >
      <div className={css.members} data-summary-group-members="">
        {members.map((member) => (
          <div key={member.key} className={css.member}>{member.node}</div>
        ))}
      </div>
    </DisclosureRow>
  );
}
