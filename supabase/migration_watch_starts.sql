-- 학습 시작 시각 기록 (영상 시청을 시작한 시점을 여러 번 기록해 진도·학습 패턴 파악)
-- Supabase SQL Editor에서 한 번 실행하세요.

create table if not exists public.watch_starts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  started_at timestamptz not null default now()
);

create index if not exists idx_watch_starts_assignment_id on public.watch_starts(assignment_id);
create index if not exists idx_watch_starts_started_at on public.watch_starts(started_at desc);

comment on table public.watch_starts is '학생이 해당 배정 영상 시청을 시작한 시각 목록 (로그인 후 영상 페이지 진입 시 기록)';
