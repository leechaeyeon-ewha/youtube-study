-- ============================================================
-- 반(Class) 관리 + 영상 노출/주간과제 플래그
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- [1] classes 테이블 (반)
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_at timestamptz default now()
);

-- [2] profiles에 class_id 추가
alter table public.profiles
  add column if not exists class_id uuid references public.classes(id) on delete set null;

create index if not exists idx_profiles_class_id on public.profiles(class_id);

-- [3] videos에 is_visible, is_weekly_assignment 추가
alter table public.videos
  add column if not exists is_visible boolean not null default true;

alter table public.videos
  add column if not exists is_weekly_assignment boolean not null default false;

-- [4] RLS: classes (관리자만 insert/update/delete)
alter table public.classes enable row level security;

drop policy if exists "classes_select_authenticated" on public.classes;
create policy "classes_select_authenticated" on public.classes for select to authenticated using (true);

drop policy if exists "classes_insert_admin" on public.classes;
create policy "classes_insert_admin" on public.classes for insert with check (
  public.get_my_profile_role() = 'admin'
);

drop policy if exists "classes_update_admin" on public.classes;
create policy "classes_update_admin" on public.classes for update using (
  public.get_my_profile_role() = 'admin'
);

drop policy if exists "classes_delete_admin" on public.classes;
create policy "classes_delete_admin" on public.classes for delete using (
  public.get_my_profile_role() = 'admin'
);
