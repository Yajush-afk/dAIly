# Evaluation

## Recorded local run

Run on October 4, 2026, on Linux with an i7-11800H, about 15 GiB usable RAM, and an RTX 3050 Ti with 4 GiB VRAM. These are local results, not Windows measurements or Kushagra's feedback.

Gemma tag: `gemma3:4b-it-q4_K_M`. Context: 4096 tokens. Temperature: 0.1. Output budget: 384 tokens. Run `npx tsx scripts/evaluate-gemma.mts` to repeat the fixed scenarios. Detailed outputs go into ignored `artifacts/gemma-evaluation.json`.

| Scenario | Total request time | Model calls | Observed decision |
| --- | --- | --- | --- |
| Exam tomorrow | 9.5 seconds | 1 | Exam revision first, then DSA, with a break |
| Low energy, 20 minutes | 16.3 seconds | 2 | Smaller revision task for approval after rejecting an oversized plan |
| Three interrupted attempts | 12.6 seconds | 1 | Shorter graph block and an explanation acknowledging the starting difficulty |

No malformed JSON occurred in these four calls. One semantically invalid plan needed repair. The first, longer configuration timed out at 120 seconds on the cold request. Another early response recommended 45 minutes with only 20 available. Those failures motivated the shorter context, concise response limit, explicit plan instructions, and semantic checks. Warm performance met the 30-second target in this small run. This is not a statistical benchmark.

Ollama `/api/ps` reported a runtime allocation of 3,778,177,248 bytes and VRAM allocation of 1,962,881,842 bytes at 4096 context. The model download was about 3.3 GB. These figures describe different things and should not be added together or treated as peak memory measurements.

## Quality review

The exam explanation matched the supplied priority and deadline. The low-energy repair proposed a 20-minute smaller step without saving it automatically. It redundantly proposed the existing focus and break preferences, which the review screen exposes. The interruption scenario acknowledged an existing obstacle and shortened the block, but did not explore it deeply. Good structural output does not prove good mentoring.

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
