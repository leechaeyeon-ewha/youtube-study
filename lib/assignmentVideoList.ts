import {
  earliestCreatedAt,
  latestCreatedAt,
  sortArray,
  sortStudentPlaylistCards,
  type ListSortOption,
} from "@/lib/listSort";

export const ASSIGN_NONE_COURSE_KEY = "__none__";
export const ASSIGN_DEFAULT_NONE_TITLE = "기타 동영상";
export const VIDEO_SEARCH_DEBOUNCE_MS = 300;

export type AssignProgressFilter = "all" | "completed" | "incomplete" | "priority";

export interface AssignmentVideoJoin {
  created_at?: string | null;
  is_completed: boolean;
  is_priority?: boolean;
  videos:
    | {
        title: string;
        course_id?: string | null;
        courses?: { title: string } | { title: string }[] | null;
      }
    | {
        title: string;
        course_id?: string | null;
        courses?: { title: string } | { title: string }[] | null;
      }[]
    | null;
}

export interface AssignmentPlaylistGroup<T extends AssignmentVideoJoin> {
  courseKey: string;
  courseTitle: string;
  assignments: T[];
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchesVideoTitleSearch(title: string, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  return normalizeSearchText(title).includes(normalizedQuery);
}

export function getAssignmentVideo<T extends AssignmentVideoJoin>(a: T) {
  if (!a.videos) return null;
  return Array.isArray(a.videos) ? a.videos[0] : a.videos;
}

export function getAssignmentVideoTitle<T extends AssignmentVideoJoin>(a: T): string {
  return getAssignmentVideo(a)?.title ?? "";
}

export function getPlaylistTitleForAssignment<T extends AssignmentVideoJoin>(
  a: T,
  noneTitle = ASSIGN_DEFAULT_NONE_TITLE
): string {
  const v = getAssignmentVideo(a);
  if (!v) return noneTitle;
  const courseId = v.course_id ?? null;
  if (courseId === null) return noneTitle;
  if (!v.courses) return noneTitle;
  const c = Array.isArray(v.courses) ? v.courses[0] : v.courses;
  return (c as { title?: string })?.title ?? noneTitle;
}

export function filterAssignmentsByProgress<T extends AssignmentVideoJoin>(
  list: readonly T[],
  filter: AssignProgressFilter
): T[] {
  if (filter === "completed") return list.filter((a) => a.is_completed);
  if (filter === "incomplete") return list.filter((a) => !a.is_completed);
  if (filter === "priority") return list.filter((a) => a.is_priority);
  return [...list];
}

export function filterAssignmentsByVideoTitle<T extends AssignmentVideoJoin>(
  list: readonly T[],
  query: string
): T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [...list];
  return list.filter((a) => matchesVideoTitleSearch(getAssignmentVideoTitle(a), query));
}

export function sortAssignmentsByListOption<T extends AssignmentVideoJoin>(
  list: readonly T[],
  option: ListSortOption
): T[] {
  return sortArray(
    list,
    option,
    (a) => getAssignmentVideoTitle(a),
    (a) => a.created_at
  );
}

export function buildAssignmentPlaylistGroups<T extends AssignmentVideoJoin>(
  assignments: readonly T[],
  noneTitle = ASSIGN_DEFAULT_NONE_TITLE
): AssignmentPlaylistGroup<T>[] {
  const map = new Map<string, { courseTitle: string; assignments: T[] }>();
  for (const a of assignments) {
    const v = getAssignmentVideo(a);
    const key = v?.course_id ?? ASSIGN_NONE_COURSE_KEY;
    const courseTitle = getPlaylistTitleForAssignment(a, noneTitle);
    if (!map.has(key)) map.set(key, { courseTitle, assignments: [] });
    map.get(key)!.assignments.push(a);
  }
  return Array.from(map.entries()).map(([courseKey, { courseTitle, assignments: groupAssignments }]) => ({
    courseKey,
    courseTitle,
    assignments: groupAssignments,
  }));
}

export function sortAssignmentPlaylistGroups<T extends AssignmentVideoJoin>(
  groups: readonly AssignmentPlaylistGroup<T>[],
  option: ListSortOption
): AssignmentPlaylistGroup<T>[] {
  const cards = groups.map((g) => ({
    id: g.courseKey,
    title: g.courseTitle,
    videoCount: g.assignments.length,
    earliestAssignedAt: earliestCreatedAt(g.assignments.map((a) => a.created_at)),
    latestAssignedAt: latestCreatedAt(g.assignments.map((a) => a.created_at)),
  }));
  const sortedIds = sortStudentPlaylistCards(cards, option).map((c) => c.id);
  const byId = new Map(groups.map((g) => [g.courseKey, g]));
  return sortedIds.map((id) => byId.get(id)!);
}

export function prepareAssignStudentListView<T extends AssignmentVideoJoin>(params: {
  assignments: readonly T[];
  progressFilter: AssignProgressFilter;
  debouncedVideoSearch: string;
  playlistListSort: ListSortOption;
  playlistVideoListSort: ListSortOption;
  selectedPlaylistKey: string | null;
}) {
  const {
    assignments,
    progressFilter,
    debouncedVideoSearch,
    playlistListSort,
    playlistVideoListSort,
    selectedPlaylistKey,
  } = params;

  const filteredList = filterAssignmentsByProgress(assignments, progressFilter);
  const completedCount = assignments.filter((a) => a.is_completed).length;
  const incompleteCount = assignments.length - completedCount;
  const priorityCount = assignments.filter((a) => a.is_priority).length;

  const isVideoSearchActive = normalizeSearchText(debouncedVideoSearch).length > 0;
  const searchResults = isVideoSearchActive
    ? sortAssignmentsByListOption(
        filterAssignmentsByVideoTitle(filteredList, debouncedVideoSearch),
        playlistVideoListSort
      )
    : [];

  const groups = buildAssignmentPlaylistGroups(filteredList);
  const sortedGroups = sortAssignmentPlaylistGroups(groups, playlistListSort).map((g) => ({
    ...g,
    assignments: sortAssignmentsByListOption(g.assignments, playlistVideoListSort),
  }));

  const showPlaylistList = selectedPlaylistKey == null;
  const currentGroup = sortedGroups.find((g) => g.courseKey === selectedPlaylistKey);
  const sortedShowList = currentGroup?.assignments ?? [];

  return {
    filteredList,
    completedCount,
    incompleteCount,
    priorityCount,
    isVideoSearchActive,
    searchResults,
    sortedGroups,
    showPlaylistList,
    sortedShowList,
  };
}
