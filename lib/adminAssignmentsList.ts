import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSIGNMENT_SELECT_ADMIN } from "@/lib/assignments";

export const ASSIGNMENTS_LIST_PAGE_SIZE = 1000;

/** Supabase 1000행 제한을 넘는 assignments 전량 조회 (페이지 병렬 fetch) */
export async function fetchAllAssignmentsAdmin(
  supabase: SupabaseClient
): Promise<{ data: unknown[]; error: string | null }> {
  const { count, error: countError } = await supabase
    .from("assignments")
    .select("*", { count: "exact", head: true });

  if (countError) {
    return { data: [], error: countError.message };
  }

  const total = count ?? 0;
  if (total === 0) {
    return { data: [], error: null };
  }

  const pageCount = Math.ceil(total / ASSIGNMENTS_LIST_PAGE_SIZE);
  const offsets = Array.from({ length: pageCount }, (_, i) => i * ASSIGNMENTS_LIST_PAGE_SIZE);

  const pages = await Promise.all(
    offsets.map((offset) =>
      supabase
        .from("assignments")
        .select(ASSIGNMENT_SELECT_ADMIN)
        .order("created_at", { ascending: false })
        .range(offset, offset + ASSIGNMENTS_LIST_PAGE_SIZE - 1)
    )
  );

  const all: unknown[] = [];
  for (const page of pages) {
    if (page.error) {
      return { data: all.length > 0 ? all : [], error: page.error.message };
    }
    all.push(...(page.data ?? []));
  }

  return { data: all, error: null };
}
