/**
 * Wire validation for the frames that name a WORKSPACE PATH or a file query.
 *
 * The host side of these frames already lives in its own module (`fs-frames.ts`)
 * because it shares one discipline: validate before mutating, answer with state.
 * This is the other half of that pair — the wire checks that guarantee the host
 * sees a string it can run those rules against (non-empty, length-capped, free of
 * control characters). Split out from `client-frame.ts` so the frame parser stays
 * a dispatch table over frame SHAPES, which is what it is good at, rather than
 * also being the place where four path rules are spelled out.
 *
 * The real path authority is still `core/session-target.ts` on the host: a
 * `..`-laden string is a well-formed frame and an invalid target, and the two
 * judgements belong at those two layers.
 */
import { hasControlChars, MAX_DIRECTORY_NAME_CHARS } from '@nova-agent/core';
import {
  MAX_COMMIT_MESSAGE_CHARS,
  MAX_FILE_QUERY_CHARS,
  MAX_GIT_CLONE_URL_CHARS,
  MAX_GIT_LOG,
  MAX_GIT_PATHS,
  MAX_WORKSPACE_CHARS,
  type ClientFrame,
} from './protocol.js';
import { reject, type FrameRejection } from './reject.js';

/** Which frame types this module owns. */
export type FsFrameType =
  | 'set_workspace'
  | 'list_files'
  | 'list_directory'
  | 'create_directory'
  | 'read_entry'
  | 'rename_entry'
  | 'remove_entry'
  | 'new_entry'
  | 'open_entry'
  | 'git_status'
  | 'git_diff'
  | 'git_stage'
  | 'git_unstage'
  | 'git_commit'
  | 'git_log'
  | 'git_clone';

/** One workspace path field: non-empty, capped, free of control junk. */
function pathField(value: unknown, label: string): string | FrameRejection {
  if (typeof value !== 'string' || value.trim().length === 0) return reject(`${label} must be a non-empty string`);
  if (value.length > MAX_WORKSPACE_CHARS) return reject(`${label} exceeds ${MAX_WORKSPACE_CHARS} chars`);
  if (hasControlChars(value)) return reject(`${label} contains control characters`);
  return value;
}

/** Whether a helper's answer is a rejection rather than the parsed value. */
function isRejection(value: string | FrameRejection): value is FrameRejection {
  return typeof value !== 'string';
}

/**
 * Validate one filesystem frame.
 * @param type - the frame's `type` (already narrowed by the caller's switch).
 * @param obj - the raw frame object.
 * @returns the parsed frame, or a rejection reason.
 */
export function parseFsFrame(type: FsFrameType, obj: Record<string, unknown>): ClientFrame | FrameRejection {
  switch (type) {
    case 'set_workspace': {
      const dir = obj['dir'];
      if (typeof dir !== 'string' || dir.trim().length === 0) return reject('set_workspace.dir must be a non-empty string');
      if (dir.length > MAX_WORKSPACE_CHARS) return reject(`set_workspace.dir exceeds ${MAX_WORKSPACE_CHARS} chars`);
      if (hasControlChars(dir)) return reject('set_workspace.dir contains control characters');
      return { type: 'set_workspace', dir };
    }
    case 'list_files': {
      const query = obj['query'];
      if (typeof query !== 'string' || query.length > MAX_FILE_QUERY_CHARS) {
        return reject(`list_files.query must be a string of at most ${MAX_FILE_QUERY_CHARS} chars`);
      }
      if (hasControlChars(query)) return reject('list_files.query contains control characters');
      return { type: 'list_files', query };
    }
    case 'list_directory': {
      // Absent means "the host home directory", which is the picker's start:
      // the frame is deliberately valid with no path at all.
      const dir = obj['dir'];
      const files = obj['files'];
      if (files !== undefined && typeof files !== 'boolean') return reject('list_directory.files must be a boolean when present');
      const withFiles = files === true;
      if (dir === undefined) return withFiles ? { type: 'list_directory', files: true } : { type: 'list_directory' };
      if (typeof dir !== 'string') return reject('list_directory.dir must be a string when present');
      if (dir.length > MAX_WORKSPACE_CHARS) return reject(`list_directory.dir exceeds ${MAX_WORKSPACE_CHARS} chars`);
      // An empty string is accepted and means home: `listDirectory` treats it
      // the same as absent, so the two spellings cannot disagree.
      if (hasControlChars(dir)) return reject('list_directory.dir contains control characters');
      return withFiles ? { type: 'list_directory', dir, files: true } : { type: 'list_directory', dir };
    }
    case 'create_directory': {
      const dir = obj['dir'];
      const name = obj['name'];
      if (typeof dir !== 'string' || dir.trim().length === 0) return reject('create_directory.dir must be a non-empty string');
      if (dir.length > MAX_WORKSPACE_CHARS) return reject(`create_directory.dir exceeds ${MAX_WORKSPACE_CHARS} chars`);
      if (hasControlChars(dir)) return reject('create_directory.dir contains control characters');
      // The name is checked by core's `isSafeDirectoryName` on the host, which
      // owns the rule; this only guarantees it is a string that check can read.
      if (typeof name !== 'string') return reject('create_directory.name must be a string');
      if (name.length > MAX_DIRECTORY_NAME_CHARS) return reject(`create_directory.name exceeds ${MAX_DIRECTORY_NAME_CHARS} chars`);
      return { type: 'create_directory', dir, name };
    }
    case 'read_entry':
    case 'open_entry':
    case 'remove_entry': {
      const pathValue = pathField(obj['path'], `${type}.path`);
      if (isRejection(pathValue)) return pathValue;
      return { type, path: pathValue } as ClientFrame;
    }
    case 'rename_entry': {
      const pathValue = pathField(obj['path'], 'rename_entry.path');
      if (isRejection(pathValue)) return pathValue;
      const to = pathField(obj['to'], 'rename_entry.to');
      if (isRejection(to)) return to;
      return { type: 'rename_entry', path: pathValue, to };
    }
    case 'new_entry': {
      const dir = obj['dir'];
      const name = obj['name'];
      const kind = obj['kind'];
      if (typeof dir !== 'string' || dir.trim().length === 0) return reject('new_entry.dir must be a non-empty string');
      if (dir.length > MAX_WORKSPACE_CHARS) return reject(`new_entry.dir exceeds ${MAX_WORKSPACE_CHARS} chars`);
      if (hasControlChars(dir)) return reject('new_entry.dir contains control characters');
      if (typeof name !== 'string' || name.length === 0 || name.length > MAX_DIRECTORY_NAME_CHARS) {
        return reject(`new_entry.name must be a string of at most ${MAX_DIRECTORY_NAME_CHARS} chars`);
      }
      if (hasControlChars(name)) return reject('new_entry.name contains control characters');
      if (kind !== 'file' && kind !== 'dir') return reject("new_entry.kind must be 'file' or 'dir'");
      return { type: 'new_entry', dir, name, kind };
    }
    case 'git_status':
      return { type: 'git_status' };
    case 'git_diff': {
      const pathValue = pathField(obj['path'], 'git_diff.path');
      if (isRejection(pathValue)) return pathValue;
      const staged = obj['staged'];
      if (staged !== undefined && typeof staged !== 'boolean') return reject('git_diff.staged must be a boolean when present');
      return { type: 'git_diff', path: pathValue, staged: staged === true };
    }
    case 'git_stage':
    case 'git_unstage': {
      const paths = obj['paths'];
      if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_GIT_PATHS) {
        return reject(`${type}.paths must be a non-empty array of at most ${MAX_GIT_PATHS} paths`);
      }
      const parsed: string[] = [];
      for (const item of paths) {
        const one = pathField(item, `${type}.paths[]`);
        if (isRejection(one)) return one;
        parsed.push(one);
      }
      return { type, paths: parsed } as ClientFrame;
    }
    case 'git_commit': {
      const message = obj['message'];
      if (typeof message !== 'string' || message.trim().length === 0) return reject('git_commit.message must be a non-empty string');
      if (message.length > MAX_COMMIT_MESSAGE_CHARS) return reject(`git_commit.message exceeds ${MAX_COMMIT_MESSAGE_CHARS} chars`);
      // A commit message is a document (subject + body): newlines are content.
      if (hasControlChars(message, { multiline: true })) return reject('git_commit.message contains control characters');
      return { type: 'git_commit', message };
    }
    case 'git_log': {
      const limit = obj['limit'];
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_GIT_LOG)) {
        return reject(`git_log.limit must be an integer between 1 and ${MAX_GIT_LOG}`);
      }
      return limit === undefined ? { type: 'git_log' } : { type: 'git_log', limit };
    }
    case 'git_clone': {
      // The URL is DATA end to end: the host runs git with argv (no shell) and
      // a `--` separator, so even a `-`-leading string cannot become an option.
      // The wire check only guarantees a string core's rules can read.
      const url = obj['url'];
      if (typeof url !== 'string' || url.trim().length === 0) return reject('git_clone.url must be a non-empty string');
      if (url.length > MAX_GIT_CLONE_URL_CHARS) return reject(`git_clone.url exceeds ${MAX_GIT_CLONE_URL_CHARS} chars`);
      if (hasControlChars(url)) return reject('git_clone.url contains control characters');
      return { type: 'git_clone', url: url.trim() };
    }
  }
}
