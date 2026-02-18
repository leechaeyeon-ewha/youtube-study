/**
 * 배정(Assignment) 조회 시 사용하는 select 문자열을 한 곳에서 관리합니다.
 * admin / student / watch 페이지가 동일한 스키마를 사용해 파편화와 오류를 줄입니다.
 * Join 시 불필요한 필드는 제외하고 필요한 컬럼만 요청합니다.
 */

/** 관리자: 배정 목록·진도·상세·우선학습·스킵방지 (assignments + videos + courses join) */
export const ASSIGNMENT_SELECT_ADMIN =
  "id, user_id, is_completed, progress_percent, last_position, last_watched_at, started_at, prevent_skip, is_visible, is_priority, videos(id, title, video_id, course_id, courses(id, title))";

/** 학생 목록/재생목록: 카드·진도·재생목록 그룹용 (videos + courses만) */
export const ASSIGNMENT_SELECT_STUDENT_LIST =
  "id, is_completed, progress_percent, is_visible, is_weekly_assignment, is_priority, videos(id, title, video_id, course_id, courses(id, title))";

/** 시청 페이지 단일 배정: 진도 저장·플레이어용 (last_position, prevent_skip 포함) */
export const ASSIGNMENT_SELECT_WATCH =
  "id, is_completed, progress_percent, last_position, prevent_skip, videos(id, title, video_id)";
