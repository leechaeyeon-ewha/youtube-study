export type ProfileRole = "admin" | "student" | "teacher";

export interface Profile {
  id: string;
  role: ProfileRole;
  full_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  report_token?: string | null;
  is_report_enabled?: boolean;
  parent_phone?: string | null;
  class_id?: string | null;
  /** 학년 (중1~고3). 없으면 null/undefined */
  grade?: string | null;
  /** 담당 강사(teacher)의 profile id. 학생만 사용 */
  teacher_id?: string | null;
}

export interface Course {
  id: string;
  title: string;
  description?: string | null;
  playlist_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Class {
  id: string;
  title: string;
  created_at?: string;
}

export interface Video {
  id: string;
  title: string;
  video_id: string; // YouTube ID
  course_id?: string | null;
  is_visible?: boolean;
  is_weekly_assignment?: boolean;
  created_at?: string;
}

export interface Assignment {
  id: string;
  user_id: string;
  video_id: string;
  is_completed: boolean;
  progress_percent: number;
  last_position?: number;
  last_watched_at?: string | null;
  /** 우선 학습(오늘의 미션) 여부 */
  is_priority?: boolean;
  videos?: Video | null;
}

export type AssignmentWithVideo = Assignment & { videos: Video | null };

export interface AssignmentWithVideoAndProfile extends Assignment {
  videos: Video | null;
  profiles?: { display_name: string | null; email: string | null } | null;
}
