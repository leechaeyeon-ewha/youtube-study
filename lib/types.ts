export type ProfileRole = "admin" | "student";

export interface Profile {
  id: string;
  role: ProfileRole;
  full_name?: string | null;
  display_name?: string | null;
  email?: string | null;
}

export interface Video {
  id: string;
  title: string;
  video_id: string; // YouTube ID
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
  videos?: Video | null;
}

export type AssignmentWithVideo = Assignment & { videos: Video | null };

export interface AssignmentWithVideoAndProfile extends Assignment {
  videos: Video | null;
  profiles?: { display_name: string | null; email: string | null } | null;
}
