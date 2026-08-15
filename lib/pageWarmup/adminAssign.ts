import { authHeadersFromToken, getAccessTokenSync } from "@/lib/auth/accessTokenStore";
import { supabase } from "@/lib/supabase";

export const ADMIN_ASSIGN_CACHE_TTL_MS = 30 * 1000;

export interface AssignSummaryEntry {
  total: number;
  completed: number;
  priority: number;
}

export interface AdminAssignCacheEntry {
  students: unknown[];
  teachers: unknown[];
  classes: unknown[];
  assignSummaryByUser: Record<string, AssignSummaryEntry>;
  at: number;
}

let cache: AdminAssignCacheEntry | null = null;

export function getAdminAssignCache(now = Date.now()): AdminAssignCacheEntry | null {
  if (cache && now - cache.at < ADMIN_ASSIGN_CACHE_TTL_MS) return cache;
  return null;
}

export function setAdminAssignCache(data: Omit<AdminAssignCacheEntry, "at">): void {
  cache = { ...data, at: Date.now() };
}

export function clearAdminAssignCache(): void {
  cache = null;
}

export async function warmAdminAssign(): Promise<void> {
  if (getAdminAssignCache() || !supabase) return;

  const authHeaders = authHeadersFromToken(getAccessTokenSync());
  if (!authHeaders.Authorization) return;

  const [studentsRes, teachersRes, summaryRes, classesRes] = await Promise.all([
    fetch("/api/admin/students?scope=assign", { headers: authHeaders, cache: "no-store" }).then((r) =>
      r.ok ? r.json() : []
    ),
    fetch("/api/admin/teachers", { headers: authHeaders, cache: "no-store" }).then((r) =>
      r.ok ? r.json() : []
    ),
    fetch("/api/admin/assign-summary", { headers: authHeaders, cache: "no-store" }).then(async (r) => {
      if (!r.ok) return {} as Record<string, AssignSummaryEntry>;
      const json = (await r.json()) as { byUser?: Record<string, AssignSummaryEntry> };
      return json.byUser ?? {};
    }),
    supabase.from("classes").select("id, title").order("title"),
  ]);

  setAdminAssignCache({
    students: Array.isArray(studentsRes) ? studentsRes : [],
    teachers: Array.isArray(teachersRes) ? teachersRes : [],
    classes: classesRes.error ? [] : (classesRes.data ?? []),
    assignSummaryByUser: summaryRes,
  });
}
