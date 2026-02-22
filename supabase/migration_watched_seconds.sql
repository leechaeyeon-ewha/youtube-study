-- assignments에 실제 시청한 누적 시간(초) 추가 — 스킵 허용 시 진도율 = (watched_seconds / 영상 길이) * 100
alter table public.assignments
  add column if not exists watched_seconds numeric(12,2) not null default 0;
comment on column public.assignments.watched_seconds is '실제로 재생한 누적 시간(초). 스킵 방지 꺼짐일 때 진도율 계산에 사용';
