# Recording with sample data

Close dAIly, including its tray process, before resetting a take.

Run `npm run demo` to seed a separate database once and open the development app with it. Subsequent launches retain the take. Run `npm run demo:reset` to replace only this demo database with a fresh fixture and open the app. `npm run demo:reset -- --seed-only` prepares the fixture without opening a window. Ordinary `npm run dev` uses normal application data.

Demo data lives in `artifacts/demo-recording/user-data/daily.db`. It has Kushagra's 180-minute focus preference, sleep from 02:30 to 08:00, DSA and GSoC goals, five subtasks, and two calendar days of sample history. Quiet hours follow sleep. Notifications and startup are off. Dates use Asia/Kolkata and refresh when resetting.

ML, the assignment, current planning, and conversations are intentionally empty. Add ML and discuss its subtasks live. Then report an assignment and enter the usable hours in check-in availability. Generate recommendations through real local Gemma. If recording before 08:00, the 02:30 sleep cutoff may already have passed; record at a time with real usable availability rather than changing the system clock.

Use a caption: "Sample planning history. AI responses generated locally during recording." The demo command rebuilds native SQLite for seeding and restores the Electron ABI before launch. Standard Linux Electron sandbox setup still applies.
