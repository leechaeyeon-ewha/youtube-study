-- 스킵 허용 시 영상의 "몇 분~몇 분" 시청 구간 저장 (관리자 상세에서 시청 구간 확인용)
create table if not exists public.watch_segments (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  start_sec numeric(10,2) not null,
  end_sec numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_watch_segments_assignment_id on public.watch_segments(assignment_id);

alter table public.watch_segments enable row level security;

-- 학생: 본인 배정에 한해 시청 구간 INSERT
create policy watch_segments_insert_own
  on public.watch_segments for insert
  with check (
    exists (select 1 from public.assignments a where a.id = assignment_id and a.user_id = auth.uid())
  );

-- SELECT는 서비스 롤(관리자 API)로만; anon/authenticated에서는 조회 불가
create policy watch_segments_select_none on public.watch_segments for select using (false);

comment on table public.watch_segments is '스킵 허용 시 실제로 시청한 구간(초 단위). 관리자 배정 상세에서 시청 구간 확인용';
