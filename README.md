# dAIly

A local desktop mentor for Kushagra's changing college days. dAIly helps choose a credible next step, records what actually happened, and adapts the next recommendation.

## Development

Use Node.js 24 and npm. Run `npm ci`, then `npm run dev`. The Electron renderer has no direct Node access. Desktop operations cross a typed preload bridge into the main process.

Run `npm run check` for type checks, linting, tests, and a production build. `npm run package:win` creates the Windows x64 installer on Windows. Models and personal data are not included in the application package.

## Local AI

Install [Ollama](https://ollama.com/download/windows) and use `gemma3:4b-it-q4_K_M`. Gemma is distributed under its own [terms](https://ai.google.dev/gemma/terms); this repository's MIT license covers dAIly code, not model weights.

The application is being built in a sequence of focused pull requests. Windows behaviour and inference performance need verification on the target laptop.
