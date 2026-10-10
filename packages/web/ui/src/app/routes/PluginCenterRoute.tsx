/**
 * The plugin-center route: the main column's page while the plugin center is
 * open. It OWNS the column then — a session is never rendered beside it (the
 * shell's rule), so the route is a straight pass-through with the column's
 * disabled guard applied.
 */
import type { ClientFrame } from '../../types.js';
import type { UiState } from '../../state.js';
import { modeControlsLocked } from '../../chrome-view.js';
import { PluginCenterPage } from '../../settings/PluginCenterPage.js';

export function PluginCenterRoute(props: { state: UiState; send: (frame: ClientFrame) => void }): JSX.Element {
  return (
    <PluginCenterPage
      roster={props.state.roster}
      plugins={props.state.plugins}
      disabled={modeControlsLocked(props.state)}
      manageError={props.state.manageError}
      send={props.send}
    />
  );
}
