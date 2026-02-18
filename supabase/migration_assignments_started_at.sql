-- assignments에 최초 시청 시작 시각 (진도 1% 이상이 된 시점에 한 번만 기록)
-- Supabase SQL Editor에서 한 번 실행하세요.

alter table public.assignments
  add column if not exists started_at timestamptz;

comment on column public.assignments.started_at is '최초 시청 시작 시각 (진도 1% 이상이 된 시점에 한 번만 기록, 기존 값 유지)';
