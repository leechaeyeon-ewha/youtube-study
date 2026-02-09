-- ============================================================
-- 학원용 부정 시청 방지 학습 시스템 - Supabase 스키마 (재생성용) 최종
-- Supabase SQL Editor에 통째로 붙여넣고 Run 하세요.
-- ⚠️ 기존 profiles, videos, assignments 테이블과 데이터가 모두 삭제됩니다.
-- ============================================================

-- [1] 기존 트리거 제거 (auth.users 연동)
drop trigger if exists on_auth_user_created on auth.users;

-- [2] 기존 테이블 삭제 (FK 순서: assignments → videos, profiles)
drop table if exists public.assignments cascade;
drop table if exists public.videos cascade;
drop table if exists public.profiles cascade;

-- [3] profiles (auth.users와 1:1, role 권한, full_name으로 학생 로그인)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('admin', 'student')),
  full_name text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- [4] videos (유튜브 영상 등록)
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  video_id text not null unique,
  created_at timestamptz default now()
);

-- [5] assignments (학생별 영상 배정 + 진도, last_position/last_watched_at 모니터링용)
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  is_completed boolean not null default false,
  progress_percent numeric(5,2) not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  last_position numeric(10,2) not null default 0,
  last_watched_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, video_id)
);

-- [6] assignments → profiles 조인 (관리자 페이지에서 학생명 표시)
alter table public.assignments
  add constraint fk_assignments_profiles
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- [7] 인덱스
create index idx_assignments_user_id on public.assignments(user_id);
create index idx_assignments_video_id on public.assignments(video_id);

-- [8] RLS 활성화 (profiles는 아래에서 끔)
alter table public.profiles enable row level security;
alter table public.videos enable row level security;
alter table public.assignments enable row level security;

-- [9] profiles: 무한 재귀 방지를 위해 RLS 끄기 (관리자/학생 모두 profiles 조회 가능)
alter table public.profiles disable row level security;

-- [10] 현재 사용자 role 조회 함수 (videos, assignments 정책에서 사용)
create or replace function public.get_my_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid() limit 1;
$$;

-- [11] RLS 정책: videos
create policy "videos_select_authenticated" on public.videos for select to authenticated using (true);
create policy "videos_insert_admin" on public.videos for insert with check (
  public.get_my_profile_role() = 'admin'
);
create policy "videos_update_admin" on public.videos for update using (
  public.get_my_profile_role() = 'admin'
);
create policy "videos_delete_admin" on public.videos for delete using (
  public.get_my_profile_role() = 'admin'
);

-- [12] RLS 정책: assignments
create policy "assignments_select_own" on public.assignments for select using (auth.uid() = user_id);
create policy "assignments_select_admin" on public.assignments for select using (
  public.get_my_profile_role() = 'admin'
);
create policy "assignments_insert_admin" on public.assignments for insert with check (
  public.get_my_profile_role() = 'admin'
);
create policy "assignments_delete_admin" on public.assignments for delete using (
  public.get_my_profile_role() = 'admin'
);
create policy "assignments_update_own_progress" on public.assignments for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- [13] 회원가입/학생 생성 시 profiles 자동 생성 (full_name은 user_metadata에서)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, email, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    new.email,
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- [14] 관리자 지정 (실행 후 이메일만 수정해서 한 번 실행)
-- update public.profiles set role = 'admin' where email = 'lee_chaeyeon@ewha.ac.kr';
