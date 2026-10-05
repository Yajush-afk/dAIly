# Install and use dAIly

## Windows setup

For source installation, demo recording, database resets and transfers, and Windows troubleshooting, use the [complete Windows guide](windows-guide.md).

1. Download `dAIly-Setup-0.1.0-x64.exe` from the `daily-windows-x64` artifact in the Windows application checks workflow. GitHub requires sign-in to download workflow artifacts.
2. Run the installer for your Windows user. It is unsigned, so Windows may display an unknown publisher prompt. No administrator account is required for the normal installation.
3. Open dAIly and save your routine. These starting values are editable. Set your own priorities, deadlines, weekly classes, and concrete tasks.
4. In Settings, install [Ollama for Windows](https://ollama.com/download/windows), open it, then click Check again.
5. Click Download Gemma. The approximately 3.3 GB download needs internet, disk space, and time. Cancel stops the current download; Retry resumes through Ollama.
6. Once Gemma is ready, update Today with your energy, cutoff, and anything that changed. Review the proposal, accept it, and explicitly start a block.
7. At the end, report actual work and time. This triggers a fresh recommendation. It does not require declaring the task completed.

After installation and model download, inference uses `127.0.0.1:11434`. No hosted AI service, account, API key, or subscription is used. Ollama must remain available. Timers and saved records remain usable without inference.

## Timetable and tasks

College is stored as one recurring start and end interval per weekday. Enter it manually or upload a PNG, JPEG, WEBP, CSV, or XLSX timetable. Gemma reads only the college-day start and end locally; review the times and confirm before saving. An unclear weekday stays unfilled and appears as a question. You can also report a college holiday in a day update; dAIly adds a one-day override for the explicitly named date. Commute is reserved on both sides of college.

Priority 5 is highest. Set a goal-level preferred amount of focus time per day; dAIly weighs it against other priorities, deadlines, and today's availability. A task estimate means total effort for that task, while a focus block is the work session dAIly proposes for today. Discuss a goal to work through its subtasks and target dates; inspect and approve the roadmap before it changes saved tasks. An evening ending after midnight uses the next day's cutoff. A fresh low-energy report limits suggested blocks to 20 minutes without changing your saved preference. Smaller tasks proposed by the daily mentor also require review. A timer outcome never completes a task without your confirmation.

## Data and desktop behaviour

SQLite lives in Electron's user-data directory, normally `%APPDATA%\dAIly\daily.db` on Windows. Export local records from Settings to a readable JSON file. Export includes conversation and personal planning history. Goal discussion and timetable imports run through Ollama on this laptop. The imported schedule keeps only recurring college-day start and end times, not each class, subject, or room.

Closing the window hides it to the tray. Use the tray to reopen, pause or resume, or quit. Launch at login and notifications are optional. Arrival check-ins follow the last class and expected commute. Quiet hours suppress notifications; suppressed session-end notices do not appear later, but the outcome prompt remains in the app.

Sleep pauses attribution. A restart during a running block asks you to confirm uncertain time. Uninstall keeps your local data. Ollama and its model files are installed separately and also remain installed. Quit both applications if you want them to stop consuming resources.

## Troubleshooting

| Situation                         | Action                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ollama unavailable                | Open Ollama on the same Windows laptop and click Check again. Use the default loopback port 11434.                                               |
| Download interrupted              | Retry. Ollama reuses already downloaded layers. Check free disk space and internet connectivity.                                                 |
| Gemma takes too long              | Cancel and retry after closing heavy applications. Cold loading can take longer. Current settings use 4096 context tokens and 384 output tokens. |
| Invalid model response            | Your accepted plan stays intact. The harness attempts one repair. Submit a shorter update or check your task estimates.                          |
| Situation changed during planning | Submit again. Older model results cannot overwrite newer state.                                                                                  |
| Block no longer fits              | Report current availability and request a fresh plan rather than starting the old block.                                                         |
| No notification                   | Enable notifications in dAIly and Windows. Check quiet hours, Windows Focus Assist, and notification permissions.                                |
| Cannot resume after sleep         | Confirm actual focus minutes first. Sleep time is not automatically counted.                                                                     |
| Newer database version            | Use the version that created the database. Do not delete your records to fix a version mismatch.                                                 |

The installer excludes models, databases, environment files, logs, and development sources. Gemma runtime memory is greater than or different from the download size. The recorded local results and remaining Windows laptop checks are in [evaluation.md](evaluation.md).

## Development

Use Node 24 and npm. Run `npm ci`, then `npm run dev`. The postinstall command explicitly downloads the pinned Electron binary before rebuilding SQLite for Electron. The first installation needs internet; subsequent installations can reuse Electron's download cache. `npm run check` includes type checks, lint, tests, and production bundling. `npm run test:desktop` uses a separate test database and produces smoke reports. `npm run evaluate:gemma` runs the real local model scenarios. `npm run package:win` must run on Windows for the supported installer build.

The dev launcher removes inherited `ELECTRON_RUN_AS_NODE`, which some coding environments set. If a Linux development host has an unusable SUID sandbox helper, fix the Electron sandbox installation or run a development smoke only with `DAILY_LINUX_NO_SANDBOX=1`. The shipped Windows application does not disable its sandbox.

## Ubuntu development

Use an Ubuntu desktop session with Node 24. On this checkout, Node, Ollama, and Gemma are already present. For a fresh machine, install prerequisites first:

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 zstd
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24
```

For this existing workspace:

```bash
cd /home/yajush-afk/hacktober/BuildForAFriend
git switch main
git pull --ff-only
npm ci
```

On a fresh checkout, clone `https://github.com/Yajush-afk/dAIly.git` instead. If Ollama is missing, use the [official Linux installer](https://ollama.com/download/linux):

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Check its local endpoint. If unavailable, run `ollama serve` in a separate terminal and leave it running. An installation managed by systemd can instead use `sudo systemctl start ollama`.

```bash
curl -fsS http://127.0.0.1:11434/api/tags
ollama pull gemma3:4b-it-q4_K_M
```

Pull reuses existing model files. If an older checkout reports `Electron uninstall`, run `npm run postinstall` to install the binary before starting development. No database reset or model download is needed for this error.

This machine's Electron dependency currently needs its sandbox helper permissions repaired after `npm ci`:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
npm run dev
```

Run those two permission commands again after reinstalling Electron dependencies if the error returns. The normal development command does not disable sandboxing. Native smoke testing uses an explicit test-only override on this host because the agent cannot provide the sudo password.

### Reset the local database

Quit dAIly from its tray menu and stop the development terminal first. Closing the window alone hides it to the tray. Build once, then ask Electron for the exact data directory rather than assuming the packaged and development names match:

```bash
npm run build
DAILY_DATA_DIR="$(npm run data:path --silent)"
printf '%s\n' "$DAILY_DATA_DIR"
```

The development directory on this Ubuntu checkout is `/home/yajush-afk/.config/daily-mentor`. The diagnostic command exits before opening a renderer or database. Reset removes profile, tasks, timetable, plans, sessions, conversation, notifications, and diagnostics. It does not remove Ollama or model weights. Back up the SQLite files, then remove only the database files:

```bash
DAILY_BACKUP_DIR="$DAILY_DATA_DIR/database-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DAILY_BACKUP_DIR"
for DAILY_DB_FILE in daily.db daily.db-wal daily.db-shm; do
  if [ -f "$DAILY_DATA_DIR/$DAILY_DB_FILE" ]; then
    cp -a "$DAILY_DATA_DIR/$DAILY_DB_FILE" "$DAILY_BACKUP_DIR/"
  fi
done
rm -f -- "$DAILY_DATA_DIR/daily.db" "$DAILY_DATA_DIR/daily.db-wal" "$DAILY_DATA_DIR/daily.db-shm"
npm run dev
```

### Developer checks

`npm ci` prepares SQLite for Electron. Node tests and evaluations need the Node build of the native module; rebuild it back for Electron afterward:

```bash
npm rebuild better-sqlite3
npm run check
npm run benchmark:history
npm run evaluate:gemma -- --repeats=2
npm run postinstall
npm run dev
```

Planning diagnostics retain the latest 1,000 requests in the database. They contain timings, attempt counts, result kinds, and validation error codes, without raw prompts or model output. To inspect them with the optional SQLite CLI:

```bash
sqlite3 "$DAILY_DATA_DIR/daily.db" 'SELECT value FROM diagnostics ORDER BY id DESC LIMIT 20;'
```
