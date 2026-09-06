-- =============================================================
-- SUPABASE SCHEMA for NSB1 School (records table)
-- Isse Supabase Dashboard → SQL Editor mein run karein (1 baar).
-- Phir data migrate karne ke liye: node scripts/migrate-neon-to-supabase.cjs
-- =============================================================

create table if not exists public.records (
  collection_name text not null,
  record_id       text not null,
  data            jsonb,
  updated_at      timestamptz not null default now(),
  primary key (collection_name, record_id)
);

-- Realtime (cross-device sync): table ko publication mein add karo
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records'
    ) then
      alter publication supabase_realtime add table public.records;
    end if;
  end if;
end $$;

-- Row Level Security: open access (current public-app behaviour ke hisaab se).
-- Production deploy karne se pehle ise auth-required policy se replace karein.
alter table public.records enable row level security;

drop policy if exists records_all_access on public.records;
create policy records_all_access on public.records
  for all to anon, authenticated
  using (true)
  with check (true);

-- Index for tabs (optional, chhoti table ke liye zaroori nahi)
create index if not exists records_col_idx on public.records (collection_name);