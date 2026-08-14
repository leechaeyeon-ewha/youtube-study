-- assignments에 병합된 시청 구간 배열 저장 (진도율 계산 source of truth)
alter table public.assignments
  add column if not exists watched_intervals jsonb not null default '[]';

comment on column public.assignments.watched_intervals is
  '병합된 시청 구간 배열 [[startSec, endSec], ...]. 진도율은 서버에서 이 배열로 재계산.';
