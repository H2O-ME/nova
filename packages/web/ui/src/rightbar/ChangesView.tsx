/**
 * 变更: two LENSES on "what changed", one on screen at a time.
 *
 * The workspace's git state comes from the host's git runner — two groups of
 * changed files (未暂存 / 已暂存), each folded into a directory tree, the diff of
 * the row the reader opened, a commit box, and the recent log. The session's own
 * edits come from the transcript (the model's tool calls, projected into file
 * shapes by `changes-model.ts`). They answer different questions, so they are a
 * switch rather than two stacked sections: each lens gets the whole column.
 *
 * The git side is the reference's (`dsh-better-sidebar` `changes/GitLens.tsx`,
 * MIT): sticky group headers with the group's own batch verb, a hover-revealed
 * stage/unstage button on every row and directory, the diff below with line
 * numbers and hunk headers, and the log's hash + subject rows.
 *
 * This page no longer shows 「正在读取 git 状态…」 forever: the host caches the
 * status answer (`web/src/git-frames.ts`), so opening the page, switching to it
 * and refreshing all resolve against one answer instead of a fresh `git status`
 * per look.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, RefreshIcon } from '../icons.js';
import type { ClientFrame, GitStatusEntry } from '../types.js';
import type { GitState } from '../state.js';
import { RIGHTBAR_COPY } from './copy.js';
import { fileSummary, type ChangedFile, type ChangesModel } from './changes-model.js';
import { buildChangeTree, type ChangeNode } from './change-tree.js';
import { relativeStamp } from '../sidebar/relative-time.js';
import { diffStatRows, folds, parseUnifiedDiff, type DiffRow } from './git-diff-rows.js';
import { highlightDiffRows } from './diff-highlight.js';
import { TOKEN_VAR, type HlLine } from '../chat/markdown/highlight.js';
import { StageGlyph, UnstageGlyph, EditGlyph } from './panel-icons.js';
import { Chip, CountPill, IconButton, Notice, SectionHeader, StatusBadge, type StatusTone } from './kit.js';
import { GitSetup } from './GitSetup.js';
import { cx } from '../composer/cx.js';
import css from './ChangesView.module.css';

/** Which question the page is answering: the repo's, or this session's. */
export type ChangesLens = 'git' | 'session';

export interface ChangesViewProps {
  /** The transcript-derived edits (what THIS session changed). */
  model: ChangesModel;
  /** The host's git lens (null until the first `git_status` lands). */
  git: GitState | null;
  /** Whether the WS is connected (a disconnected panel cannot refresh). */
  connected: boolean;
  /** A `git_clone` is in flight; the host answers with a re-stated baseline. */
  clonePending?: boolean | undefined;
  /** Open the workspace picker (the setup card's 打开文件夹); absent = no button. */
  onOpenWorkspace?: (() => void) | undefined;
  /** Open a changed file in the files page's editor; absent = no per-row verb. */
  onOpenFile?: ((path: string) => void) | undefined;
  /** The lens in force; uncontrolled (remembered locally) when omitted. */
  lens?: ChangesLens | undefined;
  onPickLens?: ((lens: ChangesLens) => void) | undefined;
  send: (frame: ClientFrame) => void;
}

export function ChangesView({
  model,
  git,
  connected,
  clonePending,
  onOpenWorkspace,
  onOpenFile,
  send,
  lens: controlled,
  onPickLens,
}: ChangesViewProps): JSX.Element {
  const [ownLens, setOwnLens] = useState<ChangesLens>('git');
  const lens = controlled ?? ownLens;
  const pickLens = (next: ChangesLens): void => {
    if (onPickLens !== undefined) onPickLens(next);
    else setOwnLens(next);
  };
  // Opening the page asks git for the current status: it is the question a
  // reader comes here for and the answer ages out (a commit mid-session changes
  // what is "pending"). The host memoizes it, so this ask is cheap.
  useEffect(() => {
    if (connected) send({ type: 'git_status' });
  }, [connected, send]);
  // The log is asked for ONCE per repo: nothing on this page mutates history
  // except a commit, whose own answer carries the fresh status — the log
  // refreshes on the next mount.
  const hasLog = git !== null && git.repo && git.log.length > 0;
  useEffect(() => {
    if (connected && git !== null && git.repo && !hasLog) send({ type: 'git_log' });
  }, [connected, git, hasLog, send]);

  return (
    <div className={css.page}>
      <header className={css.head}>
        <div className={css.lens} role="tablist" aria-label={RIGHTBAR_COPY['changes.lens.label']}>
          {(['git', 'session'] as const).map((id) => (
            <Chip key={id} selected={lens === id} onClick={() => { pickLens(id); }}>
              {id === 'git' ? RIGHTBAR_COPY['changes.lens.git'] : RIGHTBAR_COPY['changes.lens.session']}
            </Chip>
          ))}
        </div>
        {git !== null && git.repo && (
          <span className={css.branch} title={RIGHTBAR_COPY['git.branch'].replace('{branch}', git.branch)}>
            {git.branch}
          </span>
        )}
        {lens === 'git' && (
          <IconButton label={RIGHTBAR_COPY['git.refresh']} onClick={() => { send({ type: 'git_status' }); }} disabled={!connected}>
            <RefreshIcon />
          </IconButton>
        )}
      </header>
      {lens === 'git' ? (
        <GitLens
          git={git}
          connected={connected}
          clonePending={clonePending}
          onOpenWorkspace={onOpenWorkspace}
          onOpenFile={onOpenFile}
          send={send}
        />
      ) : (
        <TranscriptLens model={model} />
      )}
    </div>
  );
}

/** The repo's own answer: two groups, a diff, a commit box, a log. */
function GitLens({
  git,
  connected,
  clonePending,
  onOpenWorkspace,
  onOpenFile,
  send,
}: {
  git: GitState | null;
  connected: boolean;
  clonePending: boolean | undefined;
  onOpenWorkspace: (() => void) | undefined;
  onOpenFile: ((path: string) => void) | undefined;
  send: (frame: ClientFrame) => void;
}): JSX.Element {
  if (git === null) return <Notice kind="loading">{RIGHTBAR_COPY['git.loading']}</Notice>;
  if (!git.repo) return <GitSetup connected={connected} clonePending={clonePending} onOpenWorkspace={onOpenWorkspace} send={send} />;

  const staged = git.entries.filter((entry) => isStaged(entry));
  const unstaged = git.entries.filter((entry) => !isStaged(entry));
  const clean = staged.length === 0 && unstaged.length === 0;
  return (
    <div className={css.lensBody}>
      <div className={css.groups}>
        {git.message !== undefined && <Notice kind="hint">{git.message}</Notice>}
        {clean && <Notice kind="empty">{RIGHTBAR_COPY['git.empty']}</Notice>}
        {unstaged.length > 0 && (
          <ChangeGroup
            label={RIGHTBAR_COPY['git.unstagedSection']}
            entries={unstaged}
            staged={false}
            selectedPath={git.diff?.path ?? null}
            selectedStaged={git.diff?.staged ?? false}
            connected={connected}
            onOpenFile={onOpenFile}
            send={send}
          />
        )}
        {staged.length > 0 && (
          <ChangeGroup
            label={RIGHTBAR_COPY['git.stagedSection']}
            entries={staged}
            staged
            selectedPath={git.diff?.path ?? null}
            selectedStaged={git.diff?.staged ?? false}
            connected={connected}
            onOpenFile={onOpenFile}
            send={send}
          />
        )}
      </div>
      {git.diff !== null && <DiffPane diff={git.diff} />}
      <CommitBar send={send} hasStaged={staged.length > 0} />
      {git.log.length > 0 && (
        <div className={css.logWrap}>
          <SectionHeader label={RIGHTBAR_COPY['git.log']} count={git.log.length} />
          <ul className={css.log}>
            {git.log.map((entry) => (
              <li key={entry.hash} className={css.logRow} title={entry.hash}>
                <span className={css.logHash}>{entry.short}</span>
                <span className={css.logSubject}>{entry.subject}</span>
                <span className={css.logMeta}>
                  {entry.author} · {relativeStamp(Date.parse(entry.date), Date.now())}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Whether an entry belongs to the index side (the staged group). */
function isStaged(entry: GitStatusEntry): boolean {
  return entry.index !== ' ' && entry.index !== '?';
}

interface GroupProps {
  label: string;
  entries: readonly GitStatusEntry[];
  staged: boolean;
  /** The file whose diff is on screen (its row keeps the accent bar). */
  selectedPath: string | null;
  selectedStaged: boolean;
  connected: boolean;
  /** Open a file in the files page's editor; absent = no per-row verb. */
  onOpenFile: ((path: string) => void) | undefined;
  send: (frame: ClientFrame) => void;
}

/** One status group: a sticky header with its batch verb, then its directory tree. */
function ChangeGroup({ label, entries, staged, selectedPath, selectedStaged, connected, onOpenFile, send }: GroupProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const nodes = useMemo(() => buildChangeTree(entries), [entries]);
  const verb = staged ? RIGHTBAR_COPY['git.unstageAll'] : RIGHTBAR_COPY['git.stageAll'];
  return (
    <section className={css.group}>
      <div className={css.groupHead}>
        <SectionHeader
          label={label}
          count={<CountPill n={entries.length} />}
          action={(
            <button
              type="button"
              className={css.headVerb}
              aria-label={verb}
              title={verb}
              disabled={!connected}
              onClick={() => { send({ type: staged ? 'git_unstage' : 'git_stage', paths: entries.map((entry) => entry.path) }); }}
            >
              {staged ? <UnstageGlyph /> : <StageGlyph />}
            </button>
          )}
        />
      </div>
      <div className={css.tree}>
        {nodes.map((node) => (
          <ChangeNodeRow
            key={node.kind === 'dir' ? `d:${node.path}` : `f:${node.path}`}
            node={node}
            depth={0}
            staged={staged}
            selectedPath={selectedPath}
            selectedStaged={selectedStaged}
            connected={connected}
            collapsed={collapsed}
            onToggle={(path) => { setCollapsed((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path])); }}
            onOpenFile={onOpenFile}
            send={send}
          />
        ))}
      </div>
    </section>
  );
}

interface NodeRowProps {
  node: ChangeNode;
  depth: number;
  staged: boolean;
  /** The file whose diff is on screen (its row keeps the accent bar). */
  selectedPath: string | null;
  selectedStaged: boolean;
  connected: boolean;
  collapsed: readonly string[];
  onToggle: (path: string) => void;
  /** Open a file in the files page's editor; absent = no per-row verb. */
  onOpenFile: ((path: string) => void) | undefined;
  send: (frame: ClientFrame) => void;
}

/** One row of a change tree: a file (with its stage verb) or a directory. */
function ChangeNodeRow({
  node,
  depth,
  staged,
  selectedPath,
  selectedStaged,
  connected,
  collapsed,
  onToggle,
  onOpenFile,
  send,
}: NodeRowProps): JSX.Element {
  const indent = depth * 12 + 6;
  if (node.kind === 'dir') {
    const open = !collapsed.includes(node.path);
    return (
      <>
        <div className={css.row}>
          <button type="button" className={css.rowMain} style={{ paddingLeft: indent }} onClick={() => { onToggle(node.path); }}>
            <span className={css.chevron} data-open={open ? '' : undefined}>
              {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </span>
            <span className={css.dirName}>{node.name}</span>
            <CountPill n={node.changes} />
          </button>
          <button
            type="button"
            className={css.rowVerb}
            aria-label={staged ? RIGHTBAR_COPY['git.unstage'] : RIGHTBAR_COPY['git.stage']}
            title={staged ? RIGHTBAR_COPY['git.unstage'] : RIGHTBAR_COPY['git.stage']}
            disabled={!connected}
            onClick={() => { send({ type: staged ? 'git_unstage' : 'git_stage', paths: [node.path] }); }}
          >
            {staged ? <UnstageGlyph /> : <StageGlyph />}
          </button>
        </div>
        {open && node.children.map((child) => (
          <ChangeNodeRow
            key={child.kind === 'dir' ? `d:${child.path}` : `f:${child.path}`}
            node={child}
            depth={depth + 1}
            staged={staged}
            selectedPath={selectedPath}
            selectedStaged={selectedStaged}
            connected={connected}
            collapsed={collapsed}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
            send={send}
          />
        ))}
      </>
    );
  }
  const selected = selectedPath === node.path && selectedStaged === staged;
  return (
    <div className={css.row} data-selected={selected ? '' : undefined}>
      <button
        type="button"
        className={css.rowMain}
        style={{ paddingLeft: indent }}
        title={node.path}
        onClick={() => { send({ type: 'git_diff', path: node.path, staged }); }}
      >
        <span className={css.chevron} data-leaf="" />
        <StatusBadge tone={toneOf(node.mark.tone)}>{node.mark.letter}</StatusBadge>
        <span className={cx(css.fileName, badgeToneCss(node.mark.tone))}>{node.name}</span>
      </button>
      <button
        type="button"
        className={css.rowVerb}
        aria-label={staged ? RIGHTBAR_COPY['git.unstage'] : RIGHTBAR_COPY['git.stage']}
        title={staged ? RIGHTBAR_COPY['git.unstage'] : RIGHTBAR_COPY['git.stage']}
        disabled={!connected}
        onClick={() => { send({ type: staged ? 'git_unstage' : 'git_stage', paths: [node.path] }); }}
      >
        {staged ? <UnstageGlyph /> : <StageGlyph />}
      </button>
      {onOpenFile !== undefined && (
        <button
          type="button"
          className={css.rowVerb}
          aria-label={RIGHTBAR_COPY['git.openEditor']}
          title={RIGHTBAR_COPY['git.openEditor']}
          onClick={() => { onOpenFile(node.path); }}
        >
          <EditGlyph />
        </button>
      )}
    </div>
  );
}

/** The badge tone for a git letter. */
function toneOf(tone: 'staged' | 'changed' | 'untracked' | 'conflict'): StatusTone {
  if (tone === 'changed') return 'modified';
  if (tone === 'untracked') return 'added';
  if (tone === 'conflict') return 'deleted';
  return 'renamed';
}

/** The row-name ink for a letter's tone. */
function badgeToneCss(tone: 'staged' | 'changed' | 'untracked' | 'conflict'): string | undefined {
  if (tone === 'changed') return css.inkModified;
  if (tone === 'untracked' || tone === 'staged') return css.inkAdded;
  if (tone === 'conflict') return css.inkDeleted;
  return css.inkRenamed;
}

/** The open file's diff: its head, its hunks, and its line numbers. */
function DiffPane({ diff }: { diff: NonNullable<GitState['diff']> }): JSX.Element {
  const rows = useMemo(() => parseUnifiedDiff(diff.text), [diff.text]);
  const stat = useMemo(() => diffStatRows(rows), [rows]);
  // One scan of the file's whole content, zipped back onto the rows — the
  // block comment that opened three rows ago must still color this row.
  const highlighted = useMemo(() => highlightDiffRows(rows, diff.path), [rows, diff.path]);
  return (
    <div className={css.diff}>
      <div className={css.diffHead}>
        <span className={css.diffPath} title={diff.path}>{diff.path}</span>
        <span className={css.diffStat}>
          <span className={css.statAdd}>+{stat.added}</span>
          <span className={css.statDel}>−{stat.removed}</span>
        </span>
        <span className={css.diffSide}>{diff.staged ? RIGHTBAR_COPY['git.stagedSection'] : RIGHTBAR_COPY['git.unstagedSection']}</span>
      </div>
      {/* An untracked file answers its own content as an all-added diff; the
          note is only for the cases that CANNOT render (binary / oversized /
          empty), where inventing or omitting silently would both lie. */}
      {diff.untracked && diff.text === '' && <Notice kind="hint">{RIGHTBAR_COPY['git.untrackedNote']}</Notice>}
      <div className={css.diffBody}>
        {rows.map((row, index) => <DiffLine key={index} row={row} hl={highlighted[index]} />)}
      </div>
      {diff.truncated && <Notice kind="hint">{RIGHTBAR_COPY['git.diffTruncated']}</Notice>}
    </div>
  );
}

/** One rendered diff line. */
function DiffLine({ row, hl }: { row: DiffRow; hl: HlLine | undefined }): JSX.Element {
  if (row.kind === 'more') return <div className={css.diffMore}>{RIGHTBAR_COPY['git.diffMore']}</div>;
  if (row.kind === 'hunk') return <div className={css.diffHunk}>{row.text}</div>;
  if (row.kind === 'meta') return <div className={css.diffMeta}>{row.text}</div>;
  const fold = folds(row);
  return (
    <div className={css.diffRow} data-kind={row.kind}>
      <span className={css.lineNo}>{row.oldNo ?? ''}</span>
      <span className={css.lineNo}>{row.newNo ?? ''}</span>
      <span className={css.sign}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}</span>
      <span className={css.lineText} title={fold ? row.text : undefined}>
        {hl !== undefined && !fold
          ? hl.map((span, at) =>
            span.kind === 'plain'
              ? <span key={at}>{span.text}</span>
              : <span key={at} style={{ color: TOKEN_VAR[span.kind] }}>{span.text}</span>,
          )
          : fold
            ? `${row.text.slice(0, 200)}…`
            : row.text}
      </span>
    </div>
  );
}

/** The commit box: one line of message and the verb, pinned to the page's foot. */
function CommitBar({ send, hasStaged }: { send: (frame: ClientFrame) => void; hasStaged: boolean }): JSX.Element {
  const [message, setMessage] = useState('');
  const submit = (): void => {
    const trimmed = message.trim();
    if (trimmed.length === 0 || !hasStaged) return;
    send({ type: 'git_commit', message: trimmed });
    setMessage('');
  };
  return (
    <div className={css.commitBar}>
      <input
        type="text"
        className={css.commitInput}
        placeholder={hasStaged ? RIGHTBAR_COPY['git.commit.placeholder'] : RIGHTBAR_COPY['git.commit.nothingStaged']}
        value={message}
        aria-label={RIGHTBAR_COPY['git.commit.placeholder']}
        disabled={!hasStaged}
        maxLength={2000}
        onChange={(event) => { setMessage(event.target.value); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); submit(); }
        }}
      />
      <button type="button" className={css.commitButton} onClick={submit} disabled={!hasStaged || message.trim().length === 0}>
        {RIGHTBAR_COPY['git.commit']}
      </button>
    </div>
  );
}

/** The session's own edits, from the transcript. */
function TranscriptLens({ model }: { model: ChangesModel }): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
  if (model.files.length === 0) {
    return (
      <div className={css.lensBody}>
        <Notice kind="empty">{RIGHTBAR_COPY['changes.empty']}</Notice>
        <Notice kind="hint">{RIGHTBAR_COPY['changes.empty.note']}</Notice>
      </div>
    );
  }
  const current = model.files.find((file) => file.path === selected) ?? (model.files[0] as ChangedFile);
  return (
    <div className={css.lensBody}>
      <Notice kind="hint">
        {RIGHTBAR_COPY['changes.summary']
          .replace('{files}', String(model.files.length))
          .replace('{added}', String(model.added))
          .replace('{removed}', String(model.removed))}
      </Notice>
      <ul className={css.fileList} aria-label={RIGHTBAR_COPY['changes.list.label']}>
        {model.files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              className={css.rowMain}
              aria-pressed={file.path === current.path}
              title={file.path}
              onClick={() => { setSelected(file.path); }}
            >
              <span className={css.chevron} data-leaf="" />
              <span className={css.fileName}>{file.path}</span>
              <span className={css.fileStats} data-verdict={verdictOf(file)}>{fileSummary(file)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={css.diff}>
        <div className={css.diffHead}>
          <span className={css.diffPath} title={current.path}>{current.path}</span>
          <span className={css.diffSide}>{verdictWord(current)}</span>
        </div>
        <div className={css.diffBody}>
          {current.rows.map((row, index) => (
            <div key={index} className={css.diffRow} data-kind={row.t === 'skip' ? 'meta' : row.t}>
              <span className={css.lineNo} />
              <span className={css.lineNo} />
              <span className={css.sign}>{row.t === 'add' ? '+' : row.t === 'del' ? '−' : ' '}</span>
              <span className={css.lineText}>
                {row.t === 'skip'
                  ? RIGHTBAR_COPY['changes.cut'].replace('{n}', String(row.n))
                  : row.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The verdict a session-lens row's counts are painted with. */
function verdictOf(file: ChangedFile): string {
  if (file.ok === undefined) return 'running';
  return file.ok ? 'ok' : 'fail';
}

/** The verdict word on the open file's head. */
function verdictWord(file: ChangedFile): string {
  if (file.ok === undefined) return RIGHTBAR_COPY['changes.running'];
  return file.ok ? RIGHTBAR_COPY['changes.done'] : RIGHTBAR_COPY['changes.failed'];
}
