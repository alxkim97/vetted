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
| `npm run scan:dry` | Print what a scan finds, write nothing (`-- --files`: what an upload would send, and its size) |
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

- `lib/parse.js`: file names, Tracker block (stage lines), verdict line, stamp suggestion. Pure and tested.
- `lib/scanner.js`: walks the folder (read-only). `lib/sync.js` writes only scan-owned columns, so
  stages, notes and logged events survive every rescan.
- Precedence for a field: the file's Tracker block, then the value set in the app or by `rm-log`, then the scanner's guess.
- Stages (v0.6): AVL check (`avl_listed`) → CoA → Docs → QC sample, then an outcome. `model.js`
  `statusOf` turns them into one status: Approved / Not approved / Closed once there's an outcome,
  Fail for a failed stage, In progress while a data request is open (a `topic: 'form'` paperwork
  request doesn't count), otherwise Missing (nothing requested yet).
- `src/`: the app (v0.7: two places plus one page per evaluation). `model.js` derives status,
  stage dates (from 'stage' timeline entries, else estimated and marked), the station line
  (AVL, CoA, Docs, QC sample, Decision) and who has it now. `views/overview.js` and
  `views/evaluations.js` are the two places; `views/evaluation.js` is the evaluation page with
  its tabs and all editing. `edits.js` makes every change and records it for undo/redo
  (`undo.js`). `handoff.js` writes the chat prompt and the Thai PU message; `print.js` the
  status list and one-page PDFs.
- v0.8 tools (`views/tools.js`): **Reply to PU** ticks materials and drafts the Thai status
  reply to a PU follow-up (`reply.js`, golden form example 6) to copy into LINE; nothing is sent.
  **Needs a look** (`health.js`) checks each evaluation against its tracker block and dated
  Document folders (estimated decision date vs a signed form, Approved with docs missing, Not
  approved with an open request, request text vs `request_asked`, `request_sent` with nothing
  open, no tracker block). Read-only: it reports, fixing is by hand.
- v0.9: **QC sample tracker** (`model.js` `sampleOf`): a sample is its own request (`topic
  'sample'`, v0.9.0 SQL): to PU = requested → received; to QC = sent for testing → the QC
  stage as result, days between each. **Expiry watch**: `<doc>_valid_to:` lines in the tracker
  block (`lib/parse.js` `expiriesOf`), within 60 days on Overview. **Mark as sent** logs a
  message (and, from a result message, its requests) with the LINE screenshot in one step; a
  multi-material reply logs on every evaluation, one image copy each. **Decision date** can be
  set from the Decision station.
- v0.10: date fields always read **dd-mm-yyyy** whatever the PC locale (`dateInput.js`: text field +
  hidden native picker). **CoA and Docs dates from the signed form**: the first reviewer-annotated
  Selection Form scan whose name carries the current verdict word dates the stage (`model.js`
  `formStageDates`), beating the revision-date estimate; a date set by hand or a tracker
  `verdict_date` still wins.
- Addresses: `#/`, `#/evaluations`, `#/e/<first 8 of the id>[/tab]`, `#/settings`. A manager's
  view link is the same behind `#/v/<token>/`, read through `api/view.js` (Vercel) with the
  service key on the server; the browser gets no key that can write.
- Documents: the scan lists every file in the Document folders (`rm_files`); with upload on
  (`npm run scan -- --upload`, or the desktop Settings box) it sends each evaluation's newest
  Selection Form + CoA to the private `rm-files` bucket. The desktop app shows any of them
  in-app through `vetted-file://` (RM folder only).
- Evidence images (LINE screenshots, emails, form scans) attach to timeline entries: rows in
  `rm_evidence`, files in the private `rm-evidence` Storage bucket (members only, signed links).
  Never commit them; local copies live in the git-ignored `.secrets\evidence\`.
- Full evaluation page (`views/evaluation.js`): the scan stores each comparison file in
  `rm_eval_docs`; `lib/doc.js` turns it into spreadsheet tables, marks Fail / Missing / Confirm
  rows from the Verdict or Status column, and translates Thai to English (form words built in,
  company names from the `rm_glossary` table so they stay out of this public repo).
- Products: `rm_materials.products` holds "Product · item code[ · grade]" entries, written
  outside the repo. A graded entry only matches evaluations of that grade.

## Setup

See [supabase/SETUP.md](supabase/SETUP.md): the SQL to run once, and `.env.local` for the scheduled scan and `rm-log`.
Daily scan: `powershell -ExecutionPolicy Bypass -File scripts\install-schedule.ps1 -Time 08:30`.
