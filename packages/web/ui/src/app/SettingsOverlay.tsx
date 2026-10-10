/**
 * The settings dialog the sidebar foot's seat opens. The shell registers the
 * sections this product really has — 通用设置 (permission, execution mode,
 * appearance, font size), 模型 (the catalog behind the composer's seat), Skill
 * 中心 (the discovered skills with per-name switches), plus a section per
 * plugin that declares its own page — and the writes go through the same frames
 * the composer's seats use, so a pick here and a pick there are one fact.
 *
 * 插件管理 is NOT one of them: the plugin center is a sidebar door and a
 * top-level page (`app/routes/PluginCenterRoute`), not a section two clicks
 * deep behind 设置.
 */
import { useTheme } from '../theme.js';
import { useTranscriptView } from '../chat/transcript-view.js';
import { approvalControlLocked, modeControlsLocked } from '../chrome-view.js';
import type { Action, UiState } from '../state.js';
import type { ClientFrame } from '../types.js';
import { GeneralSection } from '../settings/GeneralSection.js';
import { ModelConfigEditor } from '../settings/ModelConfigEditor.js';
import { ProviderSection } from '../settings/ProviderSection.js';
import { SkillsSection } from '../settings/SkillsSection.js';
import { PluginPageSection } from '../settings/PluginPageSection.js';
import { pagePlugins } from '../settings/plugin-state.js';
import { SettingsPanel } from '../settings/SettingsPanel.js';
import { SETTINGS_COPY } from '../settings/copy.js';
import { BookIcon, PluginIcon, SettingsIcon } from '../icons.js';
import { DataOutline16 } from '../composer/Icons.js';

export interface SettingsOverlayProps {
  state: UiState;
  send: (frame: ClientFrame) => void;
  dispatch: (action: Action) => void;
  /** Section ids holding unsaved edits (the leave guard's input). */
  dirtySections: ReadonlySet<string>;
  /** One stable reporter per section id (identity kept by the shell). */
  dirtyReporter: (id: string) => ((dirty: boolean) => void);
  onClose: () => void;
}

export function SettingsOverlay(props: SettingsOverlayProps): JSX.Element {
  const { state, send, dispatch } = props;
  const theme = useTheme();
  const transcript = useTranscriptView();
  return (
    <SettingsPanel
      title="设置"
      closeLabel={SETTINGS_COPY['settings.close']}
      onClose={props.onClose}
      sections={(() => {
        // Which pages this product HAS is derived from the LIVE plugin roster,
        // never from a fixed list: a page whose plugin the operator switched off
        // must leave the nav, or the page itself claims the plugin is still
        // there. `plugins` is a flip's answer and `roster` the first-paint
        // snapshot; both are absent until one lands, and an unknown row must not
        // hide a page — so only an explicit `enabled: false` counts as off (the
        // same `?? true` reading `PluginRow` draws its switch from).
        //
        // A switched-off plugin leaves no fiber, but it keeps its ROW in 插件管理
        // (from the kernel's manifest), so the switch that closed it is also the
        // way back on — one door, and never a one-way one.
        const rows = state.plugins?.entries ?? state.roster?.entries ?? [];
        return [
          {
            id: 'general',
            label: SETTINGS_COPY['general.nav'],
            icon: <SettingsIcon />,
            content: (
              <GeneralSection
                approvalMode={state.approvalMode}
                preference={theme.preference}
                fontSize={theme.fontSize}
                transcriptView={transcript.mode}
                // Only "no session at all" blocks the tier here: the tier is
                // read fresh at the NEXT approval, so it stays adjustable
                // mid-run — that was a real defect once (`!isIdle` froze it
                // exactly when the operator needed it).
                disabled={approvalControlLocked(state)}
                onPickApproval={(mode) => { send({ type: 'set_approval_mode', mode }); }}
                onPickPreference={theme.setPreference}
                onPickFontSize={theme.setFontSize}
                onPickTranscriptView={transcript.setMode}
              />
            ),
          },
          {
            id: 'models',
            label: SETTINGS_COPY['models.nav'],
            icon: <DataOutline16 />,
            // Both editors on this page report their drafts, so the shell's
            // leave guard covers the whole page — not only the plugin pages.
            dirty: props.dirtySections.has('models'),
            content: (
              <>
                {/* 设置页管的是**怎么连**（端点、密钥、这个端点名下有哪些模型、
                    以及逐字段的能力覆盖），不管**用哪一个**：切换当前模型是
                    composer 那个模型座位的事，设置页再摆一份可切换的目录就是
                    同一件事的第二个入口。 */}
                <ProviderSection
                  providers={state.providers}
                  probe={state.providerProbe}
                  manageError={state.manageError}
                  onDirtyChange={props.dirtyReporter('models')}
                  send={send}
                />
                <ModelConfigEditor
                  config={state.modelConfig}
                  writable={state.modelSwitching}
                  onDirtyChange={props.dirtyReporter('models')}
                  send={send}
                />
              </>
            ),
          },
          {
            id: 'skills',
            label: SETTINGS_COPY['skills.nav'],
            icon: <BookIcon />,
            content: (
              <SkillsSection
                skills={state.skills}
                disabled={modeControlsLocked(state)}
                manageError={state.manageError}
                send={send}
                onClose={props.onClose}
              />
            ),
          },
          // Every plugin that declares a settings PAGE gets a section, and the
          // host names none of them: the roster row carries the flag, the
          // plugin answers `page` with its own descriptor, and
          // `PluginPageSection` renders whatever comes back. With the plugin
          // switched off there is no section (its row stays in 插件管理, which
          // is where it was closed, and turning it back on brings the page
          // back). This replaced a hand-written section per channel, which is
          // what made "a plugin with settings" a web-package change.
          ...pagePlugins(rows).map((row) => ({
            id: row.name,
            label: row.title ?? row.name,
            icon: <PluginIcon />,
            // The panel's leave guard reads this: an unsaved draft on the
            // page asks before a switch discards it.
            dirty: props.dirtySections.has(row.name),
            content: (
              <PluginPageSection
                plugin={row.name}
                answer={state.pluginAnswers[row.name] ?? null}
                disabled={!state.connected}
                send={send}
                onEdit={() => { dispatch({ type: 'plugin_edit' }); }}
                onDirtyChange={props.dirtyReporter(row.name)}
              />
            ),
          })),
        ];
      })()}
    />
  );
}
