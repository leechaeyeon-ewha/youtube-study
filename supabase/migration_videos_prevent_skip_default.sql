-- videos 테이블에 영상별 스킵 방지 기본값 컬럼 추가
alter table public.videos
  add column if not exists prevent_skip_default boolean not null default true;

comment on column public.videos.prevent_skip_default is 'true: 기본적으로 스킵 방지 ON, false: 기본적으로 건너뛰기 허용';

