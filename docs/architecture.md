# Application architecture

The renderer presents records and submits commands through a validated preload interface. Electron owns application workflows, SQLite writes, timers, notifications, and model requests. Ollama owns inference. There is one user and one inference request at a time.

## Storage and migration

Schema version 3 retains the version 1 and 2 JSON records intact. It adds indexes for record ordering, time, state, status, and session block; a unique index permits only one unfinished focus session. Migration, writes, and reviewed-change approvals are transactional. Unsupported future versions and failed migrations close the database handle without deleting records.

Store offers separate interfaces for runtime state, planning context, the current workspace, paginated history, and full export. Only explicit exports and test verification use the full snapshot. Configuration is cached internally and copied for callers. The one-second loop reads the active session and current routine, without loading past sessions, plans, or conversation. Recent check-ins are time-filtered. Planning reads the last seven days through an index, then bounds model context.

History uses rowid cursors, not offsets, so new inserts do not duplicate earlier pages. Summary totals are calculated when History is requested. Full export and history aggregates still grow with dataset size; they are deliberate user operations rather than timer work. Old records remain available for export and pagination.

## Workflows and approval

DayApplication owns check-in timestamp construction and persistence, outcome-triggered replanning, and approval of edited task proposals. A saved outcome remains saved when inference fails. Duplicate outcomes do not trigger another model request. Reviewed task and preference changes are accepted once with a persistent approval record and action history.

A dedicated planning revision changes only for relevant profile fields, goals, tasks, timetable, check-ins, and sessions. Appearance and conversation do not invalidate plans. The planner compares this revision during inference and approval. It never assumes a fixed number of writes occurred after inference. New proposals supersede prior proposed plans. Legacy proposed plans lack the new input revision and require a fresh recommendation; historical accepted plans and records remain readable.

Planning policy centralizes duration limits, low-energy behaviour, repeated obstacles, and pre-execution decision checks. Shared limits feed structured schemas and runtime validation. The deterministic scheduler places selected work into current free intervals. The UI cannot execute arbitrary model tools, claim completed work, or start a focus session without an explicit user action.

## Renderer updates

The initial workspace contains current plans, the latest 32 sessions plus an active session, and 20 messages. Subsequent events send changed collections only. History loads separately in pages of 20. The renderer displays workflow results; it no longer constructs authoritative check-ins, applies raw model preference output, or starts a replan after saving an outcome.

## Diagnostics and limits

Planning diagnostics store duration, attempts, result type, and sanitised failure codes. Raw prompts, responses, and work descriptions are excluded. The table retains 1,000 requests. Individual records remain application-validated JSON; this is not a fully relational redesign. SQLite remains synchronous, with frequent work kept small. If measured operations later exceed responsiveness targets, move the Store implementation to a dedicated worker while preserving its interface.

Configuration remains limited to 100 goals and 500 tasks. Model context intentionally includes fewer records. This release has no multi-user server, automatic sync, import, or automatic model training. Windows inference and physical sleep testing on the actual laptop remain human checks.
