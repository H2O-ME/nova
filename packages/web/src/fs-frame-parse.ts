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
import { MAX_FILE_QUERY_CHARS, MAX_WORKSPACE_CHARS, type ClientFrame } from './protocol.js';
import { reject, type FrameRejection } from './reject.js';

/** Which frame types this module owns. */
export type FsFrameType = 'set_workspace' | 'list_files' | 'list_directory' | 'create_directory';

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
  }
}
