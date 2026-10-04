# dAIly

A local desktop mentor for Kushagra's changing college days. dAIly helps choose a credible next step, records what actually happened, and adapts the next recommendation.

## Development

Use Node.js 24 and npm. Run `npm ci`, then `npm run dev`. The Electron renderer has no direct Node access. Desktop operations cross a typed preload bridge into the main process.

Run `npm run check` for type checks, linting, tests, and a production build. `npm run package:win` creates the Windows x64 installer on Windows. Models and personal data are not included in the application package.

## Local AI

Install [Ollama](https://ollama.com/download/windows) and use `gemma3:4b-it-q4_K_M`. Gemma is distributed under its own [terms](https://ai.google.dev/gemma/terms); this repository's MIT license covers dAIly code, not model weights.

## Using dAIly

Set your routine and class schedule, add concrete tasks, and report your available time and energy. Review and accept the mentor's proposal before starting a focus session. At the end, record actual work. dAIly uses those outcomes when recommending the next step.

Saved tasks, plans, history, and timers work without the model. Inference works offline once Ollama and Gemma are installed. Closing hides the window to the tray. Notifications and login launch are optional.

Read [Windows setup and troubleshooting](docs/setup.md) and [recorded evaluation and limitations](docs/evaluation.md). No actual friend trial or target-laptop Windows inference performance is claimed yet.

## Architecture

Electron main owns SQLite, scheduling, session transitions, notifications, and Ollama. The sandboxed React renderer uses a validated, typed preload bridge. Zod validates model output; deterministic checks handle availability, stale decisions, low-energy limits, and explicit task completion. A valid JSON object still requires semantic checks and user review.

The Windows workflow builds an unsigned x64 installer, exercises the packaged app, and checks that reinstalling and uninstalling retain user data. Models and personal records are excluded.

`@electron/get` is pinned to 5.1.0 for electron-builder through an npm override. This replaces its older downloader chain with the same version used by Electron and removes the vulnerable HTTP cache dependency. Installer and packaged smoke checks verify compatibility.
