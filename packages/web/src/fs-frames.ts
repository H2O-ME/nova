/**
 * The client frames that READ the filesystem without changing what is open:
 * list workspace files, and browse/create directories.
 *
 * The two frames that redefine the open session or workspace live in
 * `session-frames.ts`. These share one discipline with them: **validate before
 * changing anything, and answer with state, never a bare "ok".**
 */
import { createDirectory, errMessage, listDirectory, listWorkspaceFiles, type DirectoryLevel } from '@nova-agent/core';
import { serializeServerFrame as serialize } from './protocol.js';
import type { ClientFrame } from './protocol.js';
import type { WsConnection } from './ws.js';

/** What these frames need from the controller. */
export interface FsFrameHost {
  /** The live tool root — what `list_files` resolves against. */
  rootDir: string;
}

/**
 * Route one read-only filesystem frame.
 * @param client - the socket the frame arrived on (replies go here).
 * @param frame - the validated frame.
 * @param host - the controller's own collaborators.
 * @returns whether the frame belonged to this module.
 */
export async function handleFsFrame(
  client: WsConnection,
  frame: ClientFrame,
  host: FsFrameHost,
): Promise<boolean> {
  switch (frame.type) {
    case 'list_files': {
      const listing = await listWorkspaceFiles(host.rootDir, frame.query);
      client.send(serialize({ type: 'files', query: frame.query, items: listing.items, truncated: listing.truncated }));
      return true;
    }
    case 'list_directory': {
      // A refusal is its own frame: the picker renders the reason instead of an
      // empty list, which would claim the directory has nothing in it.
      // `files` selects the OTHER job this listing serves: an attachment
      // reference needs a real path to a FILE, and a browser has no way to
      // obtain one — so the picker lists files too and each row says which it is.
      const withFiles = frame.files === true;
      await sendLevel(client, () => listDirectory(frame.dir, undefined, { includeFiles: withFiles }));
      return true;
    }
    case 'create_directory': {
      // Creating answers with the level it created INTO: the picker moves there,
      // so replying with the new folder's own listing saves a round trip and
      // cannot race one.
      await sendLevel(client, async () => listDirectory(await createDirectory(frame.dir, frame.name)));
      return true;
    }
    default:
      return false;
  }
}

/**
 * Answer one directory request with either the level or the reason it could not
 * be read.
 *
 * Two frames rather than a nullable field, because they say opposite things:
 * `directory` with no entries means "this folder is empty", while a refusal
 * means "this folder could not be looked at". Collapsing them would make an
 * unreadable mount look like an empty one.
 */
async function sendLevel(client: WsConnection, load: () => Promise<DirectoryLevel>): Promise<void> {
  try {
    client.send(serialize({ type: 'directory', ...(await load()) }));
  } catch (err) {
    client.send(serialize({ type: 'directory_error', message: errMessage(err) }));
  }
}
