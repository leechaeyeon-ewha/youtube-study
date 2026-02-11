-- ============================================================
-- courses 테이블 추가 + videos에 course_id 연결
-- 기존 DB에 적용할 때 Supabase SQL Editor에서 이 파일만 실행하세요.
-- ============================================================

-- [1] courses 테이블 (강좌)
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  playlist_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- [2] videos에 course_id 추가 (없을 때만)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'videos' and column_name = 'course_id'
  ) then
    alter table public.videos
      add column course_id uuid references public.courses(id) on delete set null;
  end if;
end $$;

-- [3] 인덱스
create index if not exists idx_videos_course_id on public.videos(course_id);

-- [4] RLS
alter table public.courses enable row level security;

create policy "courses_select_authenticated" on public.courses for select to authenticated using (true);
create policy "courses_insert_admin" on public.courses for insert with check (
  public.get_my_profile_role() = 'admin'
);
create policy "courses_update_admin" on public.courses for update using (
  public.get_my_profile_role() = 'admin'
);
create policy "courses_delete_admin" on public.courses for delete using (
  public.get_my_profile_role() = 'admin'
);
