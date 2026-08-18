-- ============================================================
-- profiles RLS infinite recursion 수정
-- migration_profiles_rls.sql 적용 후 발생한 재귀 오류 대응
-- Supabase SQL Editor에서 migration_profiles_rls.sql 다음에 실행하세요.
-- (profiles 테이블 RLS·정책만 수정. 다른 테이블 RLS는 건드리지 않음)
-- ============================================================
--
-- [원인]
-- profiles_select_admin / profiles_update_admin 이 public.get_my_profile_role() 을
-- 호출하고, 이 함수가 public.profiles 를 SELECT 합니다.
-- get_my_profile_role() 이 LANGUAGE sql 이면 PostgreSQL 이 정책 평가 시 함수를
-- 인라인(inline)하여 SECURITY DEFINER 컨텍스트가 사라지고, 내부 SELECT 가 다시
-- profiles RLS(특히 profiles_select_admin) 를 타면서 무한 재귀(42P17)가 납니다.
--
-- [해결]
-- LANGUAGE plpgsql + SECURITY DEFINER + 고정 search_path 로 함수를 재정의하면
-- 인라인되지 않아 definer(postgres) 권한으로 profiles 를 읽고 RLS 를 우회합니다.
-- (PostgreSQL 15+ 환경에서는 row_security = off 를 추가로 명시)
-- ============================================================

-- [1] profiles 정책만 제거 (재생성 전)
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_admin" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;

-- [2] role 조회 함수: plpgsql 로 재정의 (sql 인라인 → 재귀 방지)
create or replace function public.get_my_profile_role()
returns text
language plpgsql
security definer
set search_path = public
set row_security = off
stable
as $$
declare
  r text;
begin
  select p.role
    into r
    from public.profiles as p
   where p.id = (select auth.uid())
   limit 1;
  return r;
end;
$$;

-- RLS 정책·다른 테이블 정책에서 호출 가능하도록 (기존과 동일)
grant execute on function public.get_my_profile_role() to authenticated;
grant execute on function public.get_my_profile_role() to service_role;

-- [3] RLS 활성화 (임시로 disable 했다면 다시 켬)
alter table public.profiles enable row level security;

-- [4] profiles 정책 재생성 (migration_profiles_rls.sql 과 동일 조건)
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_select_admin"
  on public.profiles
  for select
  to authenticated
  using (public.get_my_profile_role() = 'admin');

create policy "profiles_update_admin"
  on public.profiles
  for update
  to authenticated
  using (public.get_my_profile_role() = 'admin')
  with check (public.get_my_profile_role() = 'admin');

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
