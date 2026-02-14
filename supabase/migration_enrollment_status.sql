-- profiles에 재원/퇴원 상태 컬럼 추가 (대시보드 재원생/퇴원생 탭용)
-- Supabase SQL Editor에서 실행하세요.

alter table public.profiles
  add column if not exists enrollment_status text not null default 'enrolled'
  check (enrollment_status in ('enrolled', 'withdrawn'));

comment on column public.profiles.enrollment_status is 'enrolled: 재원생, withdrawn: 퇴원생';
