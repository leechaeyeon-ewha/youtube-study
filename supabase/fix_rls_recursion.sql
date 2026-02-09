-- ============================================================
-- RLS 무한 재귀 수정 (profiles 정책)
-- Supabase SQL Editor에 붙여넣고 Run 하세요. 테이블/데이터는 유지됩니다.
-- ============================================================

-- [1] 현재 사용자 role을 RLS 없이 조회하는 함수 (무한 재귀 방지)
create or replace function public.get_my_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid() limit 1;
$$;

-- [2] 기존 문제되는 정책 삭제
drop policy if exists "profiles_select_admin" on public.profiles;
drop policy if exists "videos_insert_admin" on public.videos;
drop policy if exists "videos_update_admin" on public.videos;
drop policy if exists "videos_delete_admin" on public.videos;
drop policy if exists "assignments_select_admin" on public.assignments;
drop policy if exists "assignments_insert_admin" on public.assignments;
drop policy if exists "assignments_delete_admin" on public.assignments;

-- [3] profiles: 관리자만 모든 프로필 읽기 (함수 사용)
create policy "profiles_select_admin" on public.profiles for select using (
  public.get_my_profile_role() = 'admin'
);

-- [4] videos: 관리자만 삽입/수정/삭제
create policy "videos_insert_admin" on public.videos for insert with check (
  public.get_my_profile_role() = 'admin'
);
create policy "videos_update_admin" on public.videos for update using (
  public.get_my_profile_role() = 'admin'
);
create policy "videos_delete_admin" on public.videos for delete using (
  public.get_my_profile_role() = 'admin'
);

-- [5] assignments: 관리자만 모든 할당 읽기/생성/삭제
create policy "assignments_select_admin" on public.assignments for select using (
  public.get_my_profile_role() = 'admin'
);
create policy "assignments_insert_admin" on public.assignments for insert with check (
  public.get_my_profile_role() = 'admin'
);
create policy "assignments_delete_admin" on public.assignments for delete using (
  public.get_my_profile_role() = 'admin'
);
