-- profiles에 학년(중1~고3) 정보 추가
-- Supabase SQL Editor에서 한 번 실행하세요.

alter table public.profiles
  add column if not exists grade text
  check (grade in ('중1','중2','중3','고1','고2','고3'));

comment on column public.profiles.grade is '학생 학년 (중1~고3 등). 필요 없으면 NULL';

