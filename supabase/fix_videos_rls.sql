-- ============================================================
-- videos 테이블 RLS 정책 수정 (관리자 영상 등록/할당 허용)
-- Supabase SQL Editor에 붙여넣고 Run 하세요.
-- ============================================================

-- 1) profiles RLS 끄기 (관리자 여부를 안전하게 조회하기 위해)
alter table public.profiles disable row level security;

-- 2) 기존 videos 정책 모두 제거
drop policy if exists "videos_select_authenticated" on public.videos;
drop policy if exists "videos_insert_admin" on public.videos;
drop policy if exists "videos_update_admin" on public.videos;
drop policy if exists "videos_delete_admin" on public.videos;
drop policy if exists "Videos select authenticated" on public.videos;
drop policy if exists "Videos insert admin" on public.videos;
drop policy if exists "Videos update admin" on public.videos;
drop policy if exists "Videos delete admin" on public.videos;

-- 3) 로그인한 사용자는 영상 조회 가능
create policy "videos_select_authenticated"
on public.videos for select
to authenticated
using (true);

-- 4) profiles.role = 'admin' 인 사용자만 영상 삽입/수정/삭제 가능
create policy "videos_insert_admin"
on public.videos for insert
with check (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
);

create policy "videos_update_admin"
on public.videos for update
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
);

create policy "videos_delete_admin"
on public.videos for delete
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
);
