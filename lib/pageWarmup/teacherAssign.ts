import { authHeadersFromToken, getAccessTokenSync } from "@/lib/auth/accessTokenStore";
import { supabase } from "@/lib/supabase";

export const TEACHER_ASSIGN_CACHE_TTL_MS = 30 * 1000;

export interface TeacherAssignCacheEntry {
  assignments: unknown[];
  students: unknown[];
  classes: unknown[];
  at: number;
}

let cache: TeacherAssignCacheEntry | null = null;

export function getTeacherAssignCache(now = Date.now()): TeacherAssignCacheEntry | null {
  if (cache && now - cache.at < TEACHER_ASSIGN_CACHE_TTL_MS) return cache;
  return null;
}

export function setTeacherAssignCache(data: Omit<TeacherAssignCacheEntry, "at">): void {
  cache = { ...data, at: Date.now() };
}

export function clearTeacherAssignCache(): void {
  cache = null;
}

export async function warmTeacherAssign(): Promise<void> {
  if (getTeacherAssignCache() || !supabase) return;

  const h = authHeadersFromToken(getAccessTokenSync());
  if (!h.Authorization) return;

  const [studentsRes, assignmentsRes, classesRes] = await Promise.all([
    fetch("/api/teacher/students", { headers: h, cache: "no-store" }).then((r) =>
      r.ok ? r.json() : []
    ),
    fetch("/api/teacher/assignments-list", { headers: h, cache: "no-store" }).then((r) =>
      r.ok ? r.json() : []
    ),
    fetch("/api/teacher/classes", { headers: h, cache: "no-store" }).then((r) =>
      r.ok ? r.json() : []
    ),
  ]);

  setTeacherAssignCache({
    students: Array.isArray(studentsRes) ? studentsRes : [],
    assignments: Array.isArray(assignmentsRes) ? assignmentsRes : [],
    classes: Array.isArray(classesRes) ? classesRes : [],
  });
}
