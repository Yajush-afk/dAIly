# Evaluation

## Recorded local run

Run on October 4, 2026, on Linux with an i7-11800H, about 15 GiB usable RAM, and an RTX 3050 Ti with 4 GiB VRAM. These are local results, not Windows measurements or Kushagra's feedback.

Gemma tag: `gemma3:4b-it-q4_K_M`. Context: 4096 tokens. Temperature: 0.1. Output budget: 384 tokens. Run `npx tsx scripts/evaluate-gemma.mts` to repeat the fixed scenarios. Detailed outputs go into ignored `artifacts/gemma-evaluation.json`.

| Scenario                   | Total request time | Model calls | Observed decision                                                            |
| -------------------------- | ------------------ | ----------- | ---------------------------------------------------------------------------- |
| Exam tomorrow              | 9.5 seconds        | 1           | Exam revision first, then DSA, with a break                                  |
| Low energy, 20 minutes     | 16.3 seconds       | 2           | Smaller revision task for approval after rejecting an oversized plan         |
| Three interrupted attempts | 12.6 seconds       | 1           | Shorter graph block and an explanation acknowledging the starting difficulty |

No malformed JSON occurred in these four calls. One semantically invalid plan needed repair. The first, longer configuration timed out at 120 seconds on the cold request. Another early response recommended 45 minutes with only 20 available. Those failures motivated the shorter context, concise response limit, explicit plan instructions, and semantic checks. Warm performance met the 30-second target in this small run. This is not a statistical benchmark.

Ollama `/api/ps` reported a runtime allocation of 3,778,177,248 bytes and VRAM allocation of 1,962,881,842 bytes at 4096 context. The model download was about 3.3 GB. These figures describe different things and should not be added together or treated as peak memory measurements.

## Quality review

The exam explanation matched the supplied priority and deadline. The low-energy repair proposed a 20-minute smaller step without saving it automatically. It redundantly proposed the existing focus and break preferences, which the review screen exposes. The interruption scenario acknowledged an existing obstacle and shortened the block, but did not explore it deeply. Good structural output does not prove good mentoring.

Additional cases exposed invented task identifiers and a work recommendation disguised as an explanation with zero availability. Model schemas now enumerate the real unfinished task and goal identifiers. Planning with fewer than five usable minutes returns a clearly attributed application availability response without calling Gemma. Mentor reflection remains available through Ask mentor after the cutoff. The model cannot turn an explanation into an executed schedule.

The expanded fixed scenarios cover an exam tomorrow, low energy, repeated interruption, exhausted availability, an already completed task, and conflicting deadlines. Assertions check deadline order, cutoff, completed-task exclusion, smaller repeated attempts, and low-energy limits. Repeated deferrals count distinct days, not revisions. Long context is capped at 10,000 serialized characters and trims old conversation before relevant factual records; this is a size bound, not an exact Gemma token count.

The actual packaged Linux application also received and accepted a real Gemma proposal through the preload bridge in 19.8 seconds. Repeat this integration check with `DAILY_SMOKE_WITH_MODEL=1 node scripts/smoke.mjs <packaged-executable> <report-directory>`. It requires an installed local model. Windows CI uses the standard smoke without downloading model weights.

Some generated wording still paraphrases a task's scope imprecisely. The actual stored task title remains visible and unchanged, and time expiry never claims completion. Treat the model's wording as advice to review, not an authoritative record of completed work.

The app applies a temporary maximum of 20 minutes per block for a fresh low-energy check-in. This does not change the saved focus preference. The model receives up to 16 unfinished tasks ordered by deadlines and priorities, eight recent outcomes, and recent deferrals. The omitted task count is explicit. Full history remains in SQLite.

## Automated coverage

`npm run check` runs type checks, lint, tests, and a production build. Tests cover local records, scheduling across midnight, unavailable intervals and commute, invalid and stale responses, low-energy limits, repeated interruptions, session expiry, pauses, duplicate actions, crash recovery, quiet hours, notifications, and renderer trust boundaries.

`node scripts/smoke.mjs` exercises the actual Electron preload and renderer, SQLite writes, a session outcome, navigation, resizing, and closing to the tray. On this Linux host, the sandbox helper requires a development-only `DAILY_LINUX_NO_SANDBOX=1` override. Renderer isolation remains enabled. Windows CI does not use that override. Reports and screenshots are stored in `artifacts/desktop-smoke`.

## Windows and friend trial

Windows CI runs the application checks and native smoke test. Installer validation is added in the packaging PR. Passing CI does not establish actual laptop inference performance, physical sleep behaviour, notification delivery under Windows Focus Assist, or usefulness for Kushagra.

These human checks remain to be recorded on the Windows laptop:

1. Install, download Gemma, then disconnect internet and plan a real evening.
2. Record three warm request times and observe RAM and VRAM in Task Manager.
3. Start a block, interrupt it, report actual work, and inspect the next recommendation.
4. Close to tray, sleep and wake, restart, and confirm uncertain time.
5. Record whether deciding what to do felt easier, advice was reasonable, and updates were burdensome. Preserve criticism along with positive feedback.

No friend trial results are claimed in this repository until they actually occur.

## Architecture refactor checks

On October 4, the refactor passed 53 automated tests, including version-two migration preserving exact record payloads, indexed active-session reads, cursor pagination during inserts, relevant-input proposal validity, renderer deltas, offline outcome persistence, duplicate outcome handling, and idempotent reviewed-change approval.

Six fixed Gemma scenarios were repeated twice with different user wording: all 12 passed their automated assertions. Planning requests took 9.1 to 22.4 seconds, including two requests that required a repair. Both exhausted-time cases used the application guard without inference. This remains a small sample, and explanation quality requires human review. Repeat with `npm run evaluate:gemma -- --repeats=2`.

A temporary on-disk SQLite benchmark seeded 3,650 completed sessions, 3,650 historical plans, and 20,000 conversation messages, then added an active session. Across 200 samples, the timer path's 95th percentile was 0.54 ms; the first 20-session history page took 18.9 ms. The initial bounded workspace was about 15 KB. These measurements are specific to this Linux host, include filesystem cache effects, and do not establish Windows performance or arbitrary scale. Run `npm run benchmark:history` to repeat; it never opens the personal database.

Native Electron smoke also received a real Gemma decision through the preload bridge after the refactor. Its test database was isolated. Linux smoke required the explicit test-only sandbox override because the SUID helper needs a sudo permission repair; normal application sandboxing remains enabled. Windows CI checks the packaged application without that override.

See [architecture.md](architecture.md) for the remaining constraints and [setup.md](setup.md) for Ubuntu commands and database reset.

A subsequent query-plan check added an ordering index for newest-record reads and verified that SQLite does not build a temporary sort for the latest messages. The final local benchmark measured timer p95 at 0.36 ms, bounded workspace p95 at 8.9 ms, and the first history page at 9.1 ms with the same synthetic history. Variance between these small runs is expected; neither result is a cross-platform performance guarantee.
