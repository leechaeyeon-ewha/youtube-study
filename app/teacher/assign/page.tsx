"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import LoadingSpinner from "@/components/LoadingSpinner";

interface AssignmentRow {
  id: string;
  user_id: string;
  is_completed: boolean;
  progress_percent: number;
  last_position: number;
  last_watched_at: string | null;
  started_at?: string | null;
  prevent_skip?: boolean;
  is_visible?: boolean;
  is_priority?: boolean;
  videos:
    | {
        id: string;
        title: string;
        video_id: string;
        course_id?: string | null;
        courses?: { id: string; title: string } | { id: string; title: string }[] | null;
      }
    | {
        id: string;
        title: string;
        video_id: string;
        course_id?: string | null;
        courses?: { id: string; title: string } | { id: string; title: string }[] | null;
      }[]
    | null;
}

interface StudentSummary {
  id: string;
  full_name: string | null;
  email: string | null;
  grade?: string | null;
  class_id?: string | null;
}

interface ClassRow {
  id: string;
  title: string;
}

export default function TeacherAssignPage() {
  const [mounted, setMounted] = useState(false);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [progressFilterByStudent, setProgressFilterByStudent] = useState<Record<string, "all" | "completed" | "incomplete" | "priority">>({});
  const [expandedPlaylistByStudent, setExpandedPlaylistByStudent] = useState<Record<string, string | null>>({});
  const [selectedByStudent, setSelectedByStudent] = useState<Record<string, string[]>>({});
  const [studentSort, setStudentSort] = useState<"none" | "grade" | "class">("none");
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  const [detailModalAssignment, setDetailModalAssignment] = useState<AssignmentRow | null>(null);
  const [priorityToggleId, setPriorityToggleId] = useState<string | null>(null);
  const [skipToggleId, setSkipToggleId] = useState<string | null>(null);
  const [watchStartsOpen, setWatchStartsOpen] = useState(false);
  const [watchStartsLoading, setWatchStartsLoading] = useState(false);
  const [watchStartsError, setWatchStartsError] = useState<string | null>(null);
  const [watchStartsAssignmentId, setWatchStartsAssignmentId] = useState<string | null>(null);
  const [watchStarts, setWatchStarts] = useState<{ id: string; started_at: string }[]>([]);

  function formatLastWatched(value: string | null | undefined): string {
    if (value == null || value === "") return "-";
    try {
      return new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return "-";
    }
  }
  function formatStartedAt(value: string | null | undefined): string {
    if (value == null || value === "") return "-";
    try {
      return new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return "-";
    }
  }

  async function handleToggleWatchStarts(assignmentId: string) {
    if (!supabase) return;
    if (watchStartsOpen && watchStartsAssignmentId === assignmentId) {
      setWatchStartsOpen(false);
      return;
    }
    setWatchStartsOpen(true);
    setWatchStartsAssignmentId(assignmentId);
    setWatchStartsLoading(true);
    setWatchStartsError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch(`/api/teacher/watch-starts?assignmentId=${encodeURIComponent(assignmentId)}`, { headers, cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { error?: string } | { id: string; started_at: string }[];
      if (!res.ok) {
        const errMsg = Array.isArray(data) ? undefined : (data as { error?: string }).error;
        setWatchStartsError(errMsg ?? "학습 시작 시간 목록을 불러오지 못했습니다.");
        return;
      }
      const list = Array.isArray(data) ? data : [];
      setWatchStarts(list);
    } catch (err: unknown) {
      setWatchStartsError(err instanceof Error ? err.message : "학습 시작 시간 목록을 불러오지 못했습니다.");
    } finally {
      setWatchStartsLoading(false);
    }
  }

  async function load() {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const h: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
    const [studentsRes, assignmentsRes, classesRes] = await Promise.all([
      fetch("/api/teacher/students", { headers: h, cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/teacher/assignments-list", { headers: h, cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/teacher/classes", { headers: h, cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    ]);
    setStudents(Array.isArray(studentsRes) ? studentsRes : []);
    setAssignments(Array.isArray(assignmentsRes) ? assignmentsRes : []);
    setClasses(Array.isArray(classesRes) ? classesRes : []);
    setLoading(false);
  }

  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    load();
  }, []);

  async function handleTogglePriority(assignmentId: string, current: boolean | undefined) {
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    setPriorityToggleId(assignmentId);
    try {
      const res = await fetch(`/api/teacher/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ is_priority: !current }),
      });
      if (res.ok) await load();
      else alert((await res.json().catch(() => ({}))).error || "변경 실패");
    } finally {
      setPriorityToggleId(null);
    }
  }

  async function handleTogglePreventSkip(assignmentId: string, current: boolean | undefined) {
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    setSkipToggleId(assignmentId);
    try {
      const res = await fetch(`/api/teacher/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ prevent_skip: !current }),
      });
      if (res.ok) await load();
      else alert((await res.json().catch(() => ({}))).error || "변경 실패");
    } finally {
      setSkipToggleId(null);
    }
  }

  async function handleUnassign(id: string) {
    if (!confirm("이 배정을 해제할까요?")) return;
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    const res = await fetch(`/api/teacher/assignments/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) await load();
    else alert((await res.json().catch(() => ({}))).error || "해제 실패");
  }

  function toggleSelectAssignment(userId: string, assignmentId: string) {
    setSelectedByStudent((prev) => {
      const prevList = prev[userId] ?? [];
      const exists = prevList.includes(assignmentId);
      const nextList = exists ? prevList.filter((id) => id !== assignmentId) : [...prevList, assignmentId];
      return { ...prev, [userId]: nextList };
    });
  }

  async function handleBulkUnassign(userId: string) {
    const ids = selectedByStudent[userId] ?? [];
    if (ids.length === 0) return;
    if (!confirm(`선택한 ${ids.length}개의 배정을 해제할까요?`)) return;
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    for (const id of ids) {
      await fetch(`/api/teacher/assignments/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    }
    setSelectedByStudent((prev) => ({ ...prev, [userId]: [] }));
    await load();
  }

  /** 이 학생의 배정 전체 해제 (재생목록 목록 화면용) */
  async function handleUnassignAllForStudent(userId: string) {
    const list = assignments.filter((a) => a.user_id === userId);
    if (list.length === 0) return;
    if (!confirm(`이 학생의 배정 ${list.length}개를 모두 해제할까요?`)) return;
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    const ids = list.map((a) => a.id);
    for (const id of ids) {
      await fetch(`/api/teacher/assignments/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    }
    setSelectedByStudent((prev) => ({ ...prev, [userId]: [] }));
    setExpandedPlaylistByStudent((prev) => ({ ...prev, [userId]: null }));
    await load();
  }

  if (!mounted) return null;
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  const byStudent = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    const list = byStudent.get(a.user_id) ?? [];
    list.push(a);
    byStudent.set(a.user_id, list);
  }
  const getClassTitle = (classId: string | null) => (classId ? classes.find((c) => c.id === classId)?.title ?? "" : "");
  const gradeOrder = ["중1", "중2", "중3", "고1", "고2", "고3"] as const;
  const gradeRank: Record<string, number> = gradeOrder.reduce((acc, g, idx) => ({ ...acc, [g]: idx }), {} as Record<string, number>);
  const searchLower = studentSearchQuery.trim().toLowerCase();
  const entries = students
    .filter(
      (s) =>
        !searchLower ||
        (s.full_name ?? "").toLowerCase().includes(searchLower) ||
        (s.email ?? "").toLowerCase().includes(searchLower)
    )
    .map((s) => [s.id, byStudent.get(s.id) ?? []] as const);
  const sortedEntries =
    studentSort === "none"
      ? entries
      : [...entries].sort(([userIdA], [userIdB]) => {
          const studentA = students.find((s) => s.id === userIdA);
          const studentB = students.find((s) => s.id === userIdB);
          const nameA = studentA?.full_name ?? studentA?.email ?? userIdA;
          const nameB = studentB?.full_name ?? studentB?.email ?? userIdB;
          if (studentSort === "grade") {
            const ra = gradeRank[studentA?.grade ?? ""] ?? 999;
            const rb = gradeRank[studentB?.grade ?? ""] ?? 999;
            if (ra !== rb) return ra - rb;
            return String(nameA).localeCompare(String(nameB));
          }
          if (studentSort === "class") {
            const ca = getClassTitle(studentA?.class_id ?? null);
            const cb = getClassTitle(studentB?.class_id ?? null);
            if (ca !== cb) return ca.localeCompare(cb);
            return String(nameA).localeCompare(String(nameB));
          }
          return 0;
        });

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">
        배정 목록 · 진도 현황
      </h1>
      <p className="mb-8 text-slate-600 dark:text-slate-400">
        담당 학생별 배정 영상의 진도, 시청 상세, 우선 학습·스킵 방지 설정을 확인하고, 필요 시 배정 해제할 수 있습니다.
      </p>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">
          배정 목록 · 진도 현황
        </h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          학생 정렬(기본/학년별/반별) 후 재생목록별로 진도 확인, 상세 보기, 우선 학습·스킵 방지 설정 및 배정 해제를 할 수 있습니다.
        </p>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {assignments.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
              배정된 학습이 없습니다.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-zinc-700">
                <input
                  type="text"
                  value={studentSearchQuery}
                  onChange={(e) => setStudentSearchQuery(e.target.value)}
                  placeholder="학생 이름 검색"
                  className="min-w-[140px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-slate-500"
                />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">학생 정렬</span>
                <button
                  type="button"
                  onClick={() => setStudentSort("none")}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    studentSort === "none"
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
                  }`}
                >
                  기본
                </button>
                <button
                  type="button"
                  onClick={() => setStudentSort("grade")}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    studentSort === "grade"
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
                  }`}
                >
                  학년별
                </button>
                <button
                  type="button"
                  onClick={() => setStudentSort("class")}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    studentSort === "class"
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
                  }`}
                >
                  반별
                </button>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-zinc-700">
                {sortedEntries.length === 0 ? (
                  <li className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                    {searchLower ? "검색 결과가 없습니다." : "담당 학생이 없습니다."}
                  </li>
                ) : (
                  sortedEntries.map(([userId, list]) => {
                    const student = students.find((s) => s.id === userId);
                    const studentName = student?.full_name || student?.email || userId.slice(0, 8);
                    const gradeLabel = student?.grade ?? null;
                    const classTitle = student?.class_id != null ? getClassTitle(student.class_id) : null;
                    const isExpanded = expandedStudentId === userId;
                    return (
                      <li key={userId} className="bg-white dark:bg-zinc-900">
                        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                          <span className="font-medium text-slate-900 dark:text-white">{studentName}</span>
                          {(gradeLabel || classTitle) && (
                            <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                              {gradeLabel ?? "학년 미지정"}
                              {classTitle ? ` · ${classTitle}` : ""}
                            </span>
                          )}
                          <span className="text-sm text-slate-500 dark:text-slate-400">배정 영상 {list.length}개</span>
                          <button
                            type="button"
                            onClick={() => setExpandedStudentId(isExpanded ? null : userId)}
                            className="rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                          >
                            {isExpanded ? "접기" : "배정된 영상 보기"}
                          </button>
                        </div>
                        {isExpanded &&
                          (() => {
                            const filter = progressFilterByStudent[userId] ?? "all";
                            const filteredList =
                              filter === "completed"
                                ? list.filter((a) => a.is_completed)
                                : filter === "incomplete"
                                  ? list.filter((a) => !a.is_completed)
                                  : filter === "priority"
                                    ? list.filter((a) => a.is_priority)
                                    : list;
                            const completedCount = list.filter((a) => a.is_completed).length;
                            const incompleteCount = list.length - completedCount;
                            const priorityCount = list.filter((a) => a.is_priority).length;
                            const NONE_KEY = "__none__";
                            const groups = (() => {
                              const map = new Map<string, { courseTitle: string; assignments: AssignmentRow[] }>();
                              for (const a of filteredList) {
                                const v = Array.isArray(a.videos) ? a.videos[0] : a.videos;
                                const key = v?.course_id ?? NONE_KEY;
                                const courseTitle = (() => {
                                  if (!v?.courses) return "기타 동영상";
                                  const c = Array.isArray(v.courses) ? v.courses[0] : v.courses;
                                  return (c as { title?: string })?.title ?? "기타 동영상";
                                })();
                                if (!map.has(key)) map.set(key, { courseTitle, assignments: [] });
                                map.get(key)!.assignments.push(a);
                              }
                              return Array.from(map.entries()).map(([courseKey, { courseTitle, assignments }]) => ({
                                courseKey,
                                courseTitle,
                                assignments,
                              }));
                            })();
                            const selectedKey = expandedPlaylistByStudent[userId];
                            const showPlaylistList = selectedKey == null;

                            /** 진도별 보기 버튼(전체/완료/미완료) — 항상 표시되어 다른 필터로 전환 가능 */
                            const progressFilterButtons = (
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">진도별 보기:</span>
                                <button
                                  type="button"
                                  onClick={() => setProgressFilterByStudent((prev) => ({ ...prev, [userId]: "all" }))}
                                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                                    filter === "all"
                                      ? "bg-indigo-600 text-white"
                                      : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
                                  }`}
                                >
                                  전체 ({list.length})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setProgressFilterByStudent((prev) => ({ ...prev, [userId]: "completed" }))}
                                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                                    filter === "completed"
                                      ? "bg-green-600 text-white"
                                      : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
                                  }`}
                                >
                                  완료 ({completedCount})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setProgressFilterByStudent((prev) => ({ ...prev, [userId]: "incomplete" }))}
                                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                                    filter === "incomplete"
                                      ? "bg-amber-600 text-white"
                                      : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
                                  }`}
                                >
                                  미완료 ({incompleteCount})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setProgressFilterByStudent((prev) => ({ ...prev, [userId]: "priority" }))}
                                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                                    filter === "priority"
                                      ? "bg-violet-600 text-white"
                                      : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
                                  }`}
                                >
                                  우선 학습 ({priorityCount})
                                </button>
                              </div>
                            );

                            if (filteredList.length === 0) {
                              return (
                                <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/30">
                                  {progressFilterButtons}
                                  <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                                    {filter === "all"
                                      ? "배정된 영상이 없습니다."
                                      : filter === "completed"
                                        ? "완료된 영상이 없습니다."
                                        : filter === "incomplete"
                                          ? "미완료 영상이 없습니다."
                                          : "우선 학습으로 지정된 영상이 없습니다."}
                                  </p>
                                </div>
                              );
                            }

                            if (showPlaylistList) {
                              return (
                                <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/30">
                                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    {progressFilterButtons}
                                    <button
                                      type="button"
                                      onClick={() => handleUnassignAllForStudent(userId)}
                                      className="rounded-lg bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60"
                                    >
                                      한 번에 배정 해제 ({list.length}개)
                                    </button>
                                  </div>
                                  <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                                    재생목록을 선택하면 해당 목록에 포함된 배정 영상들을 볼 수 있습니다. (재생목록에 속하지 않은 개별 영상은 &quot;기타 동영상&quot;에 모입니다.)
                                  </p>
                                  <ul className="space-y-1.5 rounded-lg border border-slate-200 dark:border-zinc-700">
                                    {groups.map(({ courseKey, courseTitle, assignments }) => (
                                      <li key={courseKey}>
                                        <button
                                          type="button"
                                          onClick={() => setExpandedPlaylistByStudent((prev) => ({ ...prev, [userId]: courseKey }))}
                                          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-zinc-800/50"
                                        >
                                          <span className="truncate">{courseTitle}</span>
                                          <span className="ml-2 shrink-0 text-slate-500 dark:text-slate-400">
                                            ({assignments.length}개 영상) →
                                          </span>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            }

                            const current = groups.find((g) => g.courseKey === selectedKey);
                            const showList = current?.assignments ?? [];

                            return (
                              <div className="border-t border-slate-100 bg-slate-50/50 dark:border-zinc-700 dark:bg-zinc-800/30">
                                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-zinc-700">
                                  {progressFilterButtons}
                                  <button
                                    type="button"
                                    onClick={() => setExpandedPlaylistByStudent((prev) => ({ ...prev, [userId]: null }))}
                                    className="ml-auto text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                                  >
                                    ← 재생목록 목록으로
                                  </button>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-sm">
                                    <thead>
                                      <tr className="border-b border-slate-200 dark:border-zinc-700">
                                        <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">
                                          <span className="sr-only">선택</span>
                                        </th>
                                        <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">영상</th>
                                        <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">진도율</th>
                                        <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">마지막 시청</th>
                                        <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">완료</th>
                                        <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">상세</th>
                                        <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">우선 학습</th>
                                        <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">스킵 방지</th>
                                        <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">관리</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {showList.length === 0 ? (
                                        <tr>
                                          <td colSpan={9} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                                            이 재생목록에 해당 조건의 배정 영상이 없습니다.
                                          </td>
                                        </tr>
                                      ) : (
                                        showList.map((a) => {
                                          const video = Array.isArray(a.videos) ? a.videos[0] : a.videos;
                                          const selectedIds = selectedByStudent[userId] ?? [];
                                          const checked = selectedIds.includes(a.id);
                                          return (
                                            <tr key={a.id} className="border-b border-slate-100 last:border-0 dark:border-zinc-700/50">
                                              <td className="px-4 py-2.5">
                                                <input
                                                  type="checkbox"
                                                  checked={checked}
                                                  onChange={() => toggleSelectAssignment(userId, a.id)}
                                                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-700"
                                                />
                                              </td>
                                              <td className="px-4 py-2.5 text-slate-800 dark:text-slate-200">{video?.title ?? "-"}</td>
                                              <td className="px-4 py-2.5">
                                                <span className={a.is_completed ? "font-medium text-green-600 dark:text-green-400" : "text-slate-600 dark:text-slate-400"}>
                                                  {a.progress_percent.toFixed(1)}%
                                                </span>
                                              </td>
                                              <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                                                {a.last_watched_at
                                                  ? new Date(a.last_watched_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })
                                                  : "-"}
                                              </td>
                                              <td className="px-4 py-2.5">
                                                {a.is_completed ? (
                                                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">완료</span>
                                                ) : (
                                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">미완료</span>
                                                )}
                                              </td>
                                              <td className="px-4 py-2.5">
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setDetailModalAssignment(a);
                                                    handleToggleWatchStarts(a.id);
                                                  }}
                                                  className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-slate-200 dark:hover:bg-zinc-700"
                                                >
                                                  상세
                                                </button>
                                              </td>
                                              <td className="px-4 py-2.5">
                                                <div className="flex items-center gap-2">
                                                  <button
                                                    type="button"
                                                    role="switch"
                                                    aria-checked={!!a.is_priority}
                                                    disabled={priorityToggleId === a.id}
                                                    onClick={() => handleTogglePriority(a.id, a.is_priority)}
                                                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors disabled:opacity-50 ${
                                                      a.is_priority ? "bg-indigo-600" : "bg-slate-200 dark:bg-zinc-600"
                                                    }`}
                                                  >
                                                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${a.is_priority ? "translate-x-5" : "translate-x-0.5"}`} />
                                                  </button>
                                                  <span className="text-xs text-slate-600 dark:text-slate-400">{a.is_priority ? "우선" : "일반"}</span>
                                                </div>
                                              </td>
                                              <td className="px-4 py-2.5">
                                                <div className="flex items-center gap-2">
                                                  <button
                                                    type="button"
                                                    role="switch"
                                                    aria-checked={!!a.prevent_skip}
                                                    disabled={skipToggleId === a.id}
                                                    onClick={() => handleTogglePreventSkip(a.id, a.prevent_skip)}
                                                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors disabled:opacity-50 ${
                                                      a.prevent_skip ? "bg-indigo-600" : "bg-slate-200 dark:bg-zinc-600"
                                                    }`}
                                                  >
                                                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${a.prevent_skip ? "translate-x-5" : "translate-x-0.5"}`} />
                                                  </button>
                                                  <span className="text-xs text-slate-600 dark:text-slate-400">{a.prevent_skip ? "켜짐" : "꺼짐"}</span>
                                                </div>
                                              </td>
                                              <td className="px-4 py-2.5">
                                                <button
                                                  type="button"
                                                  onClick={() => handleUnassign(a.id)}
                                                  className="text-red-600 hover:underline dark:text-red-400"
                                                >
                                                  배정 해제
                                                </button>
                                              </td>
                                            </tr>
                                          );
                                        })
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                                {(() => {
                                  const selectedIds = selectedByStudent[userId] ?? [];
                                  if (selectedIds.length === 0) return null;
                                  return (
                                    <div className="flex justify-end border-t border-slate-200 px-4 py-3 dark:border-zinc-700">
                                      <button
                                        type="button"
                                        onClick={() => handleBulkUnassign(userId)}
                                        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                                      >
                                        선택한 {selectedIds.length}개 배정 해제
                                      </button>
                                    </div>
                                  );
                                })()}
                              </div>
                            );
                          })()}
                      </li>
                    );
                  })
                )}
              </ul>
            </>
          )}
        </div>
      </section>

      {detailModalAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">시청 상세</h3>
            {(() => {
              const a = detailModalAssignment;
              const video = Array.isArray(a.videos) ? a.videos[0] : a.videos;
              const isCurrentAssignment = watchStartsAssignmentId === a.id;
              return (
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">영상</dt>
                    <dd className="font-medium text-slate-800 dark:text-slate-200">{video?.title ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">진도율</dt>
                    <dd className="text-slate-800 dark:text-slate-200">{a.progress_percent.toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">마지막 시청</dt>
                    <dd className="text-slate-800 dark:text-slate-200">{formatLastWatched(a.last_watched_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">최초 시청 시작 시간</dt>
                    <dd className="text-slate-800 dark:text-slate-200">
                      {formatStartedAt(
                        a.started_at ??
                          (isCurrentAssignment && watchStarts.length > 0
                            ? watchStarts[watchStarts.length - 1].started_at
                            : null)
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                      <span>학습 시작 시간</span>
                      <button
                        type="button"
                        onClick={() => handleToggleWatchStarts(a.id)}
                        className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-zinc-600 dark:text-slate-200 dark:hover:bg-zinc-800"
                      >
                        {watchStartsOpen && isCurrentAssignment ? "목록 접기" : "목록 보기"}
                      </button>
                    </dt>
                    <dd className="mt-1 text-slate-800 dark:text-slate-200">
                      {watchStartsOpen && isCurrentAssignment ? (
                        watchStartsLoading ? (
                          <span className="text-sm text-slate-500 dark:text-slate-400">불러오는 중...</span>
                        ) : watchStartsError ? (
                          <span className="text-sm text-red-600 dark:text-red-400" title={watchStartsError}>
                            데이터 로딩 실패: {watchStartsError}
                          </span>
                        ) : watchStarts.length === 0 ? (
                          <span className="text-sm text-slate-500 dark:text-slate-400">
                            학습 시작 기록이 없습니다. (테이블이 없으면 Supabase에서 migration_watch_starts.sql 실행)
                          </span>
                        ) : (
                          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
                            {watchStarts.map((w) => (
                              <li key={w.id} className="text-slate-700 dark:text-slate-200">
                                {new Date(w.started_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}
                              </li>
                            ))}
                          </ul>
                        )
                      ) : (
                        <span className="text-sm text-slate-500 dark:text-slate-400">버튼을 눌러 학습 시작 기록을 확인하세요.</span>
                      )}
                    </dd>
                  </div>
                </dl>
              );
            })()}
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setDetailModalAssignment(null);
                  setWatchStartsOpen(false);
                  setWatchStartsAssignmentId(null);
                  setWatchStarts([]);
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-slate-200 dark:hover:bg-zinc-700"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
