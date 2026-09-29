/**
 * Grouping decides what the transcript *reads* like, so the tests here are
 * about meaning: which rows fold, in what order the header names them, and
 * when the whole header flips to present tense.
 */
import { describe, expect, it } from 'vitest';
import { bucketsOf, partitionRuns, runRunning, verbKindOf, verbLabel, type RunStep } from '../src/verb-group.js';

const step = (over: Partial<RunStep> = {}): RunStep => ({ verb: 'file', expanded: false, running: false, failed: false, ...over });

describe('which tools can join a run', () => {
  it('reads, searches, listings and plans fold; a shell command never does', () => {
    expect(verbKindOf('read')).toBe('file');
    expect(verbKindOf('search')).toBe('search');
    expect(verbKindOf('execute')).toBeUndefined();
    expect(verbKindOf('write')).toBeUndefined();
    expect(verbKindOf('other')).toBeUndefined();
  });
});

describe('partitionRuns', () => {
  it('folds a maximal span of adjacent groupable rows', () => {
    const spans = partitionRuns([step({ verb: 'file' }), step({ verb: 'file' }), step({ verb: 'search' })]);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ kind: 'run' });
    expect(spans[0]?.kind === 'run' && spans[0].run.members).toEqual([0, 1, 2]);
  });

  it('a shell command breaks the run and keeps its own row', () => {
    const spans = partitionRuns([step({ verb: 'file' }), step({ verb: undefined }), step({ verb: 'file' })]);
    expect(spans.map((s) => s.kind)).toEqual(['run', 'single', 'run']);
  });

  it('an expanded member keeps its own rows but does not split the run', () => {
    const spans = partitionRuns([step({ verb: 'file' }), step({ verb: 'file', expanded: true }), step({ verb: 'file' })]);
    expect(spans).toHaveLength(1);
    // …and it is not counted in the bucket, because it is visible on its own.
    expect(spans[0]?.kind === 'run' && spans[0].run.buckets[0]?.count).toBe(2);
  });

  it('an ungroupable row between two singles stays two singles', () => {
    const spans = partitionRuns([step({ verb: undefined }), step({ verb: undefined })]);
    expect(spans.map((s) => s.kind)).toEqual(['single', 'single']);
  });
});

describe('buckets', () => {
  it('keeps first-appearance order rather than sorting by kind', () => {
    const buckets = bucketsOf([step({ verb: 'search' }), step({ verb: 'file' }), step({ verb: 'search' })]);
    expect(buckets.map((b) => b.kind)).toEqual(['search', 'file']);
    expect(buckets.map((b) => b.count)).toEqual([2, 1]);
  });

  it('one running member flips the whole bucket to present tense', () => {
    const buckets = bucketsOf([step({ verb: 'file' }), step({ verb: 'file', running: true })]);
    expect(buckets[0]?.running).toBe(true);
    expect(verbLabel(buckets)).toBe('正在读取 2 个文件');
    expect(runRunning(buckets)).toBe(true);
  });

  it('counts failures per bucket and appends them once', () => {
    const buckets = bucketsOf([step({ verb: 'file', failed: true }), step({ verb: 'file' }), step({ verb: 'search', failed: true })]);
    expect(verbLabel(buckets)).toBe('读取 2 个文件, 搜索 1 处匹配 · 2 失败');
  });

  it('a clean finished run reads in the past tense with no suffix', () => {
    const buckets = bucketsOf([step({ verb: 'file' }), step({ verb: 'file' })]);
    expect(verbLabel(buckets)).toBe('读取 2 个文件');
    expect(runRunning(buckets)).toBe(false);
  });
});