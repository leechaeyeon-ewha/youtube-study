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
  // Supabase 타입 상 videos가 배열로 잡힐 수 있어서 단일·배열 모두 허용
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
  enrollment_status?: "enrolled" | "withdrawn";
  teacher_id?: string | null;
}

interface TeacherRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface ClassRow {
  id: string;
  title: string;
}

const ASSIGN_CACHE_TTL_MS = 30 * 1000;
let assignPageCache: {
  assignments: AssignmentRow[];
  students: StudentSummary[];
  classes: ClassRow[];
  at: number;
} | null = null;

export default function AdminAssignPage() {
  const [mounted, setMounted] = useState(false);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  /** 학생별 진도 필터: 전체 | 완료 | 미완료 */
  const [progressFilterByStudent, setProgressFilterByStudent] = useState<Record<string, "all" | "completed" | "incomplete">>({});
  /** 학생별 배정 영상에서 펼친 재생목록: studentId -> courseKey (null이면 재생목록 목록 보기) */
  const [expandedPlaylistByStudent, setExpandedPlaylistByStudent] = useState<Record<string, string | null>>({});
  /** 학생 요약 정보 (이름/이메일) — /api/admin/students 기반 */
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  /** 반 목록 (id -> title 매핑용) */
  const [classes, setClasses] = useState<ClassRow[]>([]);
  /** 학생별 다중 선택된 배정 ID 목록 */
  const [selectedByStudent, setSelectedByStudent] = useState<Record<string, string[]>>({});
  /** 학생 목록 정렬: 기본(배정 순) | 학년별 | 반별 */
  const [studentSort, setStudentSort] = useState<"none" | "grade" | "class">("none");
  /** 학생 이름 검색어 */
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  /** 시청 상세 모달에 표시할 배정 */
  const [detailModalAssignment, setDetailModalAssignment] = useState<AssignmentRow | null>(null);
  /** 우선 학습 / 스킵 방지 토글 로딩 */
  const [priorityToggleAssignmentId, setPriorityToggleAssignmentId] = useState<string | null>(null);
  const [skipToggleAssignmentId, setSkipToggleAssignmentId] = useState<string | null>(null);
  /** 학습 시작 시간 목록 (시청 상세 모달용) */
  const [watchStartsOpen, setWatchStartsOpen] = useState(false);
  const [watchStartsLoading, setWatchStartsLoading] = useState(false);
  const [watchStartsError, setWatchStartsError] = useState<string | null>(null);
  const [watchStartsAssignmentId, setWatchStartsAssignmentId] = useState<string | null>(null);
  const [watchStarts, setWatchStarts] = useState<{ id: string; started_at: string }[]>([]);
  /** 시청 구간 확인 (스킵 허용 배정용) */
  const [watchSegmentsOpen, setWatchSegmentsOpen] = useState(false);
  const [watchSegmentsLoading, setWatchSegmentsLoading] = useState(false);
  const [watchSegmentsError, setWatchSegmentsError] = useState<string | null>(null);
  const [watchSegmentsAssignmentId, setWatchSegmentsAssignmentId] = useState<string | null>(null);
  const [watchSegments, setWatchSegments] = useState<{ start_sec: number; end_sec: number }[]>([]);

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
      const res = await fetch(`/api/admin/watch-starts?assignmentId=${encodeURIComponent(assignmentId as string)}`, { headers, cache: "no-store" });
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

  /** 시청 구간 확인 (스킵 허용 배정일 때만: 영상 몇 분~몇 분 시청했는지) */
  async function handleToggleWatchSegments(assignmentId: string) {
    if (!supabase) return;
    if (watchSegmentsOpen && watchSegmentsAssignmentId === assignmentId) {
      setWatchSegmentsOpen(false);
      return;
    }
    setWatchSegmentsOpen(true);
    setWatchSegmentsAssignmentId(assignmentId);
    setWatchSegmentsLoading(true);
    setWatchSegmentsError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch(`/api/admin/watch-segments?assignmentId=${encodeURIComponent(assignmentId)}`, { headers, cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { error?: string } | { start_sec: number; end_sec: number }[];
      if (!res.ok) {
        const errMsg = Array.isArray(data) ? undefined : (data as { error?: string }).error;
        setWatchSegmentsError(errMsg ?? "시청 구간을 불러오지 못했습니다.");
        return;
      }
      const list = Array.isArray(data) ? data : [];
      setWatchSegments(list);
    } catch (err: unknown) {
      setWatchSegmentsError(err instanceof Error ? err.message : "시청 구간을 불러오지 못했습니다.");
    } finally {
      setWatchSegmentsLoading(false);
    }
  }

  function formatSegmentTime(sec: number): string {
    const m = Math.floor(Number(sec) / 60);
    const s = Math.floor(Number(sec) % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  /** 관리자가 배정을 수정한 뒤 학생/관리자/시청 페이지 캐시 무효화 (즉시 갱신용) */
  async function revalidateStudentPaths(assignmentIds?: string[]) {
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    try {
      await fetch("/api/revalidate-student", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ assignmentIds: assignmentIds ?? [] }),
        cache: "no-store",
      });
    } catch {
      // 무시: 학생 쪽은 포커스 시 재조회로 보정됨
    }
  }

  async function handleTogglePreventSkip(assignmentId: string, currentPreventSkip: boolean | undefined) {
    if (!supabase) return;
    setSkipToggleAssignmentId(assignmentId);
    try {
      const { error } = await supabase.from("assignments").update({ prevent_skip: !currentPreventSkip }).eq("id", assignmentId);
      if (error) {
        const msg = error.message?.includes("prevent_skip") || error.code === "42703"
          ? "스킵 방지 설정을 사용하려면 Supabase에서 prevent_skip 컬럼을 추가해 주세요. (supabase/migration_prevent_skip.sql)"
          : error.message || "설정 변경에 실패했습니다.";
        alert(msg);
        return;
      }
      assignPageCache = null;
      revalidateStudentPaths([assignmentId]);
      await load();
    } finally {
      setSkipToggleAssignmentId(null);
    }
  }

  async function handleTogglePriority(assignmentId: string, currentPriority: boolean | undefined) {
    if (!supabase) return;
    setPriorityToggleAssignmentId(assignmentId);
    try {
      const { error } = await supabase.from("assignments").update({ is_priority: !currentPriority }).eq("id", assignmentId);
      if (error) {
        const msg = error.message?.includes("is_priority") || error.code === "42703"
          ? "우선 학습 설정을 사용하려면 Supabase에서 is_priority 컬럼을 추가해 주세요. (supabase/migration_assignments_priority.sql)"
          : error.message || "우선 학습 설정 변경에 실패했습니다.";
        alert(msg);
        return;
      }
      assignPageCache = null;
      revalidateStudentPaths([assignmentId]);
      await load();
    } finally {
      setPriorityToggleAssignmentId(null);
    }
  }

  async function load() {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const now = Date.now();
    if (assignPageCache && now - assignPageCache.at < ASSIGN_CACHE_TTL_MS) {
      setAssignments(assignPageCache.assignments);
      setStudents(assignPageCache.students);
      setClasses(assignPageCache.classes);
      setLoading(false);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const authHeaders: Record<string, string> = session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};

    const [studentsRes, teachersRes, assignmentsRes, classesRes] = await Promise.all([
      fetch("/api/admin/students", { headers: authHeaders, cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/admin/teachers", { headers: authHeaders, cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/admin/assignments-list", { headers: authHeaders, cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      supabase.from("classes").select("id, title").order("title"),
    ]);

    const nextAssignments = Array.isArray(assignmentsRes) ? (assignmentsRes as AssignmentRow[]) : [];

    const nextStudents = Array.isArray(studentsRes) ? (studentsRes as StudentSummary[]) : [];
    const nextTeachers = Array.isArray(teachersRes) ? (teachersRes as TeacherRow[]) : [];
    const nextClasses = classesRes.error ? [] : ((classesRes.data as ClassRow[]) ?? []);

    setStudents(nextStudents);
    setTeachers(nextTeachers);
    setAssignments(nextAssignments);
    setClasses(nextClasses);
    setLoading(false);
    assignPageCache = { assignments: nextAssignments, students: nextStudents, classes: nextClasses, at: Date.now() };
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
    if (!supabase) return;
    const ids = selectedByStudent[userId] ?? [];
    if (ids.length === 0) return;
    if (!confirm(`선택한 ${ids.length}개의 배정을 해제할까요?`)) return;
    await supabase.from("assignments").delete().in("id", ids);
    setSelectedByStudent((prev) => ({ ...prev, [userId]: [] }));
    assignPageCache = null;
    revalidateStudentPaths(ids);
    await load();
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    load();
    return () => {
      assignPageCache = null;
    };
  }, []);

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (!supabase) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  async function handleUnassign(id: string) {
    if (!supabase) return;
    if (!confirm("이 배정을 해제할까요?")) return;
    await supabase.from("assignments").delete().eq("id", id);
    assignPageCache = null;
    revalidateStudentPaths([id]);
    await load();
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">
        배정 목록 · 진도 현황
      </h1>
      <p className="mb-8 text-slate-600 dark:text-slate-400">
        학생별로 배정된 영상의 진도, 시청 상세, 우선 학습·스킵 방지 설정을 확인하고, 필요 시 배정 해제할 수 있습니다.
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
              {(() => {
                const byStudent = new Map<string, AssignmentRow[]>();
                for (const a of assignments) {
                  const list = byStudent.get(a.user_id) ?? [];
                  list.push(a);
                  byStudent.set(a.user_id, list);
                }
                // 대시보드와 동일하게 재원생만 표시 (배정 유무와 관계없이 전체 학생 수 일치)
                const enrolledStudents = students.filter(
                  (s) => (s.enrollment_status ?? "enrolled") === "enrolled"
                );
                const entries: [string, AssignmentRow[]][] = enrolledStudents.map((s) => [
                  s.id,
                  byStudent.get(s.id) ?? [],
                ]);
                const gradeOrder = ["중1", "중2", "중3", "고1", "고2", "고3"] as const;
                const gradeRank: Record<string, number> = gradeOrder.reduce(
                  (acc, g, idx) => ({ ...acc, [g]: idx }),
                  {} as Record<string, number>
                );
                const getClassTitle = (classId: string | null) => {
                  if (!classId) return "";
                  return classes.find((c) => c.id === classId)?.title ?? "";
                };
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
                const searchLower = studentSearchQuery.trim().toLowerCase();
                const entriesToShow = searchLower
                  ? sortedEntries.filter(([userId]) => {
                      const s = students.find((st) => st.id === userId);
                      return (
                        (s?.full_name ?? "").toLowerCase().includes(searchLower) ||
                        (s?.email ?? "").toLowerCase().includes(searchLower)
                      );
                    })
                  : sortedEntries;
                if (entriesToShow.length === 0) {
                  return (
                    <li className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                      {searchLower ? "검색 결과가 없습니다. 다른 이름으로 검색해 보세요." : "학생이 없습니다."}
                    </li>
                  );
                }
                return entriesToShow.map(([userId, list]) => {
                  const student = students.find((s) => s.id === userId);
                  const studentName = student?.full_name || student?.email || userId.slice(0, 8);
                  const teacherName = student?.teacher_id ? teachers.find((t) => t.id === student.teacher_id)?.full_name : null;
                  const gradeLabel = student?.grade ?? null;
                  const classTitle =
                    student?.class_id != null
                      ? classes.find((c) => c.id === student.class_id)?.title ?? null
                      : null;
                  const isExpanded = expandedStudentId === userId;
                  return (
                    <li key={userId} className="bg-white dark:bg-zinc-900">
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span className="font-medium text-slate-900 dark:text-white">
                          {studentName}
                          {teacherName && (
                            <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                              강사: {teacherName}
                            </span>
                          )}
                        </span>
                        {(gradeLabel || classTitle) && (
                          <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                            {gradeLabel ?? "학년 미지정"}
                            {classTitle ? ` · ${classTitle}` : ""}
                          </span>
                        )}
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          배정 영상 {list.length}개
                        </span>
                        <button
                          type="button"
                          onClick={() => setExpandedStudentId(isExpanded ? null : userId)}
                          className="rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                        >
                          {isExpanded ? "접기" : "배정된 영상 보기"}
                        </button>
                      </div>
                      {isExpanded && (() => {
                        const filter = progressFilterByStudent[userId] ?? "all";
                        const filteredList =
                          filter === "completed"
                            ? list.filter((a) => a.is_completed)
                            : filter === "incomplete"
                              ? list.filter((a) => !a.is_completed)
                              : list;
                        const completedCount = list.filter((a) => a.is_completed).length;
                        const incompleteCount = list.length - completedCount;
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

                        if (filteredList.length === 0) {
                          return (
                            <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-500 dark:border-zinc-700 dark:bg-zinc-800/30 dark:text-slate-400">
                              {filter === "all"
                                ? "배정된 영상이 없습니다."
                                : filter === "completed"
                                  ? "완료된 영상이 없습니다."
                                  : "미완료 영상이 없습니다."}
                            </div>
                          );
                        }

                        if (showPlaylistList) {
                          return (
                            <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/30">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
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
                                </div>
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
                            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-zinc-700">
                              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">진도별 보기:</span>
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
                                          <td className="px-4 py-2.5 text-slate-800 dark:text-slate-200">
                                            {video?.title ?? "-"}
                                          </td>
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
                                                disabled={priorityToggleAssignmentId === a.id}
                                                onClick={() => handleTogglePriority(a.id, a.is_priority)}
                                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${
                                                  a.is_priority ? "bg-indigo-600" : "bg-slate-200 dark:bg-zinc-600"
                                                }`}
                                              >
                                                <span
                                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                                                    a.is_priority ? "translate-x-5" : "translate-x-0.5"
                                                  }`}
                                                />
                                              </button>
                                              <span className="text-xs text-slate-600 dark:text-slate-400">
                                                {a.is_priority ? "우선" : "일반"}
                                              </span>
                                            </div>
                                          </td>
                                          <td className="px-4 py-2.5">
                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                role="switch"
                                                aria-checked={!!a.prevent_skip}
                                                disabled={skipToggleAssignmentId === a.id}
                                                onClick={() => handleTogglePreventSkip(a.id, a.prevent_skip)}
                                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${
                                                  a.prevent_skip ? "bg-indigo-600" : "bg-slate-200 dark:bg-zinc-600"
                                                }`}
                                              >
                                                <span
                                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                                                    a.prevent_skip ? "translate-x-5" : "translate-x-0.5"
                                                  }`}
                                                />
                                              </button>
                                              <span className="text-xs text-slate-600 dark:text-slate-400">
                                                {a.prevent_skip ? "켜짐" : "꺼짐"}
                                              </span>
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
                                <div className="flex justify-end px-4 py-3 border-t border-slate-200 dark:border-zinc-700">
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
                });
              })()}
            </ul>
            </>
          )}
        </div>
      </section>

      {/* 시청 상세 모달: 최초 시청 시작 시간 등 */}
      {detailModalAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">시청 상세</h3>
            {(() => {
              const a = detailModalAssignment;
              const video = Array.isArray(a.videos) ? a.videos[0] : a.videos;
              const isCurrentAssignment = watchStartsAssignmentId === a.id;
              const isSegmentsCurrent = watchSegmentsAssignmentId === a.id;
              const showSegmentsSection = a.prevent_skip === false;
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
                          <span className="text-sm text-slate-500 dark:text-slate-400" title="API는 성공했으나 목록이 비어 있음">
                            학습 시작 기록이 없습니다. (DB에 기록된 시청 시작 이력 없음)
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
                  {showSegmentsSection && (
                    <div>
                      <dt className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                        <span>시청 구간 (몇 분~몇 분)</span>
                        <button
                          type="button"
                          onClick={() => handleToggleWatchSegments(a.id)}
                          className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-zinc-600 dark:text-slate-200 dark:hover:bg-zinc-800"
                        >
                          {watchSegmentsOpen && isSegmentsCurrent ? "목록 접기" : "시청 구간 확인"}
                        </button>
                      </dt>
                      <dd className="mt-1 text-slate-800 dark:text-slate-200">
                        {watchSegmentsOpen && isSegmentsCurrent ? (
                          watchSegmentsLoading ? (
                            <span className="text-sm text-slate-500 dark:text-slate-400">불러오는 중...</span>
                          ) : watchSegmentsError ? (
                            <span className="text-sm text-red-600 dark:text-red-400" title={watchSegmentsError}>
                              {watchSegmentsError}
                            </span>
                          ) : watchSegments.length === 0 ? (
                            <span className="text-sm text-slate-500 dark:text-slate-400">
                              시청 구간 기록이 없습니다. (스킵 허용 상태에서 재생한 구간만 저장됩니다)
                            </span>
                          ) : (
                            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
                              {watchSegments.map((seg, i) => (
                                <li key={i} className="text-slate-700 dark:text-slate-200">
                                  {formatSegmentTime(seg.start_sec)} ~ {formatSegmentTime(seg.end_sec)} 시청
                                </li>
                              ))}
                            </ul>
                          )
                        ) : (
                          <span className="text-sm text-slate-500 dark:text-slate-400">버튼을 눌러 영상의 몇 분~몇 분을 시청했는지 확인하세요.</span>
                        )}
                      </dd>
                    </div>
                  )}
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
                  setWatchSegmentsOpen(false);
                  setWatchSegmentsAssignmentId(null);
                  setWatchSegments([]);
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
