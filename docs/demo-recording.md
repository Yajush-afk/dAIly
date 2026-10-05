# Recording with sample data

Close dAIly, including its tray process, before resetting a take.

Run `npm run demo` to seed a separate database once and open the development app with it. Subsequent launches retain the take. Run `npm run demo:reset` to replace only this demo database with a fresh fixture and open the app. `npm run demo:reset -- --seed-only` prepares the fixture without opening a window. Ordinary `npm run dev` uses normal application data.

Demo data lives in `artifacts/demo-recording/user-data/daily.db`. It has Kushagra's 180-minute focus preference, sleep from 02:30 to 08:00, DSA and GSoC goals, five subtasks, and two calendar days of sample history. Quiet hours follow sleep. Notifications and startup are off. Dates use Asia/Kolkata and refresh when resetting.

ML, the assignment, current planning, and conversations are intentionally empty. Add ML and discuss its subtasks live. Then report an assignment and enter the usable hours in check-in availability. Generate recommendations through real local Gemma. If recording before 08:00, the 02:30 sleep cutoff may already have passed; record at a time with real usable availability rather than changing the system clock.

Use a caption: "Sample planning history. AI responses generated locally during recording." The demo command rebuilds native SQLite for seeding and restores the Electron ABI before launch. Standard Linux Electron sandbox setup still applies.

## Another Windows or Ubuntu device

Clone or download this repository on the other device. These launchers install Node 24 when needed, npm dependencies, Ollama, and the Gemma model. Internet is needed for the initial downloads. They launch the isolated demo by default and preserve an existing take. Models are downloaded separately on each device; the database contains no model files.

Windows x64, from PowerShell in the repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1
```

### Windows recording, step by step

Use ordinary PowerShell, not an administrator terminal. Install [Git for Windows](https://git-scm.com/downloads/win) if `git --version` is unavailable, then open a new PowerShell window.

1. Clone the repository on the recording laptop:

   ```powershell
   Set-Location $HOME
   git clone https://github.com/Yajush-afk/dAIly.git
   Set-Location .\dAIly
   git switch main
   git pull --ff-only
   ```

   For an existing checkout, change into its folder and run only the switch and pull commands. Quit its existing app from the tray before updating.

2. Install everything, create a freshly dated demo database, and open the app:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1 -Reset
   ```

   This prepares Node 24, installs pinned npm dependencies and Electron, installs/starts Ollama when needed, pulls Gemma, seeds the demo, and launches dAIly. Keep this terminal open. The first run needs internet and several minutes for downloads. The script uses `npm.cmd`, so PowerShell does not need a permanent execution-policy change. It reuses a local Node download on subsequent launches.

3. For another launch with the same recording data, quit dAIly from its tray and press Ctrl+C in its terminal first:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1 -SkipInstall
   ```

   `-SkipInstall` reuses installed dependencies and the downloaded model. It still checks model availability, starts Ollama if necessary, and handles SQLite's Node/Electron rebuilds. After pulling application updates or if dependencies/model are missing, run without `-SkipInstall`.

4. For a fresh recording take, after quitting the app and stopping the terminal:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\start-windows.ps1 -SkipInstall -Reset
   ```

   This replaces only the isolated demo database and starts the app. It removes the previous demo's conversations, added goals, plans, and outcomes. The sample profile, DSA/GSoC goals, and two days of history return with current dates. Personal application data is untouched.

To reset the database without opening the app or starting Ollama, after completing initial installation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-demo-db-windows.ps1 -SkipInstall -Reset
```

To check Ollama separately:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags | ConvertTo-Json -Depth 5
```

Do not copy `node_modules` from Ubuntu. The Windows launcher installs Windows binaries. For the recording, use the source launcher above; the packaged installer opens personal data, not this isolated demo database. A first warm-up planning request helps you observe actual latency before recording. Model outputs can still fail validation, so review the proposed assignment and plan before accepting them.

### Ubuntu launcher

Ubuntu 24.04 or newer, from a terminal in the repository:

```bash
bash ./start-ubuntu.sh
```

Ubuntu requests sudo for system dependencies and Electron sandbox permissions. Windows uses a local Node download and the official Ollama installer. Keep the desktop app running as an ordinary user. If native SQLite must compile on Windows, install Visual Studio Build Tools with Desktop development with C++ and Python, then retry. The launcher does not install that large optional toolchain automatically.

For your personal database instead, pass `-Normal` on Windows or `--normal` on Ubuntu. No live synchronization is provided. Each device has its own local database and Ollama service.

## Transfer an exact take

Quit dAIly from its tray on both devices. Export the source demo using SQLite's backup API, which includes committed WAL data in one portable file:

```bash
npm run demo -- --export ./daily-demo-transfer.db
```

Copy `daily-demo-transfer.db` to the other device's repository folder using a USB drive or another file-transfer method. Install dependencies with the launcher first, then quit its app. Import and launch:

```bash
npm run demo -- --import ./daily-demo-transfer.db --reset
```

Import replaces only the destination's isolated demo take. Normal application data is untouched. Existing dates are preserved when transferring; use `npm run demo:reset` for freshly dated sample history instead. The transfer includes conversations and profile information, so share it only with the intended recipient. Database files remain ignored by Git.

## Prepare just the demo database

These two scripts install Node 24 if needed and the application dependencies, then create the demo database without opening Electron or downloading/starting Ollama. Ubuntu also prepares the system dependencies and sandbox for a later app launch. Native SQLite is restored to the Electron runtime after seeding.

Windows, from PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-demo-db-windows.ps1
```

Ubuntu:

```bash
bash ./setup-demo-db-ubuntu.sh
```

An existing demo take is kept. To replace it with freshly dated sample data, quit dAIly from its tray and add `-Reset` on Windows or `--reset` on Ubuntu. This changes only `artifacts/demo-recording/user-data/daily.db`; personal data is untouched.

Open the prepared demo afterward with the usual `start-windows.ps1` or `start-ubuntu.sh` launcher. They download local AI if needed and reuse this database.
