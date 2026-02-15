-- assignments에 스킵 방지 on/off (영상별 설정)
-- Supabase SQL Editor에서 한 번 실행하세요.

alter table public.assignments
  add column if not exists prevent_skip boolean not null default true;

comment on column public.assignments.prevent_skip is 'true: 건너뛰기 방지(시청한 구간 앞으로 감기 시 되돌림), false: 건너뛰기 허용';
