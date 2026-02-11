-- ============================================================
-- assignments에 is_visible, is_weekly_assignment 추가 (학생/반별 노출·주간과제)
-- 기존 DB에 적용할 때 Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- [1] assignments에 컬럼 추가 (없을 때만)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assignments' and column_name = 'is_visible'
  ) then
    alter table public.assignments
      add column is_visible boolean not null default true;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'assignments' and column_name = 'is_weekly_assignment'
  ) then
    alter table public.assignments
      add column is_weekly_assignment boolean not null default false;
  end if;
end $$;

comment on column public.assignments.is_visible is '해당 학생에게 이 영상 노출 여부 (학생/반별 설정)';
comment on column public.assignments.is_weekly_assignment is '해당 학생에게 주간 과제 여부 (학생/반별 설정)';

-- [2] 관리자가 assignments의 is_visible, is_weekly_assignment 수정 가능
drop policy if exists "assignments_update_admin" on public.assignments;
create policy "assignments_update_admin" on public.assignments for update using (
  public.get_my_profile_role() = 'admin'
) with check (true);
