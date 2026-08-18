/** 목록 정렬 옵션. 빈 문자열 = 기존 순서 유지 */
export type ListSortOption = "" | "date-asc" | "date-desc" | "name-asc" | "name-desc";

export function compareByName(a: string, b: string, asc: boolean): number {
  const cmp = (a ?? "").localeCompare(b ?? "", "ko", { numeric: true, sensitivity: "base" });
  return asc ? cmp : -cmp;
}

export function compareByDate(
  a: string | null | undefined,
  b: string | null | undefined,
  asc: boolean
): number {
  const ta = a ? new Date(a).getTime() : 0;
  const tb = b ? new Date(b).getTime() : 0;
  const safeA = Number.isNaN(ta) ? 0 : ta;
  const safeB = Number.isNaN(tb) ? 0 : tb;
  const cmp = safeA - safeB;
  return asc ? cmp : -cmp;
}

export function sortArray<T>(
  items: readonly T[],
  option: ListSortOption,
  getName: (item: T) => string,
  getDate: (item: T) => string | null | undefined
): T[] {
  if (!option) return [...items];
  return [...items].sort((a, b) => {
    if (option.startsWith("date")) {
      return compareByDate(getDate(a), getDate(b), option === "date-asc");
    }
    if (option.startsWith("name")) {
      return compareByName(getName(a), getName(b), option === "name-asc");
    }
    return 0;
  });
}

/** 재생목록 그룹의 등록일: 그룹 내 영상 중 가장 이른 created_at */
export function earliestCreatedAt(dates: (string | null | undefined)[]): string | undefined {
  let best: string | undefined;
  let bestTime = Infinity;
  for (const d of dates) {
    if (!d) continue;
    const t = new Date(d).getTime();
    if (!Number.isNaN(t) && t < bestTime) {
      bestTime = t;
      best = d;
    }
  }
  return best;
}
