# Install and use dAIly

## Windows setup

1. Download `dAIly-Setup-0.1.0-x64.exe` from the `daily-windows-x64` artifact in the Windows application checks workflow. GitHub requires sign-in to download workflow artifacts.
2. Run the installer for your Windows user. It is unsigned, so Windows may display an unknown publisher prompt. No administrator account is required for the normal installation.
3. Open dAIly and save your routine. These starting values are editable. Set your own priorities, deadlines, weekly classes, and concrete tasks.
4. In Settings, install [Ollama for Windows](https://ollama.com/download/windows), open it, then click Check again.
5. Click Download Gemma. The approximately 3.3 GB download needs internet, disk space, and time. Cancel stops the current download; Retry resumes through Ollama.
6. Once Gemma is ready, update Today with your energy, cutoff, and anything that changed. Review the proposal, accept it, and explicitly start a block.
7. At the end, report actual work and time. This triggers a fresh recommendation. It does not require declaring the task completed.

After installation and model download, inference uses `127.0.0.1:11434`. No hosted AI service, account, API key, or subscription is used. Ollama must remain available. Timers and saved records remain usable without inference.

## Timetable and tasks

A dated timetable entry replaces the whole weekly schedule for that date. Include every class for the replacement day. A dated day-off entry removes the day's classes. Commute is reserved on both sides of class intervals.

An evening ending after midnight uses the next day's cutoff. A fresh low-energy report limits suggested blocks to 20 minutes without changing your saved preference. Preferences and smaller tasks proposed by the mentor require review and acceptance. A suggestion is not a completed task.

## Data and desktop behaviour

SQLite lives in Electron's user-data directory, normally `%APPDATA%\dAIly\daily.db` on Windows. Export local records from Settings to a readable JSON file. Export includes conversation and personal planning history. There is no import feature in this release.

Closing the window hides it to the tray. Use the tray to reopen, pause or resume, or quit. Launch at login and notifications are optional. Arrival check-ins follow the last class and expected commute. Quiet hours suppress notifications; suppressed session-end notices do not appear later, but the outcome prompt remains in the app.

Sleep pauses attribution. A restart during a running block asks you to confirm uncertain time. Uninstall keeps your local data. Ollama and its model files are installed separately and also remain installed. Quit both applications if you want them to stop consuming resources.

## Troubleshooting

| Situation | Action |
| --- | --- |
| Ollama unavailable | Open Ollama on the same Windows laptop and click Check again. Use the default loopback port 11434. |
| Download interrupted | Retry. Ollama reuses already downloaded layers. Check free disk space and internet connectivity. |
| Gemma takes too long | Cancel and retry after closing heavy applications. Cold loading can take longer. Current settings use 4096 context tokens and 384 output tokens. |
| Invalid model response | Your accepted plan stays intact. The harness attempts one repair. Submit a shorter update or check your task estimates. |
| Situation changed during planning | Submit again. Older model results cannot overwrite newer state. |
| Block no longer fits | Report current availability and request a fresh plan rather than starting the old block. |
| No notification | Enable notifications in dAIly and Windows. Check quiet hours, Windows Focus Assist, and notification permissions. |
| Cannot resume after sleep | Confirm actual focus minutes first. Sleep time is not automatically counted. |
| Newer database version | Use the version that created the database. Do not delete your records to fix a version mismatch. |

The installer excludes models, databases, environment files, logs, and development sources. Gemma runtime memory is greater than or different from the download size. The recorded local results and remaining Windows laptop checks are in [evaluation.md](evaluation.md).

## Development

Use Node 24 and npm. Run `npm ci`, then `npm run dev`. `npm run check` includes type checks, lint, tests, and production bundling. `npm run test:desktop` uses a separate test database and produces smoke reports. `npm run evaluate:gemma` runs the real local model scenarios. `npm run package:win` must run on Windows for the supported installer build.

The dev launcher removes inherited `ELECTRON_RUN_AS_NODE`, which some coding environments set. If a Linux development host has an unusable SUID sandbox helper, fix the Electron sandbox installation or run a development smoke only with `DAILY_LINUX_NO_SANDBOX=1`. The shipped Windows application does not disable its sandbox.
