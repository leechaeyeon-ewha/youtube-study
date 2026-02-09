-- ============================================================
-- full_name, last_position, last_watched_at 추가 (기존 DB 유지)
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- profiles에 full_name 추가 (로그인 시 이름 매칭용)
alter table public.profiles add column if not exists full_name text;
comment on column public.profiles.full_name is '학생 로그인 시 사용하는 이름 (관리자 등록)';

-- assignments에 last_position, last_watched_at 추가 (관리자 모니터링용)
alter table public.assignments add column if not exists last_position numeric(10,2) default 0;
alter table public.assignments add column if not exists last_watched_at timestamptz;
comment on column public.assignments.last_position is '마지막 시청 위치(초)';
comment on column public.assignments.last_watched_at is '마지막 시청 시각';

-- 트리거에서 full_name 설정 (관리자가 학생 생성 시 user_metadata.full_name 사용)
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
