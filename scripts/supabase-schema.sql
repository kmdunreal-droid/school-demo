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

-- =============================================================
-- NEW: Teacher self-attendance, teacher pay & school location
-- (har collection ki apni table — sync layer isi pattern par chalti hai)
-- =============================================================
create table if not exists public.teacher_attendance (
  id         text primary key,
  data       jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.teacher_pay (
  id         text primary key,
  data       jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.school_location (
  id         text primary key,
  data       jsonb,
  updated_at timestamptz not null default now()
);

alter table public.teacher_attendance enable row level security;
alter table public.teacher_pay enable row level security;
alter table public.school_location enable row level security;

drop policy if exists teacher_attendance_all_access on public.teacher_attendance;
create policy teacher_attendance_all_access on public.teacher_attendance
  for all to anon, authenticated using (true) with check (true);

drop policy if exists teacher_pay_all_access on public.teacher_pay;
create policy teacher_pay_all_access on public.teacher_pay
  for all to anon, authenticated using (true) with check (true);

drop policy if exists school_location_all_access on public.school_location;
create policy school_location_all_access on public.school_location
  for all to anon, authenticated using (true) with check (true);

-- Realtime ke liye naye tables ko publication mein add karne ka try
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['teacher_attendance', 'teacher_pay', 'school_location']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;