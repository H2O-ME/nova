---
'@nova-agent/ai': patch
---

Retry resilience fixes: `parseRetryAfterMs` now honors both server delay forms (delta-seconds and HTTP-date, capped at 60s) and fails loudly on present-but-unparseable values instead of silently guessing a delay; the client's own exponential backoff is capped at 32s (`RETRY_BACKOFF_MAX_MS`) so a generous base can no longer park a run for minutes on transient 429/5xx.
