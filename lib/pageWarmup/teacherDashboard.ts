import { authHeadersFromToken, getAccessTokenSync } from "@/lib/auth/accessTokenStore";
import { supabase } from "@/lib/supabase";

export const TEACHER_DASHBOARD_CACHE_TTL_MS = 30 * 1000;

export interface TeacherDashboardCacheEntry {
  students: unknown[];
  classes: unknown[];
  at: number;
}

let cache: TeacherDashboardCacheEntry | null = null;

export function getTeacherDashboardCache(now = Date.now()): TeacherDashboardCacheEntry | null {
  if (cache && now - cache.at < TEACHER_DASHBOARD_CACHE_TTL_MS) return cache;
  return null;
}

export function setTeacherDashboardCache(data: Omit<TeacherDashboardCacheEntry, "at">): void {
  cache = { ...data, at: Date.now() };
}

export function clearTeacherDashboardCache(): void {
  cache = null;
}

export async function warmTeacherDashboard(): Promise<void> {
  if (getTeacherDashboardCache() || !supabase) return;

  const authHeaders = authHeadersFromToken(getAccessTokenSync());
  if (!authHeaders.Authorization) return;

  const [studentsRes, classesRes] = await Promise.all([
    fetch("/api/teacher/students", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
    fetch("/api/teacher/classes", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
  ]);

  setTeacherDashboardCache({
    students: Array.isArray(studentsRes) ? studentsRes : [],
    classes: Array.isArray(classesRes) ? classesRes : [],
  });
}
