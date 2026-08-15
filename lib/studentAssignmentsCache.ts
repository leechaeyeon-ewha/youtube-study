import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSIGNMENT_SELECT_STUDENT_LIST } from "@/lib/assignments";
import { getUserIdSync } from "@/lib/auth/accessTokenStore";
import { supabase } from "@/lib/supabase";

const CACHE_KEY = "youtube_study_student_assignments_v1";
/** /student ↔ /student/playlist/[id] 이동 시 중복 SELECT 방지 */
export const STUDENT_ASSIGNMENTS_CACHE_TTL_MS = 45 * 1000;

interface CacheEntry {
  userId: string;
  list: unknown[];
  at: number;
}

/** 시청 종료·배정 변경 후 학생 목록 캐시 무효화 */
export function invalidateStudentAssignmentsCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

function readCache(userId: string): unknown[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed.userId !== userId) return null;
    if (!parsed.at || Date.now() - parsed.at > STUDENT_ASSIGNMENTS_CACHE_TTL_MS) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed.list;
  } catch {
    sessionStorage.removeItem(CACHE_KEY);
    return null;
  }
}

function writeCache(userId: string, list: unknown[]): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry = { userId, list, at: Date.now() };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore quota errors
  }
}

export async function fetchStudentAssignmentsList(
  supabase: SupabaseClient,
  userId: string,
  options?: { force?: boolean }
): Promise<{
  data: unknown[] | null;
  error: { message: string } | null;
  fromCache: boolean;
}> {
  if (!options?.force) {
    const cached = readCache(userId);
    if (cached) {
      return { data: cached, error: null, fromCache: true };
    }
  }

  const { data, error } = await supabase
    .from("assignments")
    .select(ASSIGNMENT_SELECT_STUDENT_LIST)
    .eq("user_id", userId);

  if (error) {
    return { data: null, error: { message: error.message }, fromCache: false };
  }

  const list = data ?? [];
  writeCache(userId, list);
  return { data: list, error: null, fromCache: false };
}

/** hover prefetch: sessionStorage 캐시를 미리 채움 (TTL hit 시 no-op) */
export async function warmStudentAssignmentsList(): Promise<void> {
  if (!supabase) return;
  const userId = getUserIdSync();
  if (!userId) return;
  await fetchStudentAssignmentsList(supabase, userId, { force: false });
}
