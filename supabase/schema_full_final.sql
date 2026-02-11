-- ============================================================
-- 학원용 부정 시청 방지 학습 시스템 - Supabase 스키마 (재생성용) 최종
-- Supabase SQL Editor에 통째로 붙여넣고 Run 하세요.
-- ⚠️ 기존 profiles, videos, assignments 테이블과 데이터가 모두 삭제됩니다.
-- ============================================================

-- [1] 기존 트리거 제거 (auth.users 연동)
drop trigger if exists on_auth_user_created on auth.users;

-- [2] 기존 테이블 삭제 (FK 순서: assignments → videos → courses, profiles → classes)
drop table if exists public.assignments cascade;
drop table if exists public.videos cascade;
drop table if exists public.courses cascade;
drop table if exists public.profiles cascade;
drop table if exists public.classes cascade;

-- [3] classes (반: 학생 그룹)
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_at timestamptz default now()
);

-- [4] profiles (auth.users와 1:1, role 권한, full_name, 학부모 리포트, 반 소속)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('admin', 'student')),
  full_name text,
  email text,
  report_token uuid unique default gen_random_uuid(),
  is_report_enabled boolean not null default false,
  parent_phone text,
  class_id uuid references public.classes(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_profiles_class_id on public.profiles(class_id);

-- [5] courses (강좌: 여러 영상을 묶음)
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  playlist_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- [6] videos (유튜브 영상 등록, course_id, 노출/주간과제 플래그)
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  video_id text not null unique,
  course_id uuid references public.courses(id) on delete set null,
  is_visible boolean not null default true,
  is_weekly_assignment boolean not null default false,
  created_at timestamptz default now()
);

create index idx_videos_course_id on public.videos(course_id);

-- [7] assignments (학생별 영상 배정 + 진도, last_position/last_watched_at 모니터링용)
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

-- [8] assignments → profiles 조인 (관리자 페이지에서 학생명 표시)
alter table public.assignments
  add constraint fk_assignments_profiles
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- [7] 인덱스
create index idx_assignments_user_id on public.assignments(user_id);
create index idx_assignments_video_id on public.assignments(video_id);

-- [8] RLS 활성화 (profiles는 아래에서 끔)
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.courses enable row level security;
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

-- [13] RLS 정책: classes
create policy "classes_select_authenticated" on public.classes for select to authenticated using (true);
create policy "classes_insert_admin" on public.classes for insert with check (
  public.get_my_profile_role() = 'admin'
);
create policy "classes_update_admin" on public.classes for update using (
  public.get_my_profile_role() = 'admin'
);
create policy "classes_delete_admin" on public.classes for delete using (
  public.get_my_profile_role() = 'admin'
);

-- [14] RLS 정책: courses
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

-- [15] RLS 정책: videos
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

-- [16] RLS 정책: assignments
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

-- [17] 회원가입/학생 생성 시 profiles 자동 생성 (full_name은 user_metadata에서)
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

-- [18] 관리자 지정 (실행 후 이메일만 수정해서 한 번 실행)
-- update public.profiles set role = 'admin' where email = 'lee_chaeyeon@ewha.ac.kr';
