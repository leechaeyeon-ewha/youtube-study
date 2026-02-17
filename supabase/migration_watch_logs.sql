-- assignment별 시청 날짜 누적 기록용 테이블
create table if not exists public.watch_logs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  watched_date date not null,
  created_at timestamptz not null default now(),
  unique (assignment_id, watched_date)
);

comment on table public.watch_logs is '학생이 영상을 시청한 날짜(일 단위)를 누적 기록하는 테이블';
comment on column public.watch_logs.assignment_id is 'assignments.id (학생-영상 배정)';
comment on column public.watch_logs.watched_date is '해당 영상을 시청한 날짜 (YYYY-MM-DD, 로컬 기준으로 맞춰 사용)';
comment on column public.watch_logs.created_at is '기록이 생성된 시각';

