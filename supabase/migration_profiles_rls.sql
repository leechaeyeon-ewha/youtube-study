-- ============================================================
-- profiles 테이블 RLS 활성화 및 정책 적용
-- Supabase SQL Editor에서 한 번 실행하세요.
-- get_my_profile_role()은 기존 함수를 그대로 사용합니다.
-- ============================================================

-- [1] RLS 활성화
alter table public.profiles enable row level security;

-- [2] 기존 profiles 정책 제거 (충돌 방지)
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_admin" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;

-- [3] 본인 프로필 조회
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- [4] 관리자: 전체 프로필 조회 (assignments embed 등)
create policy "profiles_select_admin"
  on public.profiles
  for select
  to authenticated
  using (public.get_my_profile_role() = 'admin');

-- [5] 관리자: 전체 프로필 수정
create policy "profiles_update_admin"
  on public.profiles
  for update
  to authenticated
  using (public.get_my_profile_role() = 'admin')
  with check (public.get_my_profile_role() = 'admin');

-- [6] 본인 프로필 수정
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
