-- =============================================================
-- SUPABASE SCHEMA for Demo School (complete — 19 tables)
-- Isse Supabase Dashboard → SQL Editor mein run karein (1 baar).
-- Script IDEMPOTENT hai — baar-baar chalane par bhi error nahi aayega.
--
-- Pattern (sync layer src/lib/supabaseSync.ts KNOWN_TABLES se match):
--   har collection ki apni table: id text pk, data jsonb, updated_at
--
-- Tables:
--   students, teachers, coordinators, classes, timetable, attendance,
--   period_attendance, marks, fees, fee_data, assignments, app_settings,
--   teacher_attendance, teacher_pay, school_location,
--   notices, school_events, quizzes, quiz_attempts
--   (+ legacy: records)
--
-- NOTE: Gemini API key jaan-boojh kar yahan NAHI hai — wo sirf browser
--       localStorage mein rehti hai (security best practice).
-- =============================================================

-- -------------------------------------------------------------
-- 0) updated_at auto-touch helper (har update par now())
-- -------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -------------------------------------------------------------
-- 0.1) Legacy generic table (purana migrate path — backward-compat)
-- -------------------------------------------------------------
create table if not exists public.records (
  collection_name text not null,
  record_id       text not null,
  data            jsonb,
  updated_at      timestamptz not null default now(),
  primary key (collection_name, record_id)
);

-- -------------------------------------------------------------
-- 0.2) Har collection ki apni table — sync layer isi pattern par chalti hai
-- -------------------------------------------------------------
create table if not exists public.students   (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.teachers   (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.coordinators (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.classes    (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.timetable  (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.attendance (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.period_attendance (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.marks      (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.fees       (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.fee_data   (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.assignments (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.app_settings (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.teacher_attendance (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.teacher_pay (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.school_location (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.notices    (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.school_events (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.quizzes    (id text primary key, data jsonb, updated_at timestamptz not null default now());
create table if not exists public.quiz_attempts (id text primary key, data jsonb, updated_at timestamptz not null default now());

-- -------------------------------------------------------------
-- 1) Realtime (cross-device sync): SARI tables publication mein
--    (app subscribeRecords() sari tables par ek channel subscribe karta hai)
-- -------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'records',
      'students', 'teachers', 'coordinators', 'classes', 'timetable',
      'attendance', 'period_attendance', 'marks', 'fees', 'fee_data',
      'assignments', 'app_settings', 'teacher_attendance', 'teacher_pay',
      'school_location', 'notices', 'school_events', 'quizzes', 'quiz_attempts'
    ]
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

-- -------------------------------------------------------------
-- 2) Row Level Security: open access (current public-app behaviour)
--    PRODUCTION NOTE: deploy se pehle auth-required policies se replace karein
--    (e.g. using (auth.role() = 'authenticated')).
-- -------------------------------------------------------------
alter table public.records   enable row level security;
alter table public.students   enable row level security;
alter table public.teachers   enable row level security;
alter table public.coordinators enable row level security;
alter table public.classes    enable row level security;
alter table public.timetable  enable row level security;
alter table public.attendance enable row level security;
alter table public.period_attendance enable row level security;
alter table public.marks      enable row level security;
alter table public.fees       enable row level security;
alter table public.fee_data   enable row level security;
alter table public.assignments enable row level security;
alter table public.app_settings enable row level security;
alter table public.teacher_attendance enable row level security;
alter table public.teacher_pay enable row level security;
alter table public.school_location enable row level security;
alter table public.notices    enable row level security;
alter table public.school_events enable row level security;
alter table public.quizzes    enable row level security;
alter table public.quiz_attempts enable row level security;

-- Open policies — generic do-block se sari tables par (idempotent)
do $$
declare
  t text;
  pol text;
begin
  foreach t in array array[
    'records',
    'students', 'teachers', 'coordinators', 'classes', 'timetable',
    'attendance', 'period_attendance', 'marks', 'fees', 'fee_data',
    'assignments', 'app_settings', 'teacher_attendance', 'teacher_pay',
    'school_location', 'notices', 'school_events', 'quizzes', 'quiz_attempts'
  ]
  loop
    pol := t || '_all_access';
    execute format('drop policy if exists %I on public.%I', pol, t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      pol, t
    );
  end loop;
end $$;

-- -------------------------------------------------------------
-- 3) updated_at auto-trigger — har table par
-- -------------------------------------------------------------
do $$
declare
  t text;
  trg text;
begin
  foreach t in array array[
    'students', 'teachers', 'coordinators', 'classes', 'timetable',
    'attendance', 'period_attendance', 'marks', 'fees', 'fee_data',
    'assignments', 'app_settings', 'teacher_attendance', 'teacher_pay',
    'school_location', 'notices', 'school_events', 'quizzes', 'quiz_attempts'
  ]
  loop
    trg := 'trg_' || t || '_updated_at';
    execute format('drop trigger if exists %I on public.%I', trg, t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      trg, t
    );
  end loop;
end $$;

-- records table (composite pk) ka alag updated_at trigger
drop trigger if exists trg_records_updated_at on public.records;
create trigger trg_records_updated_at
  before update on public.records
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- 4) Performance indexes
-- -------------------------------------------------------------
create index if not exists records_col_idx on public.records (collection_name);

-- JSON data par queries (GIN — optional, useful for filtering)
create index if not exists students_data_gin   on public.students   using gin (data jsonb_path_ops);
create index if not exists attendance_data_gin on public.attendance using gin (data jsonb_path_ops);
create index if not exists marks_data_gin      on public.marks      using gin (data jsonb_path_ops);
create index if not exists fees_data_gin       on public.fees       using gin (data jsonb_path_ops);

-- -------------------------------------------------------------
-- 5) VERIFICATION — saari created tables list (output mein 20 aani chahiye)
-- -------------------------------------------------------------
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'records',
    'students', 'teachers', 'coordinators', 'classes', 'timetable',
    'attendance', 'period_attendance', 'marks', 'fees', 'fee_data',
    'assignments', 'app_settings', 'teacher_attendance', 'teacher_pay',
    'school_location', 'notices', 'school_events', 'quizzes', 'quiz_attempts'
  )
order by table_name;