"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { extractYoutubeVideoId } from "@/lib/youtube";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface AssignmentWithVideo {
  id: string;
  user_id: string;
  is_completed: boolean;
  progress_percent: number;
  last_position: number;
  last_watched_at: string | null;
  videos: { id: string; title: string; video_id: string } | null;
}

export default function AdminDashboardPage() {
  const [students, setStudents] = useState<Profile[]>([]);
  const [assignmentsByUser, setAssignmentsByUser] = useState<Record<string, AssignmentWithVideo[]>>({});
  const [loading, setLoading] = useState(true);
  const [addFullName, setAddFullName] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addMessage, setAddMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [assignUserId, setAssignUserId] = useState<string | null>(null);
  const [assignUrl, setAssignUrl] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignMessage, setAssignMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function load() {
    if (!supabase) return;
    const [profilesRes, assignmentsRes] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email").eq("role", "student").order("full_name"),
      supabase
        .from("assignments")
        .select("id, user_id, is_completed, progress_percent, last_position, last_watched_at, videos(id, title, video_id)")
        .order("last_watched_at", { ascending: false }),
    ]);

    if (!profilesRes.error) setStudents((profilesRes.data as Profile[]) ?? []);
    if (!assignmentsRes.error) {
      const list = (assignmentsRes.data as AssignmentWithVideo[]) ?? [];
      const byUser: Record<string, AssignmentWithVideo[]> = {};
      list.forEach((a) => {
        if (!byUser[a.user_id]) byUser[a.user_id] = [];
        byUser[a.user_id].push(a);
      });
      setAssignmentsByUser(byUser);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAddStudent(e: React.FormEvent) {
    e.preventDefault();
    setAddMessage(null);
    if (!addFullName.trim()) {
      setAddMessage({ type: "error", text: "이름을 입력해 주세요." });
      return;
    }
    if (!addPassword || addPassword.length < 4) {
      setAddMessage({ type: "error", text: "비밀번호는 4자 이상 입력해 주세요." });
      return;
    }
    setAddLoading(true);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const res = await fetch("/api/admin/students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : "",
        },
        body: JSON.stringify({ full_name: addFullName.trim(), password: addPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "등록 실패");
      setAddMessage({ type: "success", text: `${addFullName.trim()} 학생이 등록되었습니다.` });
      setAddFullName("");
      setAddPassword("");
      load();
    } catch (err: unknown) {
      setAddMessage({
        type: "error",
        text: err instanceof Error ? err.message : "등록에 실패했습니다.",
      });
    } finally {
      setAddLoading(false);
    }
  }

  async function handleAssignVideo(e: React.FormEvent) {
    e.preventDefault();
    if (!assignUserId || !assignUrl.trim() || !supabase) return;
    setAssignMessage(null);
    const videoId = extractYoutubeVideoId(assignUrl);
    if (!videoId) {
      setAssignMessage({ type: "error", text: "유효한 YouTube URL을 입력해 주세요." });
      return;
    }
    setAssignLoading(true);
    try {
      const { data: existing } = await supabase.from("videos").select("id").eq("video_id", videoId).maybeSingle();
      let videoDbId: string;
      if (existing?.id) {
        videoDbId = existing.id;
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from("videos")
          .insert({ title: `영상 ${videoId}`, video_id: videoId })
          .select("id")
          .single();
        if (insertErr || !inserted?.id) throw new Error(insertErr?.message ?? "영상 등록 실패");
        videoDbId = inserted.id;
      }
      const { error } = await supabase.from("assignments").insert({
        user_id: assignUserId,
        video_id: videoDbId,
        is_completed: false,
        progress_percent: 0,
        last_position: 0,
      });
      if (error) {
        if (error.code === "23505") throw new Error("이미 해당 학생에게 배정된 영상입니다.");
        throw new Error(error.message);
      }
      setAssignMessage({ type: "success", text: "영상이 할당되었습니다." });
      setAssignUrl("");
      setAssignUserId(null);
      load();
    } catch (err: unknown) {
      setAssignMessage({
        type: "error",
        text: err instanceof Error ? err.message : "할당에 실패했습니다.",
      });
    } finally {
      setAssignLoading(false);
    }
  }

  function formatLastWatched(at: string | null) {
    if (!at) return "-";
    const d = new Date(at);
    return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
        학생 목록 · 영상 할당 · 모니터링
      </h1>

      {/* 학생 등록 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">
          학생 등록
        </h2>
        <form onSubmit={handleAddStudent} className="flex flex-wrap items-end gap-4">
          <div className="min-w-[160px]">
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              이름
            </label>
            <input
              type="text"
              value={addFullName}
              onChange={(e) => setAddFullName(e.target.value)}
              placeholder="홍길동"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              비밀번호 (학생 로그인용)
            </label>
            <input
              type="password"
              value={addPassword}
              onChange={(e) => setAddPassword(e.target.value)}
              placeholder="4자 이상"
              minLength={4}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={addLoading}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {addLoading ? "등록 중..." : "학생 등록"}
          </button>
          {addMessage && (
            <span className={addMessage.type === "error" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
              {addMessage.text}
            </span>
          )}
        </form>
      </section>

      {/* 학생 목록 + 영상 할당 + 모니터링 */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="border-b border-slate-200 px-6 py-4 text-lg font-semibold text-slate-800 dark:border-zinc-700 dark:text-white">
          학생 목록
        </h2>
        <div className="divide-y divide-slate-100 dark:divide-zinc-700">
          {students.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
              등록된 학생이 없습니다. 위에서 학생을 등록해 주세요.
            </div>
          ) : (
            students.map((s) => (
              <div key={s.id} className="px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {s.full_name || s.email || s.id.slice(0, 8)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAssignUserId(assignUserId === s.id ? null : s.id);
                        setAssignUrl("");
                        setAssignMessage(null);
                      }}
                      className="ml-3 rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                    >
                      {assignUserId === s.id ? "취소" : "영상 할당"}
                    </button>
                  </div>
                </div>

                {assignUserId === s.id && (
                  <form onSubmit={handleAssignVideo} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-4 dark:bg-zinc-800">
                    <div className="min-w-[280px] flex-1">
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                        YouTube URL
                      </label>
                      <input
                        type="url"
                        value={assignUrl}
                        onChange={(e) => setAssignUrl(e.target.value)}
                        placeholder="https://www.youtube.com/watch?v=..."
                        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={assignLoading}
                      className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {assignLoading ? "저장 중..." : "저장"}
                    </button>
                    {assignMessage && (
                      <span className={assignMessage.type === "error" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                        {assignMessage.text}
                      </span>
                    )}
                  </form>
                )}

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[400px] text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 dark:text-slate-400">
                        <th className="pb-2 pr-4">영상</th>
                        <th className="pb-2 pr-4">진도율</th>
                        <th className="pb-2">마지막 시청</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(assignmentsByUser[s.id] ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-3 text-slate-500 dark:text-slate-400">
                            할당된 영상 없음
                          </td>
                        </tr>
                      ) : (
                        (assignmentsByUser[s.id] ?? []).map((a) => (
                          <tr key={a.id} className="border-t border-slate-100 dark:border-zinc-700/50">
                            <td className="py-2 pr-4 font-medium text-slate-800 dark:text-slate-200">
                              {a.videos?.title ?? "-"}
                            </td>
                            <td className="py-2 pr-4">
                              <span className={a.is_completed ? "text-green-600 dark:text-green-400" : "text-slate-600 dark:text-slate-400"}>
                                {a.progress_percent.toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-2 text-slate-600 dark:text-slate-400">
                              {formatLastWatched(a.last_watched_at)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
