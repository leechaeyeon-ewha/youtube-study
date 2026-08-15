import { authHeadersFromToken, getAccessTokenSync } from "@/lib/auth/accessTokenStore";
import { supabase } from "@/lib/supabase";

export const ADMIN_DASHBOARD_CACHE_TTL_MS = 30 * 1000;

export interface AdminDashboardCacheEntry {
  students: unknown[];
  teachers: unknown[];
  classes: unknown[];
  at: number;
}

let cache: AdminDashboardCacheEntry | null = null;

export function getAdminDashboardCache(now = Date.now()): AdminDashboardCacheEntry | null {
  if (cache && now - cache.at < ADMIN_DASHBOARD_CACHE_TTL_MS) return cache;
  return null;
}

export function setAdminDashboardCache(
  data: Omit<AdminDashboardCacheEntry, "at">
): void {
  cache = { ...data, at: Date.now() };
}

export function clearAdminDashboardCache(): void {
  cache = null;
}

export async function warmAdminDashboard(): Promise<void> {
  if (getAdminDashboardCache() || !supabase) return;

  const authHeaders = authHeadersFromToken(getAccessTokenSync());
  if (!authHeaders.Authorization) return;

  const [studentsRes, teachersRes, classesRes] = await Promise.all([
    fetch("/api/admin/students", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
    fetch("/api/admin/teachers", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
    supabase.from("classes").select("id, title").order("title"),
  ]);

  setAdminDashboardCache({
    students: Array.isArray(studentsRes) ? studentsRes : [],
    teachers: Array.isArray(teachersRes) ? teachersRes : [],
    classes: classesRes.error ? [] : (classesRes.data ?? []),
  });
}
