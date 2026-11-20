# DEPRECATED — do not extend

This is the abandoned WinUI 3 shell, kept only so history stays readable. It has
**no entry in any build or test path**: `pnpm build`, `pnpm test` and all four
gates ignore it (it is not a workspace package), and nothing in `packages/`
references it.

It exists because WebView2 was considered before Tauri 2 was chosen. That
question is settled: `apps/tauri-bench` is the product shell, it loads
`packages/web/public` as `frontendDist`, and it talks to the runtime over
stdin/stdout (`packages/web/src/desktop-host.ts`). A second native shell would
be a second implementation of the same three things (spawn, pipe, shutdown) —
which is the defect this repo keeps paying for, not a feature.

**To delete it:** `git rm -r apps/windows` and drop any lingering
`.mimosa/hook-state` snapshots under it. Do not port anything out of it first:
the runtime contract it guessed at has since been defined by the pipe.
