import { authHeadersFromToken, getAccessTokenSync } from "@/lib/auth/accessTokenStore";
import { supabase } from "@/lib/supabase";

export const ADMIN_CLASSES_CACHE_TTL_MS = 30 * 1000;

export interface AdminClassesCacheEntry {
  students: unknown[];
  classes: unknown[];
  classProgress: Record<string, number>;
  courseGroups: unknown[];
  at: number;
}

let cache: AdminClassesCacheEntry | null = null;

export function getAdminClassesCache(now = Date.now()): AdminClassesCacheEntry | null {
  if (cache && now - cache.at < ADMIN_CLASSES_CACHE_TTL_MS) return cache;
  return null;
}

export function setAdminClassesCache(data: Omit<AdminClassesCacheEntry, "at">): void {
  cache = { ...data, at: Date.now() };
}

export function clearAdminClassesCache(): void {
  cache = null;
}

export async function warmAdminClasses(): Promise<void> {
  if (getAdminClassesCache() || !supabase) return;

  const authHeaders = authHeadersFromToken(getAccessTokenSync());
  if (!authHeaders.Authorization) return;

  const [studentsRes, classProgressRes, classesRes, videosRes] = await Promise.all([
    fetch("/api/admin/students", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
    fetch("/api/admin/class-progress-summary", { headers: authHeaders, cache: "no-store" }).then(
      async (r) => {
        if (!r.ok) return {} as Record<string, number>;
        const json = (await r.json()) as { classProgress?: Record<string, number> };
        return json.classProgress ?? {};
      }
    ),
    supabase.from("classes").select("id, title").order("title"),
    supabase
      .from("videos")
      .select("id, title, video_id, course_id, courses(id, title)")
      .order("created_at", { ascending: false }),
  ]);

  const studentsList = Array.isArray(studentsRes) ? studentsRes : [];
  const nextClasses = (classesRes?.data ?? []) as unknown[];

  let nextGroups: unknown[] = [];
  if (!videosRes.error && videosRes.data) {
    const list = videosRes.data as {
      course_id?: string | null;
      courses?: { id: string; title: string } | { id: string; title: string }[] | null;
    }[];
    const normalized = list.map((row) => ({
      ...row,
      courses: Array.isArray(row.courses) ? row.courses[0] ?? null : row.courses ?? null,
    }));
    const byCourse = new Map<string | null, typeof normalized>();
    for (const v of normalized) {
      const cid = v.course_id ?? null;
      if (!byCourse.has(cid)) byCourse.set(cid, []);
      byCourse.get(cid)!.push(v);
    }
    const groups: { courseId: string | null; courseTitle: string; videos: typeof normalized }[] = [];
    byCourse.forEach((videos, courseId) => {
      const courseTitle = videos[0]?.courses?.title ?? "기타 영상";
      groups.push({ courseId, courseTitle, videos });
    });
    groups.sort((a, b) => {
      if (a.courseId == null) return 1;
      if (b.courseId == null) return -1;
      return a.courseTitle.localeCompare(b.courseTitle);
    });
    nextGroups = groups;
  }

  setAdminClassesCache({
    students: studentsList,
    classes: nextClasses,
    classProgress: classProgressRes,
    courseGroups: nextGroups,
  });
}
