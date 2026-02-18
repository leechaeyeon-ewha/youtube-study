-- assignments에 우선 과제 플래그 추가
-- Supabase SQL Editor에서 한 번 실행하세요.

alter table public.assignments
  add column if not exists is_priority boolean not null default false;

comment on column public.assignments.is_priority is '우선 학습(오늘의 미션) 여부. true면 학생 화면 상단에 [우선 학습] 배지로 노출';

