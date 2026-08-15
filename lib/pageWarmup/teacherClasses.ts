import { authHeadersFromToken, getAccessTokenSync } from "@/lib/auth/accessTokenStore";
import { supabase } from "@/lib/supabase";

export const TEACHER_CLASSES_CACHE_TTL_MS = 30 * 1000;

export interface TeacherClassesCacheEntry {
  students: unknown[];
  classes: unknown[];
  at: number;
}

let cache: TeacherClassesCacheEntry | null = null;

export function getTeacherClassesCache(now = Date.now()): TeacherClassesCacheEntry | null {
  if (cache && now - cache.at < TEACHER_CLASSES_CACHE_TTL_MS) return cache;
  return null;
}

export function setTeacherClassesCache(data: Omit<TeacherClassesCacheEntry, "at">): void {
  cache = { ...data, at: Date.now() };
}

export function clearTeacherClassesCache(): void {
  cache = null;
}

export async function warmTeacherClasses(): Promise<void> {
  if (getTeacherClassesCache() || !supabase) return;

  const h = authHeadersFromToken(getAccessTokenSync());
  if (!h.Authorization) return;

  const [studentsRes, classesRes] = await Promise.all([
    fetch("/api/teacher/students", { headers: h, cache: "no-store" }).then((r) =>
      r.ok ? r.json() : []
    ),
    fetch("/api/teacher/classes", { headers: h, cache: "no-store" }).then((r) =>
      r.ok ? r.json() : []
    ),
  ]);

  setTeacherClassesCache({
    students: Array.isArray(studentsRes) ? studentsRes : [],
    classes: Array.isArray(classesRes) ? classesRes : [],
  });
}
