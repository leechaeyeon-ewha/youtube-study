"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Video } from "@/lib/types";
import type { Profile } from "@/lib/types";

interface AssignmentRow {
  id: string;
  user_id: string;
  is_completed: boolean;
  progress_percent: number;
  last_position: number;
  last_watched_at: string | null;
  videos: { id: string; title: string; video_id: string } | null;
  profiles: { full_name: string | null; email: string | null } | null;
}

export default function AdminAssignPage() {
  const [students, setStudents] = useState<Profile[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [selectedStudent, setSelectedStudent] = useState("");
  const [selectedVideo, setSelectedVideo] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function load() {
    if (!supabase) return;
    const [profilesRes, videosRes, assignmentsRes] = await Promise.all([
      supabase.from("profiles").select("id, role, full_name, email").eq("role", "student").order("full_name"),
      supabase.from("videos").select("id, title, video_id").order("title"),
      supabase
        .from("assignments")
        .select("id, user_id, is_completed, progress_percent, last_position, last_watched_at, videos(id, title, video_id), profiles(full_name, email)")
        .order("created_at", { ascending: false }),
    ]);
    if (!profilesRes.error) setStudents((profilesRes.data as Profile[]) ?? []);
    if (!videosRes.error) setVideos((videosRes.data as Video[]) ?? []);
    if (!assignmentsRes.error) setAssignments((assignmentsRes.data as AssignmentRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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
          <select
            value={selectedVideo}
            onChange={(e) => setSelectedVideo(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            <option value="">영상 선택</option>
            {videos.map((v) => (
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
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800/50">
                  <th className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">학생</th>
                  <th className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">영상</th>
                  <th className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">진도율</th>
                  <th className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">마지막 시청</th>
                  <th className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">완료</th>
                  <th className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">관리</th>
                </tr>
              </thead>
              <tbody>
                {assignments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                      배정된 학습이 없습니다.
                    </td>
                  </tr>
                ) : (
                  assignments.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-slate-100 dark:border-zinc-700/50 hover:bg-slate-50 dark:hover:bg-zinc-800/30"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-900 dark:text-white">
                          {a.profiles?.full_name || a.profiles?.email || a.user_id.slice(0, 8)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-slate-700 dark:text-slate-300">
                          {a.videos?.title ?? "-"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            a.is_completed
                              ? "font-medium text-green-600 dark:text-green-400"
                              : "text-slate-600 dark:text-slate-400"
                          }
                        >
                          {a.progress_percent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {a.last_watched_at
                          ? new Date(a.last_watched_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        {a.is_completed ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">
                            완료
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                            미완료
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleUnassign(a.id)}
                          className="text-red-600 hover:underline dark:text-red-400"
                        >
                          배정 해제
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
