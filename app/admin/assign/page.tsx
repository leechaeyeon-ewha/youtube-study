"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Video } from "@/lib/types";
import type { Profile } from "@/lib/types";
import LoadingSpinner from "@/components/LoadingSpinner";

interface AssignmentRow {
  id: string;
  user_id: string;
  is_completed: boolean;
  progress_percent: number;
  last_position: number;
  last_watched_at: string | null;
  // Supabase 타입 상 videos/profiles가 배열로 잡힐 수 있어서 단일·배열 모두 허용
  videos: { id: string; title: string; video_id: string } | { id: string; title: string; video_id: string }[] | null;
  profiles:
    | { full_name: string | null; email: string | null }
    | { full_name: string | null; email: string | null }[]
    | null;
}

const ASSIGN_CACHE_TTL_MS = 30 * 1000;
let assignPageCache: {
  students: Profile[];
  videos: Video[];
  assignments: AssignmentRow[];
  at: number;
} | null = null;

export default function AdminAssignPage() {
  const [mounted, setMounted] = useState(false);
  const [students, setStudents] = useState<Profile[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [selectedStudent, setSelectedStudent] = useState("");
  const [selectedVideo, setSelectedVideo] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  /** 학생별 진도 필터: 전체 | 완료 | 미완료 */
  const [progressFilterByStudent, setProgressFilterByStudent] = useState<Record<string, "all" | "completed" | "incomplete">>({});
  const [videoSearchTitle, setVideoSearchTitle] = useState("");

  async function load() {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const now = Date.now();
    if (assignPageCache && now - assignPageCache.at < ASSIGN_CACHE_TTL_MS) {
      setStudents(assignPageCache.students);
      setVideos(assignPageCache.videos);
      setAssignments(assignPageCache.assignments);
      setLoading(false);
    }
    const [profilesRes, videosRes, assignmentsRes] = await Promise.all([
      supabase.from("profiles").select("id, role, full_name, email").eq("role", "student").order("full_name"),
      supabase.from("videos").select("id, title, video_id").order("title"),
      supabase
        .from("assignments")
        .select("id, user_id, is_completed, progress_percent, last_position, last_watched_at, videos(id, title, video_id), profiles(full_name, email)")
        .order("created_at", { ascending: false }),
    ]);
    const nextStudents = (profilesRes.error ? [] : (profilesRes.data as Profile[]) ?? []);
    const nextVideos = (videosRes.error ? [] : (videosRes.data as Video[]) ?? []);
    const nextAssignments = (assignmentsRes.error ? [] : ((assignmentsRes.data ?? []) as unknown) as AssignmentRow[]);
    setStudents(nextStudents);
    setVideos(nextVideos);
    setAssignments(nextAssignments);
    setLoading(false);
    assignPageCache = { students: nextStudents, videos: nextVideos, assignments: nextAssignments, at: Date.now() };
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    load();
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

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!selectedStudent || !selectedVideo || !supabase) {
      setMessage({ type: "error", text: "학생과 영상을 선택해 주세요." });
      return;
    }
    setSubmitLoading(true);
    const { error } = await supabase.from("assignments").insert({
      user_id: selectedStudent,
      video_id: selectedVideo,
      is_completed: false,
      progress_percent: 0,
      last_position: 0,
      is_visible: true,
      is_weekly_assignment: false,
    });
    if (error) {
      if (error.code === "23505") {
        setMessage({ type: "error", text: "이미 해당 학생에게 배정된 영상입니다." });
      } else {
        setMessage({ type: "error", text: error.message });
      }
      setSubmitLoading(false);
      return;
    }
    setMessage({ type: "success", text: "배정되었습니다." });
    setSubmitLoading(false);
    load();
  }

  async function handleUnassign(id: string) {
    if (!supabase || !confirm("이 배정을 해제할까요?")) return;
    await supabase.from("assignments").delete().eq("id", id);
    load();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">
        학생 배정 · 진도 모니터링
      </h1>
      <p className="mb-8 text-slate-600 dark:text-slate-400">
        영상과 학생을 선택해 1:1로 배정하고, 진도와 완료 여부를 확인하세요.
      </p>

      <form onSubmit={handleAssign} className="mb-10 flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="min-w-[200px]">
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            영상 선택
          </label>
          <input
            type="text"
            value={videoSearchTitle}
            onChange={(e) => setVideoSearchTitle(e.target.value)}
            placeholder="제목으로 검색..."
            className="mb-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          />
          <select
            value={selectedVideo}
            onChange={(e) => setSelectedVideo(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            <option value="">영상 선택</option>
            {(videoSearchTitle.trim()
              ? videos.filter((v) => (v.title || "").toLowerCase().includes(videoSearchTitle.trim().toLowerCase()))
              : videos
            ).map((v) => (
              <option key={v.id} value={v.id}>
                {v.title}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px]">
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            학생 선택
          </label>
          <select
            value={selectedStudent}
            onChange={(e) => setSelectedStudent(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            <option value="">학생 선택</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name || s.email || s.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={submitLoading}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitLoading ? "배정 중..." : "배정하기"}
        </button>
        {message && (
          <span
            className={
              message.type === "error"
                ? "text-red-600 dark:text-red-400"
                : "text-green-600 dark:text-green-400"
            }
          >
            {message.text}
          </span>
        )}
      </form>

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
                  const first = list[0];
                  const profile = Array.isArray(first.profiles) ? first.profiles[0] : first.profiles;
                  const studentName = profile?.full_name || profile?.email || userId.slice(0, 8);
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
                        return (
                          <div className="border-t border-slate-100 bg-slate-50/50 dark:border-zinc-700 dark:bg-zinc-800/30">
                            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-zinc-700">
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
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="border-b border-slate-200 dark:border-zinc-700">
                                    <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">영상</th>
                                    <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">진도율</th>
                                    <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">마지막 시청</th>
                                    <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">완료</th>
                                    <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">관리</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredList.length === 0 ? (
                                    <tr>
                                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                                        {filter === "all" ? "배정된 영상이 없습니다." : filter === "completed" ? "완료된 영상이 없습니다." : "미완료 영상이 없습니다."}
                                      </td>
                                    </tr>
                                  ) : (
                                    filteredList.map((a) => {
                                      const video = Array.isArray(a.videos) ? a.videos[0] : a.videos;
                                      return (
                                        <tr key={a.id} className="border-b border-slate-100 last:border-0 dark:border-zinc-700/50">
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
