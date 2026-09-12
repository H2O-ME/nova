---
'nova-agent': patch
'@nova-agent/core': patch
'@nova-agent/ai': patch
'@nova-agent/plugins': patch
'@nova-agent/tui': patch
'@nova-agent/tui-view': patch
'@nova-agent/cli': patch
---

P3 polish: jobs.ts comment drift fixed (completion injection channel exists since M6.4); dead code removed (extractReasoningHeader, reasoningRows, questionLines, isBlankAnswer + their tests); {env:NAME} throws naming the missing variable instead of silently expanding to empty; --version/-v/--help/-h only match as leading flags; interactive mode warns on stray positionals; runCompact no longer zeros cumulative session stats; PTC both-mode SDK slims bindings to name + one-line summary (native schemas carry full types); search_files in-process walk checks abort signal; spacing.ts contract comment aligned with frame.ts tight-pair implementation.
