import { authHeadersFromToken, getAccessTokenSync } from "@/lib/auth/accessTokenStore";
import { supabase } from "@/lib/supabase";

export const TEACHER_VIDEOS_CACHE_TTL_MS = 30 * 1000;

export interface TeacherVideosCacheEntry {
  videos: unknown[];
  students: unknown[];
  at: number;
}

let cache: TeacherVideosCacheEntry | null = null;

export function getTeacherVideosCache(now = Date.now()): TeacherVideosCacheEntry | null {
  if (cache && now - cache.at < TEACHER_VIDEOS_CACHE_TTL_MS) return cache;
  return null;
}

export function setTeacherVideosCache(data: Omit<TeacherVideosCacheEntry, "at">): void {
  cache = { ...data, at: Date.now() };
}

export function clearTeacherVideosCache(): void {
  cache = null;
}

export async function warmTeacherVideos(): Promise<void> {
  if (getTeacherVideosCache() || !supabase) return;

  const h = authHeadersFromToken(getAccessTokenSync());
  if (!h.Authorization) return;

  const [videosRes, studentsRes] = await Promise.all([
    fetch("/api/teacher/videos", { headers: h, cache: "no-store" }).then((r) =>
      r.ok ? r.json() : []
    ),
    fetch("/api/teacher/students", { headers: h, cache: "no-store" }).then((r) =>
      r.ok ? r.json() : []
    ),
  ]);

  setTeacherVideosCache({
    videos: Array.isArray(videosRes) ? videosRes : [],
    students: Array.isArray(studentsRes) ? studentsRes : [],
  });
}
