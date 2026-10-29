# Vetted — Supabase setup

Vetted lives in the **worklog** Supabase project (same login, same
`worklog_members` list, same `is_worklog_member()` check). It only adds
`rm_*` tables; nothing of WorkLog's is touched.

Run the block below once in **Supabase dashboard → SQL Editor**. It's safe to re-run.

```sql
-- ── Tables ─────────────────────────────────────────────────────────────
-- One row per material folder (Raw Material Evaluation Document\<Material>\).
create table if not exists rm_materials (
  id           uuid primary key default gen_random_uuid(),
  folder       text not null unique,
  name         text not null,
  kind         text check (kind in ('api', 'excipient')),
  products     text[] not null default '{}',   -- filled once the BOMs are re-pulled from MyDream
  notes        text,
  scan_seen_at timestamptz,
  removed_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One row per candidate folder (or per material, in the older one-file layout).
-- Scan-owned: grade, candidate, file_name, rev, rev_date, first_rev_date, tracker, verdict_line.
-- App/chat-owned: everything from candidate_name down. A tracker block in the
-- .md file wins over the app value when both exist.
create table if not exists rm_evaluations (
  id             uuid primary key default gen_random_uuid(),
  material_id    uuid not null references rm_materials(id) on delete cascade,
  folder         text not null unique,
  grade          text,
  candidate      text,
  file_name      text,
  rev            int,
  rev_date       date,
  first_rev_date date,
  tracker        jsonb not null default '{}',
  verdict_line   text,
  candidate_name text,
  stamp          text check (stamp in ('pass', 'gap', 'fail', 'closed_ok', 'closed_no')),
  supplier       text,
  manufacturer   text,
  avl_listed     boolean,
  item_code      text,
  next_action    text,
  notes          text,
  scan_seen_at   timestamptz,
  removed_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Timeline: documents received (from Document\YYMMDD\ folders), documents
-- requested, messages sent to PU / managers, verdicts, notes.
create table if not exists rm_events (
  id            uuid primary key default gen_random_uuid(),
  material_id   uuid not null references rm_materials(id) on delete cascade,
  evaluation_id uuid references rm_evaluations(id) on delete set null,
  kind          text not null check (kind in ('docs_received', 'docs_requested', 'message_sent', 'verdict', 'note')),
  event_date    date not null default current_date,
  what          text,      -- which documents, or the verdict
  party         text,      -- who it went to / came from (PU, K. Am, manager…)
  note          text,      -- message summary or free note
  closed_on     date,      -- a docs_requested row is open until this is set
  source        text not null default 'app' check (source in ('scan', 'chat', 'app')),
  source_ref    text unique, -- scan: the Document\YYMMDD path
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists rm_events_eval_idx on rm_events (evaluation_id);
create index if not exists rm_events_mat_idx on rm_events (material_id);

create table if not exists rm_scan_runs (
  id           bigint generated always as identity primary key,
  trigger      text,       -- 'desktop' | 'schedule' | 'cli'
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  materials    int,
  evaluations  int,
  events_added int,
  error        text
);

create or replace function public.rm_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists rm_materials_touch on rm_materials;
create trigger rm_materials_touch before update on rm_materials for each row execute function rm_touch();
drop trigger if exists rm_evaluations_touch on rm_evaluations;
create trigger rm_evaluations_touch before update on rm_evaluations for each row execute function rm_touch();

-- ── Members only (same rule as WorkLog) ────────────────────────────────
alter table rm_materials   enable row level security;
alter table rm_evaluations enable row level security;
alter table rm_events      enable row level security;
alter table rm_scan_runs   enable row level security;
drop policy if exists "members" on rm_materials;
drop policy if exists "members" on rm_evaluations;
drop policy if exists "members" on rm_events;
drop policy if exists "members" on rm_scan_runs;
create policy "members" on rm_materials   for all to authenticated using (is_worklog_member()) with check (is_worklog_member());
create policy "members" on rm_evaluations for all to authenticated using (is_worklog_member()) with check (is_worklog_member());
create policy "members" on rm_events      for all to authenticated using (is_worklog_member()) with check (is_worklog_member());
create policy "members" on rm_scan_runs   for all to authenticated using (is_worklog_member()) with check (is_worklog_member());
```

## `.env.local` (scheduled scan and `rm-log`)

The scheduled scan and the `rm-log` command run without anyone signed in, so
they use the service key. Create `.env.local` in this folder (git-ignored):

```
SUPABASE_URL=https://uhlbrxyvhfmfeakckzlu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<Project Settings → API → service_role>
```

Same key WorkLog's Vercel sync already uses. It stays on this PC; it's never
in the app bundle.
