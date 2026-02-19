-- 강사(teacher) 권한 및 학생-강사 매칭 (teacher_id)
-- Supabase SQL Editor에서 한 번 실행하세요.

-- [1] role에 'teacher' 추가 (기존 check 제거 후 재생성)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'student', 'teacher'));

-- [2] 학생 담당 강사 (profiles.id → 담당 강사 profile id)
alter table public.profiles
  add column if not exists teacher_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_profiles_teacher_id on public.profiles(teacher_id);

comment on column public.profiles.teacher_id is '담당 강사(teacher)의 profile id. 학생(role=student)만 사용.';
