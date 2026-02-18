"use client";

import { useEffect, useState } from "react";
import { ADMIN_ASSIGNMENTS_SELECT } from "@/lib/admin-assignments";
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
}

const ASSIGN_CACHE_TTL_MS = 30 * 1000;
let assignPageCache: {
  assignments: AssignmentRow[];
  students: StudentSummary[];
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
  /** 학생별 다중 선택된 배정 ID 목록 */
  const [selectedByStudent, setSelectedByStudent] = useState<Record<string, string[]>>({});

  async function load() {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const now = Date.now();
    if (assignPageCache && now - assignPageCache.at < ASSIGN_CACHE_TTL_MS) {
      setAssignments(assignPageCache.assignments);
      setStudents(assignPageCache.students);
      setLoading(false);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const authHeaders: Record<string, string> = session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};

    const [studentsRes, assignmentsRes] = await Promise.all([
      fetch("/api/admin/students", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
      supabase
        .from("assignments")
        .select(ADMIN_ASSIGNMENTS_SELECT)
        .order("created_at", { ascending: false }),
    ]);

    const nextStudents = Array.isArray(studentsRes) ? (studentsRes as StudentSummary[]) : [];
    const nextAssignments = assignmentsRes.error
      ? []
      : (((assignmentsRes.data ?? []) as unknown) as AssignmentRow[]);

    setStudents(nextStudents);
    setAssignments(nextAssignments);
    setLoading(false);
    assignPageCache = { assignments: nextAssignments, students: nextStudents, at: Date.now() };
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
    load();
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
    if (!supabase || !confirm("이 배정을 해제할까요?")) return;
    await supabase.from("assignments").delete().eq("id", id);
    load();
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">
        배정 목록 · 진도 현황
      </h1>
      <p className="mb-8 text-slate-600 dark:text-slate-400">
        학생별로 배정된 영상 목록과 진도를 확인하고, 필요 시 배정 해제할 수 있습니다.
      </p>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">
          배정 목록 · 진도 현황
        </h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          학생별로 배정된 영상을 확인하고, 배정 해제할 수 있습니다.
        </p>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {assignments.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
              배정된 학습이 없습니다.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-zinc-700">
              {(() => {
                const byStudent = new Map<string, AssignmentRow[]>();
                for (const a of assignments) {
                  const list = byStudent.get(a.user_id) ?? [];
                  list.push(a);
                  byStudent.set(a.user_id, list);
                }
                return Array.from(byStudent.entries()).map(([userId, list]) => {
                  const student = students.find((s) => s.id === userId);
                  const studentName = student?.full_name || student?.email || userId.slice(0, 8);
                  const isExpanded = expandedStudentId === userId;
                  return (
                    <li key={userId} className="bg-white dark:bg-zinc-900">
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span className="font-medium text-slate-900 dark:text-white">
                          {studentName}
                        </span>
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
                                    <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">관리</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {showList.length === 0 ? (
                                    <tr>
                                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
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
          )}
        </div>
      </section>
    </div>
  );
}
