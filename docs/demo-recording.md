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
