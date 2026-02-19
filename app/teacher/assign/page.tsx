"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import LoadingSpinner from "@/components/LoadingSpinner";

interface AssignmentRow {
  id: string;
  user_id: string;
  is_completed: boolean;
  progress_percent: number;
  last_watched_at: string | null;
  is_priority?: boolean;
  prevent_skip?: boolean;
  videos:
    | { id: string; title: string; video_id: string; course_id?: string | null; courses?: { id: string; title: string } | null }
    | { id: string; title: string; video_id: string; course_id?: string | null; courses?: { id: string; title: string }[] | null }
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
  const [priorityToggleId, setPriorityToggleId] = useState<string | null>(null);
  const [skipToggleId, setSkipToggleId] = useState<string | null>(null);
  const [studentSearchQuery, setStudentSearchQuery] = useState("");

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

  async function handleUnassign(assignmentId: string) {
    if (!confirm("이 배정을 해제할까요?")) return;
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    const res = await fetch(`/api/teacher/assignments/${assignmentId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) await load();
    else alert((await res.json().catch(() => ({}))).error || "해제 실패");
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
  const searchLower = studentSearchQuery.trim().toLowerCase();
  const entries = students
    .filter(
      (s) =>
        !searchLower ||
        (s.full_name ?? "").toLowerCase().includes(searchLower) ||
        (s.email ?? "").toLowerCase().includes(searchLower)
    )
    .map((s) => [s.id, byStudent.get(s.id) ?? []] as const);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">
        배정 목록 · 진도 현황
      </h1>
      <p className="mb-8 text-slate-600 dark:text-slate-400">
        담당 학생별 배정 영상 진도, 우선 학습·스킵 방지 설정, 배정 해제를 할 수 있습니다.
      </p>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-zinc-700">
          <input
            type="text"
            value={studentSearchQuery}
            onChange={(e) => setStudentSearchQuery(e.target.value)}
            placeholder="학생 이름 검색"
            className="min-w-[140px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-slate-500"
          />
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-zinc-700">
          {entries.length === 0 ? (
            <li className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
              {studentSearchQuery.trim() ? "검색 결과가 없습니다." : "담당 학생이 없습니다."}
            </li>
          ) : (
            entries.map(([userId, list]) => {
              const student = students.find((s) => s.id === userId);
              const name = student?.full_name || student?.email || userId.slice(0, 8);
              const isExpanded = expandedStudentId === userId;
              return (
                <li key={userId} className="bg-white dark:bg-zinc-900">
                  <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                    <span className="font-medium text-slate-900 dark:text-white">{name}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {student?.grade ?? ""} {getClassTitle(student?.class_id ?? null) ? `· ${getClassTitle(student?.class_id ?? null)}` : ""}
                    </span>
                    <span className="text-sm text-slate-500 dark:text-slate-400">배정 영상 {list.length}개</span>
                    <button
                      type="button"
                      onClick={() => setExpandedStudentId(isExpanded ? null : userId)}
                      className="rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                    >
                      {isExpanded ? "접기" : "배정된 영상 보기"}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/30">
                      {list.length === 0 ? (
                        <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">배정된 영상이 없습니다.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 dark:border-zinc-700">
                                <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">영상</th>
                                <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">진도</th>
                                <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">마지막 시청</th>
                                <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">우선 학습</th>
                                <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">스킵 방지</th>
                                <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">관리</th>
                              </tr>
                            </thead>
                            <tbody>
                              {list.map((a) => {
                                const video = Array.isArray(a.videos) ? a.videos[0] : a.videos;
                                return (
                                  <tr key={a.id} className="border-b border-slate-100 last:border-0 dark:border-zinc-700/50">
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
                                    </td>
                                    <td className="px-4 py-2.5">
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
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
