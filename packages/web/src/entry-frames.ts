/**
 * The entry frames: read, write, rename, remove, create and reveal ONE
 * workspace entry — the right panel's editor and file tree.
 *
 * Same discipline as the read-only filesystem frames (`fs-frames.ts`), one hop
 * stronger because these mutate: **validate before changing anything, and
 * answer with state, never a bare "ok"**. The boundary check is core's
 * (`resolveInRoot`), the same one the model's fs tools run — a sidebar write
 * must not be able to reach a path the tool would refuse.
 *
 * A read that CANNOT be shown (oversized, binary) answers with `entry` carrying
 * the reason, not with an error: the panel's job is to say why the file is not
 * in the editor, and "too big" is not a failure of the read.
 */
import { createEntry, errMessage, readTextFile, removeEntry, renameEntry } from '@nova-agent/core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { MAX_EDITOR_BYTES } from './protocol.js';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import type { WsConnection } from './ws.js';

/** What these frames need from the controller. */
export interface EntryFrameHost {
  /** The live tool root: what every path resolves against. */
  rootDir: string;
}

/** The entry frames this module answers. */
export type EntryFrame = Extract<
  ClientFrame,
  { type: 'read_entry' | 'rename_entry' | 'remove_entry' | 'new_entry' | 'open_entry' }
>;

/**
 * Route one entry frame.
 * @param client - the socket the frame arrived on (replies go here).
 * @param frame - the validated frame.
 * @param host - the controller's own collaborators.
 * @returns nothing; every answer is a frame on this client.
 */
export async function handleEntryFrame(client: WsConnection, frame: EntryFrame, host: EntryFrameHost): Promise<void> {
  switch (frame.type) {
    case 'read_entry': {
      try {
        const reading = await readTextFile(host.rootDir, frame.path, MAX_EDITOR_BYTES);
        client.send(serialize({ type: 'entry', ...reading }));
      } catch (err) {
        // A refusal is its own frame: the panel shows the reason for THIS path
        // instead of an empty editor, which would claim the file is empty.
        client.send(serialize({ type: 'entry_error', path: frame.path, message: errMessage(err) }));
      }
      return;
    }
    case 'rename_entry': {
      const moved = await renameEntry(host.rootDir, frame.path, frame.to);
      client.send(serialize({ type: 'entry_changed', change: 'renamed', path: moved.path, dir: path.dirname(moved.path) }));
      return;
    }
    case 'remove_entry': {
      const removed = await removeEntry(host.rootDir, frame.path);
      client.send(serialize({ type: 'entry_changed', change: 'removed', path: removed.path, dir: path.dirname(removed.path) }));
      return;
    }
    case 'new_entry': {
      const created = await createEntry(host.rootDir, frame.dir, frame.name, frame.kind);
      client.send(serialize({ type: 'entry_changed', change: 'created', path: created.path, dir: frame.dir }));
      return;
    }
    case 'open_entry': {
      // The host runs on the operator's machine, so it is the side that can
      // reveal a file. argv-only (no shell): a path is a path, never a command.
      revealInFileManager(frame.path);
      return;
    }
  }
}

/**
 * Reveal a path in the OS file manager.
 *
 * Fire-and-forget on purpose: there is no answer the panel could render (the
 * window that opens IS the answer), and waiting on a GUI process would hold
 * the frame open for as long as the user leaves the window up.
 */
function revealInFileManager(target: string): void {
  const [program, args] = process.platform === 'win32'
    ? ['explorer.exe', [`/select,${target}`]]
    : process.platform === 'darwin'
      ? ['open', ['-R', target]]
      : ['xdg-open', [path.dirname(target)]];
  const child = spawn(program, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
