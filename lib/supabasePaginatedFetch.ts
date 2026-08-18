import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSIGNMENTS_LIST_PAGE_SIZE } from "@/lib/adminAssignmentsList";

export { ASSIGNMENTS_LIST_PAGE_SIZE as SUPABASE_LIST_PAGE_SIZE };

type OrderSpec = { column: string; ascending?: boolean };

type PaginatedFetchConfig = {
  from: string;
  select: string;
  filters?: Record<string, string | number | boolean>;
  order: OrderSpec[];
};

/** Supabase PostgREST max-rows(1000)를 넘는 전량 조회 — assignments-list와 동일 패턴 */
export async function fetchAllPaginated<T = unknown>(
  supabase: SupabaseClient,
  config: PaginatedFetchConfig
): Promise<{ data: T[]; error: string | null }> {
  let countQuery = supabase.from(config.from).select("id", { count: "exact", head: true });
  for (const [column, value] of Object.entries(config.filters ?? {})) {
    countQuery = countQuery.eq(column, value);
  }

  const { count, error: countError } = await countQuery;
  if (countError) {
    return { data: [], error: countError.message };
  }

  const total = count ?? 0;
  if (total === 0) {
    return { data: [], error: null };
  }

  const pageSize = ASSIGNMENTS_LIST_PAGE_SIZE;
  const pageCount = Math.ceil(total / pageSize);
  const offsets = Array.from({ length: pageCount }, (_, i) => i * pageSize);

  const pages = await Promise.all(
    offsets.map((offset) => {
      let query = supabase.from(config.from).select(config.select);
      for (const [column, value] of Object.entries(config.filters ?? {})) {
        query = query.eq(column, value);
      }
      for (const spec of config.order) {
        query = query.order(spec.column, { ascending: spec.ascending ?? true });
      }
      return query.range(offset, offset + pageSize - 1);
    })
  );

  const all: T[] = [];
  for (const page of pages) {
    if (page.error) {
      return { data: all.length > 0 ? all : [], error: page.error.message };
    }
    all.push(...((page.data ?? []) as T[]));
  }

  return { data: all, error: null };
}

export async function fetchAllClasses(
  supabase: SupabaseClient,
  select: string
): Promise<{ data: unknown[]; error: string | null }> {
  return fetchAllPaginated(supabase, {
    from: "classes",
    select,
    order: [{ column: "title", ascending: true }],
  });
}

/** admin/videos — sort_order asc → created_at desc (fallback: created_at desc only) */
export async function fetchAllVideosAdminFull(
  supabase: SupabaseClient
): Promise<{ data: unknown[]; error: string | null }> {
  const primary = await fetchAllPaginated(supabase, {
    from: "videos",
    select:
      "id, title, video_id, course_id, is_visible, is_weekly_assignment, prevent_skip_default, sort_order, created_at, courses(id, title, sort_order)",
    order: [
      { column: "sort_order", ascending: true },
      { column: "created_at", ascending: false },
    ],
  });
  if (!primary.error) {
    return primary;
  }

  return fetchAllPaginated(supabase, {
    from: "videos",
    select: "id, title, video_id, course_id, created_at, courses(id, title)",
    order: [{ column: "created_at", ascending: false }],
  });
}

/** admin/classes·warm-up — courses join, created_at desc */
export async function fetchAllVideosWithCoursesBasic(
  supabase: SupabaseClient
): Promise<{ data: unknown[]; error: string | null }> {
  return fetchAllPaginated(supabase, {
    from: "videos",
    select: "id, title, video_id, course_id, courses(id, title)",
    order: [{ column: "created_at", ascending: false }],
  });
}

/** teacher/videos API — courses join, created_at desc */
export async function fetchAllVideosTeacher(
  supabase: SupabaseClient
): Promise<{ data: unknown[]; error: string | null }> {
  return fetchAllPaginated(supabase, {
    from: "videos",
    select: "id, title, video_id, course_id, courses(id, title)",
    order: [{ column: "created_at", ascending: false }],
  });
}

/** refresh-video-titles — id, video_id, title only */
export async function fetchAllVideosForTitleRefresh(
  supabase: SupabaseClient
): Promise<{ data: { id: string; video_id: string; title: string | null }[]; error: string | null }> {
  return fetchAllPaginated(supabase, {
    from: "videos",
    select: "id, video_id, title",
    order: [{ column: "id", ascending: true }],
  });
}
