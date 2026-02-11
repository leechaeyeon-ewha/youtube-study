-- ============================================================
-- 학부모 전용 리포트 공유: profiles에 report_token, is_report_enabled, parent_phone 추가
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- [1] report_token (UUID, 고유, 기본값 생성)
alter table public.profiles
  add column if not exists report_token uuid unique default gen_random_uuid();

-- [2] is_report_enabled (리포트 활성화 여부, 기본 false)
alter table public.profiles
  add column if not exists is_report_enabled boolean not null default false;

-- [3] parent_phone (학부모 연락처)
alter table public.profiles
  add column if not exists parent_phone text;

-- [4] 기존 행에 report_token이 null이면 채우기
update public.profiles
set report_token = gen_random_uuid()
where report_token is null;

-- [5] unique 제약 (이미 있으면 무시)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_report_token_key'
  ) then
    alter table public.profiles add constraint profiles_report_token_key unique (report_token);
  end if;
end $$;
