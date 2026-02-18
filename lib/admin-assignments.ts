/**
 * 관리자 대시보드·배정목록 탭에서 동일한 배정 목록이 보이도록
 * assignments 조회 시 사용하는 select 문자열을 공통으로 사용합니다.
 * (한쪽만 수정하면 개수/상태가 달라질 수 있으므로 이 상수만 수정하세요.)
 */
export const ADMIN_ASSIGNMENTS_SELECT =
  "id, user_id, is_completed, progress_percent, last_position, last_watched_at, started_at, prevent_skip, is_visible, is_priority, videos(id, title, video_id, course_id, courses(id, title))";
