# dAIly on Windows

This guide covers running dAIly on a Windows x64 laptop, recording with sample data, starting fresh takes, transferring a database, and troubleshooting setup.

For recording, use the repository launcher. It opens a separate demo database. The packaged installer opens personal application data.

## Before you start

- Use Windows x64 and ordinary PowerShell as your desktop user.
- Install [Git for Windows](https://git-scm.com/downloads/win), then reopen PowerShell if `git --version` is unavailable.
- Keep internet available for the first installation. Node, npm packages, Electron, Ollama, and Gemma need downloads.
- Gemma's model download is approximately 3.3 GB. Leave additional disk space for the app dependencies and model runtime. Download size is not a measurement of runtime RAM use.
- Do not copy `node_modules` from Ubuntu. The launcher installs Windows binaries.
- You do not need a paid AI service, account, or API key.

The launcher installs Node 24 locally if necessary, checks its download checksum, and reuses that installation later. It installs Ollama when missing and starts its local service when necessary.

## 1. Get the project

Open PowerShell:

```powershell
Set-Location $HOME
git clone https://github.com/Yajush-afk/dAIly.git
Set-Location .\dAIly
git switch main
git pull --ff-only
```

If the repository is already cloned, change into that folder instead of cloning again:

```powershell
Set-Location "$HOME\dAIly"
git switch main
git pull --ff-only
```

Change the folder above if you cloned elsewhere. Quit any running dAIly instance before updating or installing dependencies.

## 2. Install everything and open a fresh demo

From the repository folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1 -Reset
```

The script:

1. Prepares Node 24.
2. Installs or starts Ollama.
3. Installs the pinned application dependencies and Electron.
4. Pulls `gemma3:4b-it-q4_K_M`.
5. Creates a fresh isolated demo database.
6. Restores native SQLite for Electron and opens dAIly.

Keep the terminal open while using the app. The first run can take several minutes. Model download progress appears in the terminal. Later pulls reuse downloaded model layers.

`-ExecutionPolicy Bypass` applies to this PowerShell process. No permanent execution-policy change is required. The launcher uses `npm.cmd` internally.

### What the demo includes

| Item             | Sample data                                                   |
| ---------------- | ------------------------------------------------------------- |
| Profile          | Kushagra, Asia/Kolkata timezone                               |
| Focus preference | 180 minutes                                                   |
| Sleep            | 02:30 to 08:00                                                |
| Quiet hours      | Linked to sleep                                               |
| Goal 1           | DSA for interviews, priority 5, preferred 120 minutes per day |
| DSA subtasks     | DP, Revision of patterns, Mock OA/Contests                    |
| Goal 2           | Prepare for GSoC, priority 4, preferred 60 minutes per day    |
| GSoC subtasks    | Read issue #129 in org1, babysit and merge #14035 in org2     |
| History          | Two days of sample sessions                                   |
| Current planning | No initial plan, assignment, or conversation                  |

ML is intentionally absent so you can create and discuss that goal live. Sample dates refresh when you reset the demo. Notifications and launch at login are off.

The database is stored inside the repository:

```text
artifacts\demo-recording\user-data\daily.db
```

## 3. Quit properly between takes

Closing the window hides dAIly to its system tray. It does not quit the application.

1. Find dAIly in the Windows system tray, including the hidden-icons menu.
2. Choose **Quit**.
3. Press **Ctrl+C** in the terminal running the app.
4. Start the next take.

Do this before resets, database transfers, dependency installation, or updates. The launcher refuses to change a demo database while its recorded app process is still running.

## 4. Reopen your existing take

After completing initial installation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1 -SkipInstall
```

This preserves your added goals, conversations, plans, sessions, and outcomes. It reuses installed packages and Gemma, checks model readiness, and starts Ollama if required. The demo command still rebuilds SQLite for Node seeding and restores it for Electron.

After pulling application updates, run without `-SkipInstall` to refresh dependencies:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1
```

That command also preserves the existing demo database.

## 5. Start a fresh recording take

Quit the app and stop its terminal first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1 -SkipInstall -Reset
```

This replaces only the demo database with freshly dated sample data and opens dAIly. It removes the previous demo's added goals, chats, plans, and outcomes. Personal application data remains separate.

### Prepare or reset the database without opening the app

First-time database-only preparation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-demo-db-windows.ps1
```

Fresh database after initial setup:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-demo-db-windows.ps1 -SkipInstall -Reset
```

The database-only script prepares Node and packages when needed. It does not install, download, or start Ollama, and does not open Electron. Run `start-windows.ps1` afterward for the complete AI setup.

## 6. Check local AI

The launcher normally handles Ollama automatically. To inspect its model list separately:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags | ConvertTo-Json -Depth 5
```

Look for `gemma3:4b-it-q4_K_M`.

If you need Ollama commands and it is not on the current terminal's PATH:

```powershell
$env:Path = "$env:LOCALAPPDATA\Programs\Ollama;$env:Path"
ollama list
ollama pull gemma3:4b-it-q4_K_M
```

Open Ollama from the Start menu if the endpoint is unavailable. Alternatively, run the following in a separate terminal and leave it open:

```powershell
ollama serve
```

If Ollama is already listening on port 11434, do not start a second server. Once installed and downloaded, inference runs locally. Saved goals, plans, timers, and history remain available when inference is unavailable.

## 7. Recording walkthrough

Try this once before recording:

1. Check that the sample routine, goals, and history are present.
2. Add Learning ML and discuss a roadmap without manually adding subtasks.
3. Review and apply the proposed roadmap. Confirm that the subtasks appear under ML.
4. Open **Plan my day**. Enter real available time and energy, and mention an assignment with its estimate and deadline.
5. Confirm the proposed temporary assignment. It belongs to the day plan and does not appear as a goal.
6. Review the complete schedule, including college, breaks, and goal work. Apply it explicitly.
7. Start a focus block, pause or finish early, and report actual work and time.
8. Show the resulting recommendation and Progress.

Before the final recording, reset the demo again if you want those interactions to happen live from a clean take. A first warm-up request can reveal model latency before recording. Use real availability; a passed sleep cutoff can leave no time for planning.

Use an on-screen caption such as: **Sample planning history. AI responses generated locally during recording.** Sample history is not evidence of Kushagra's real usage. His cameo should describe his actual experience.

## 8. Direct npm commands and database transfer

The launcher may install Node only inside the repository. Its PATH changes apply to its child process, so `npm` may remain unavailable in your original terminal.

If Node 24 is already installed system-wide, skip this block. Otherwise, make the downloaded Node available in your current PowerShell session:

```powershell
$dailyNodeDirectory = Get-ChildItem .\artifacts\bootstrap -Directory -Filter 'node-v24.*-win-x64' |
    Where-Object { Test-Path (Join-Path $_.FullName 'node.exe') } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (!$dailyNodeDirectory) { throw 'Run start-windows.ps1 first to prepare Node 24.' }
$env:Path = "$($dailyNodeDirectory.FullName);$env:Path"
node --version
npm.cmd --version
```

Use `npm.cmd` for direct commands in PowerShell to avoid the `npm.ps1` execution-policy error.

### Export the current demo

Quit dAIly before exporting:

```powershell
npm.cmd run demo -- --export .\daily-demo-transfer.db
```

This uses SQLite's backup API and includes committed WAL data. Do not copy only `daily.db` from a running app.

### Import on another device

Complete the initial launcher setup on the destination, quit its app, and copy `daily-demo-transfer.db` into that repository folder. Prepare Node in the current terminal as described above, then run:

```powershell
npm.cmd run demo -- --import .\daily-demo-transfer.db --reset
```

This replaces the destination's demo and opens it. For import without opening the app:

```powershell
npm.cmd run demo -- --import .\daily-demo-transfer.db --reset --seed-only
```

The database is portable between Windows and Ubuntu. Models are installed separately on each laptop. Transfer preserves the original dates; reset instead if you need newly dated sample history. There is no live synchronization. Exported data includes chats and profile information.

## 9. Personal use and the Windows installer

To launch from source with personal data:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1 -Normal
```

Later, after initial setup:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1 -Normal -SkipInstall
```

`-Normal` cannot be combined with `-Reset` or `-SeedOnly`. The demo reset commands do not reset personal data.

For the packaged app:

1. Open the repository's [Windows application checks](https://github.com/Yajush-afk/dAIly/actions/workflows/windows.yml).
2. Choose a successful run for the latest main commit.
3. Download the `daily-windows-x64` artifact. GitHub requires sign-in for workflow artifacts.
4. Extract it and run `dAIly-Setup-0.1.0-x64.exe`.
5. Windows may display an unknown-publisher prompt because the installer is unsigned.
6. Complete onboarding and local AI setup in Settings.

The installer excludes models, personal data, and development dependencies. It does not preload the recording database. Existing Ollama and Gemma can be reused. Uninstall preserves application data and does not remove Ollama or downloaded models.

For building an installer yourself, after preparing Node in the current terminal:

```powershell
npm.cmd run package:win
```

The output is under `release`. Use the source launcher for the isolated demo recording.

## 10. Troubleshooting

| Problem                                               | What to do                                                                                                                                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git` is not recognized                               | Install Git for Windows and reopen PowerShell.                                                                                                                                                                    |
| Script path cannot be found                           | Change into the repository folder containing `start-windows.ps1`.                                                                                                                                                 |
| Script execution is disabled                          | Use the `powershell -NoProfile -ExecutionPolicy Bypass -File ...` command shown above. For direct npm commands, use `npm.cmd`.                                                                                    |
| Dependencies or Gemma are missing with `-SkipInstall` | Run the launcher without `-SkipInstall`.                                                                                                                                                                          |
| Demo process is still running                         | Quit from dAIly's tray, then Ctrl+C in its terminal. Closing only the window is insufficient.                                                                                                                     |
| Node is missing in the parent terminal                | Use the portable Node PATH block in section 8, or use the launcher directly.                                                                                                                                      |
| Ollama installed but unavailable                      | Reopen PowerShell, open Ollama from Start, and rerun the launcher.                                                                                                                                                |
| Model download was interrupted                        | Run without `-SkipInstall` again. Ollama reuses downloaded layers.                                                                                                                                                |
| SQLite reports a runtime/version mismatch             | Quit the app and rerun the launcher without `-SkipInstall`. The demo command rebuilds for Node and then Electron.                                                                                                 |
| Native SQLite compilation fails                       | If no suitable prebuilt binary is available, install Python and Visual Studio Build Tools with Desktop development with C++, reopen PowerShell, and rerun. The launcher does not install that optional toolchain. |
| `Electron uninstall` or Electron binary missing       | Quit the app and rerun the launcher without `-SkipInstall`. Its npm postinstall downloads Electron.                                                                                                               |
| Gemma returns invalid task details or changes a quote | Existing plans remain intact. Retry and share the exact error if it repeats. Resetting data does not fix inconsistent model output.                                                                               |
| Gemma takes too long                                  | Cancel, close heavy applications, and retry. Cold model loading can take longer.                                                                                                                                  |
| A planning result became stale                        | Request a fresh plan after changes to goals, availability, or preferences.                                                                                                                                        |
| App is still visible only in the tray                 | Use its tray Open action.                                                                                                                                                                                         |

A Windows CI pass confirms the tested syntax, database transfer, app flows, and packaging. It does not establish inference latency or installation success on every laptop. Try the actual recording flow before recording the final take.

## Command reference

Run these from the repository folder after quitting any active app:

| Purpose                            | Command                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| First setup with fresh demo        | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1 -Reset`                      |
| Reopen the current take            | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1 -SkipInstall`                |
| Refresh packages and preserve take | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1`                             |
| Fresh take after installation      | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1 -SkipInstall -Reset`         |
| Database only, first setup         | `powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-demo-db-windows.ps1`                     |
| Database only, fresh sample data   | `powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-demo-db-windows.ps1 -SkipInstall -Reset` |
| Personal data                      | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1 -Normal`                     |
