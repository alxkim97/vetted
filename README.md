# Vetted

Every APm raw material evaluation in one filterable grid, built from the
comparison files in `Raw Material Evaluation Document\`. Web and Windows desktop
from one Vite codebase, the same setup as WorkLog, and stored in WorkLog's Supabase project.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Browser dev server |
| `npm run demo` | The app on `src/demo-scan.json` (real scan plus a few marked examples), no Supabase |
| `npm run demo:data` | Rebuild `src/demo-scan.json` from the folder |
| `npm test` | Parser tests |
| `npm run scan:dry` | Print what a scan finds, write nothing |
| `npm run scan` | Scan the folder and push to Supabase (needs `.env.local`) |
| `npm run log -- <action> …` | Log a message / request / receipt / verdict (see `scripts/rm-log.js`) |
| `npm run electron:dev` | Desktop app against the dev server |
| `npm run electron:build` | Windows installer into `release/` |

Bump `version` in package.json on every change; it's shown in the sidebar.

## How it fits together

```
Raw Material Evaluation Document\ ──(lib/scanner.js: desktop Re-scan, daily task, npm run scan)──► Supabase rm_*
                                                                                          ▲
                   chats ── scripts/rm-log.js ───────────────────────────────────────────┤
                   Vetted app (web / desktop) ── reads, stamps, timeline entries ───┘
```

- `lib/parse.js`: file names, Tracker block, verdict line, stamp suggestion. Pure and tested.
- `lib/scanner.js`: walks the folder (read-only). `lib/sync.js` writes only scan-owned columns, so
  stamps, notes and logged events survive every rescan.
- Precedence for a field: the file's Tracker block, then the value set in the app or by `rm-log`, then the scanner's guess.
- `src/`: the app. `model.js` derives status and durations, `views/` holds Register, Waiting,
  Materials and Settings, and `detail.js` is the evaluation sheet with its timeline.
- Full evaluation page (`views/evaluation.js`): the scan stores each comparison file in
  `rm_eval_docs`; `lib/doc.js` turns it into spreadsheet tables, marks Fail / Missing / Confirm
  rows from the Verdict or Status column, and translates Thai to English (form words built in,
  company names from the `rm_glossary` table so they stay out of this public repo).
- Products: `rm_materials.products` holds "Product · item code[ · grade]" entries, written
  outside the repo. A graded entry only matches evaluations of that grade.

## Setup

See [supabase/SETUP.md](supabase/SETUP.md): the SQL to run once, and `.env.local` for the scheduled scan and `rm-log`.
Daily scan: `powershell -ExecutionPolicy Bypass -File scripts\install-schedule.ps1 -Time 08:30`.
