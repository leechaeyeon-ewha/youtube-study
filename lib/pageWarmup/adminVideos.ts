import { supabase } from "@/lib/supabase";

export const ADMIN_VIDEOS_CACHE_TTL_MS = 30 * 1000;

export interface AdminVideosCacheEntry {
  courseGroups: unknown[];
  at: number;
}

let cache: AdminVideosCacheEntry | null = null;

export function getAdminVideosCache(now = Date.now()): AdminVideosCacheEntry | null {
  if (cache && now - cache.at < ADMIN_VIDEOS_CACHE_TTL_MS) return cache;
  return null;
}

export function setAdminVideosCache(data: Omit<AdminVideosCacheEntry, "at">): void {
  cache = { ...data, at: Date.now() };
}

export function clearAdminVideosCache(): void {
  cache = null;
}

/** admin/videos page와 동일한 그룹핑 (warm-up 전용) */
function buildCourseGroupsFromVideos(list: {
  course_id?: string | null;
  sort_order?: number;
  created_at?: string;
  courses?: { id: string; title: string; sort_order?: number } | { id: string; title: string; sort_order?: number }[] | null;
}[]): unknown[] {
  const normalized = list.map((row) => ({
    ...row,
    sort_order: row.sort_order ?? 0,
    courses: Array.isArray(row.courses) ? row.courses[0] ?? null : row.courses ?? null,
  }));
  const byCourse = new Map<string | null, typeof normalized>();
  for (const v of normalized) {
    const cid = v.course_id ?? null;
    if (!byCourse.has(cid)) byCourse.set(cid, []);
    byCourse.get(cid)!.push(v);
  }
  const groups: {
    courseId: string | null;
    courseTitle: string;
    courseSortOrder: number;
    videos: typeof normalized;
  }[] = [];
  byCourse.forEach((videos, courseId) => {
    const courseTitle = videos[0]?.courses?.title ?? "기타 영상";
    const courseSortOrder = videos[0]?.courses?.sort_order ?? 0;
    const sortedVideos = [...videos].sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        (a.created_at ?? "").localeCompare(b.created_at ?? "")
    );
    groups.push({ courseId, courseTitle, courseSortOrder, videos: sortedVideos });
  });
  groups.sort((a, b) => {
    if (a.courseId == null) return 1;
    if (b.courseId == null) return -1;
    return a.courseSortOrder - b.courseSortOrder || a.courseTitle.localeCompare(b.courseTitle);
  });
  return groups;
}

export async function warmAdminVideos(): Promise<void> {
  if (getAdminVideosCache() || !supabase) return;

  let data: unknown[] | null = null;
  const res = await supabase
    .from("videos")
    .select(
      "id, title, video_id, course_id, is_visible, is_weekly_assignment, prevent_skip_default, sort_order, created_at, courses(id, title, sort_order)"
    )
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  data = res.data;
  if (res.error && data == null) {
    const fallback = await supabase
      .from("videos")
      .select("id, title, video_id, course_id, created_at, courses(id, title)")
      .order("created_at", { ascending: false });
    if (!fallback.error && fallback.data) {
      data = fallback.data;
    }
  }

  if (data) {
    const groups = buildCourseGroupsFromVideos(
      data as Parameters<typeof buildCourseGroupsFromVideos>[0]
    );
    setAdminVideosCache({ courseGroups: groups });
  }
}
