-- 재생목록(강좌) 및 동영상 정렬 순서용 컬럼 추가
-- 영상관리/대시보드에서 위·아래 버튼으로 순서 변경 시 사용

-- [1] courses에 sort_order 추가
alter table public.courses
  add column if not exists sort_order integer not null default 0;

comment on column public.courses.sort_order is '관리자 화면에서의 재생목록(강좌) 표시 순서. 작을수록 위에 표시.';

-- [2] videos에 sort_order 추가
alter table public.videos
  add column if not exists sort_order integer not null default 0;

comment on column public.videos.sort_order is '같은 강좌 내·또는 기타 영상 목록에서의 표시 순서. 작을수록 위에 표시.';
