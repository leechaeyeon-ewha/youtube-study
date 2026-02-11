"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { extractYoutubeVideoId, getThumbnailUrl } from "@/lib/youtube";
import type { Video } from "@/lib/types";

interface VideoWithCourse extends Video {
  courses: { id: string; title: string } | null;
  is_visible?: boolean;
  is_weekly_assignment?: boolean;
}

export default function AdminVideosPage() {
  const [videos, setVideos] = useState<VideoWithCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistCourseTitle, setPlaylistCourseTitle] = useState("");
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistMessage, setPlaylistMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function loadVideos() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("videos")
      .select("id, title, video_id, course_id, is_visible, is_weekly_assignment, created_at, courses(id, title)")
      .order("created_at", { ascending: false });
    if (!error) {
      const list = (data ?? []) as VideoWithCourse[];
      setVideos(list.map((row) => ({
        ...row,
        courses: Array.isArray(row.courses) ? row.courses[0] ?? null : row.courses ?? null,
      })));
    }
    setLoading(false);
  }

  useEffect(() => {
    loadVideos();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const videoId = extractYoutubeVideoId(urlInput);
    if (!videoId) {
      setMessage({ type: "error", text: "유효한 YouTube URL을 입력해 주세요. (watch?v=, youtu.be/, embed/ 지원)" });
      return;
    }
    let title = titleInput.trim();
    if (!title) {
      try {
        const res = await fetch("/api/youtube-title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: urlInput }),
        });
        const data = await res.json();
        if (res.ok && data.title) {
          title = data.title as string;
        } else {
          title = `영상 ${videoId}`;
        }
      } catch {
        title = `영상 ${videoId}`;
      }
    }
    if (!supabase) return;
    setSubmitLoading(true);
    const { error } = await supabase.from("videos").insert({ title, video_id: videoId });
    if (error) {
      if (error.code === "23505") {
        setMessage({ type: "error", text: "이미 등록된 영상입니다." });
      } else {
        setMessage({ type: "error", text: error.message });
      }
      setSubmitLoading(false);
      return;
    }
    setMessage({ type: "success", text: "영상이 등록되었습니다." });
    setUrlInput("");
    setTitleInput("");
    setSubmitLoading(false);
    loadVideos();
  }

  async function handleImportPlaylist(e: React.FormEvent) {
    e.preventDefault();
    setPlaylistMessage(null);
    if (!playlistUrl.trim()) {
      setPlaylistMessage({ type: "error", text: "재생목록 URL을 입력해 주세요." });
      return;
    }
    setPlaylistLoading(true);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const res = await fetch("/api/admin/import-playlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : "",
        },
        body: JSON.stringify({
          playlist_url: playlistUrl.trim(),
          course_title: playlistCourseTitle.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "재생목록 등록 실패");
      setPlaylistMessage({
        type: "success",
        text: `강좌 "${data.courseTitle}" 생성 완료. 새로 등록 ${data.added}개, 기존 영상 연결 ${data.skipped}개 (총 ${data.total}개)`,
      });
      setPlaylistUrl("");
      setPlaylistCourseTitle("");
      loadVideos();
    } catch (err: unknown) {
      setPlaylistMessage({
        type: "error",
        text: err instanceof Error ? err.message : "재생목록 등록에 실패했습니다.",
      });
    } finally {
      setPlaylistLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!supabase || !confirm("이 영상을 삭제할까요? 배정된 학습도 함께 영향을 받을 수 있습니다.")) return;
    await supabase.from("videos").delete().eq("id", id);
    loadVideos();
  }

  function toggleSelectVideo(id: string) {
    setSelectedVideoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleSelectAll() {
    if (selectedVideoIds.length === videos.length) {
      setSelectedVideoIds([]);
    } else {
      setSelectedVideoIds(videos.map((v) => v.id));
    }
  }

  async function handleBulkVisible() {
    if (!supabase || selectedVideoIds.length === 0) return;
    setBulkLoading(true);
    setBulkMessage(null);
    try {
      for (const id of selectedVideoIds) {
        const v = videos.find((x) => x.id === id);
        const nextVisible = v?.is_visible === false;
        await supabase.from("videos").update({ is_visible: nextVisible }).eq("id", id);
      }
      setBulkMessage({ type: "success", text: `${selectedVideoIds.length}개 영상 노출/비노출 전환되었습니다.` });
      setSelectedVideoIds([]);
      loadVideos();
    } catch (err) {
      setBulkMessage({ type: "error", text: err instanceof Error ? err.message : "처리 실패" });
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleBulkWeekly(assign: boolean) {
    if (!supabase || selectedVideoIds.length === 0) return;
    setBulkLoading(true);
    setBulkMessage(null);
    try {
      for (const id of selectedVideoIds) {
        await supabase.from("videos").update({ is_weekly_assignment: assign }).eq("id", id);
      }
      setBulkMessage({ type: "success", text: `${selectedVideoIds.length}개 영상 주간 과제 ${assign ? "지정" : "해제"}되었습니다.` });
      setSelectedVideoIds([]);
      loadVideos();
    } catch (err) {
      setBulkMessage({ type: "error", text: err instanceof Error ? err.message : "처리 실패" });
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">
        영상 관리
      </h1>
      <p className="mb-8 text-slate-600 dark:text-slate-400">
        YouTube URL을 붙여넣으면 자동으로 영상 ID를 추출해 등록합니다. 재생목록 URL로 강좌 단위로 한 번에 등록할 수 있습니다.
      </p>

      {/* YouTube 재생목록으로 한 번에 등록 */}
      <section className="mb-10 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6 shadow-sm dark:border-emerald-800 dark:bg-emerald-900/20">
        <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-white">
          YouTube 재생목록으로 한 번에 등록
        </h2>
        <form onSubmit={handleImportPlaylist} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              재생목록 URL
            </label>
            <input
              type="url"
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              placeholder="https://www.youtube.com/playlist?list=PL... 또는 영상 URL에 list= 포함"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-zinc-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              강좌 이름 (선택, 비우면 재생목록 제목 사용)
            </label>
            <input
              type="text"
              value={playlistCourseTitle}
              onChange={(e) => setPlaylistCourseTitle(e.target.value)}
              placeholder="예: 천일문 기본 Day 1~10"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-zinc-500"
            />
          </div>
          {playlistMessage && (
            <div
              className={`rounded-lg px-4 py-3 text-sm ${
                playlistMessage.type === "error"
                  ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                  : "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
              }`}
            >
              {playlistMessage.text}
            </div>
          )}
          <button
            type="submit"
            disabled={playlistLoading}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {playlistLoading ? "가져오는 중..." : "재생목록 가져와서 강좌로 등록"}
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          YouTube Data API 키(YOUTUBE_API_KEY)가 .env.local에 있어야 합니다. 없으면 설정 안내가 표시됩니다.
        </p>
      </section>

      <form onSubmit={handleAdd} className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
          YouTube URL
        </label>
        <input
          type="url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=... 또는 https://youtu.be/..."
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-zinc-500"
        />
        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
          제목 (선택, 비우면 자동)
        </label>
        <input
          type="text"
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          placeholder="예: 1강 - 오리엔테이션"
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-zinc-500"
        />
        {message && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              message.type === "error"
                ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                : "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
            }`}
          >
            {message.text}
          </div>
        )}
        <button
          type="submit"
          disabled={submitLoading}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitLoading ? "등록 중..." : "영상 등록"}
        </button>
      </form>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-white">
            등록된 영상 목록
          </h2>
          {videos.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={selectedVideoIds.length === videos.length && videos.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                전체 선택
              </label>
              {selectedVideoIds.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handleBulkVisible}
                    disabled={bulkLoading}
                    className="rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-300 disabled:opacity-50 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
                  >
                    선택 항목 노출/비노출 전환
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkWeekly(true)}
                    disabled={bulkLoading}
                    className="rounded-lg bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
                  >
                    선택 항목 주간 과제 지정
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkWeekly(false)}
                    disabled={bulkLoading}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-zinc-700 dark:text-slate-300 dark:hover:bg-zinc-600"
                  >
                    선택 항목 주간 과제 해제
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {bulkMessage && (
          <p className={`mb-4 text-sm ${bulkMessage.type === "error" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
            {bulkMessage.text}
          </p>
        )}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : videos.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-slate-400">
            등록된 영상이 없습니다. 위 폼에서 URL을 입력해 등록하세요.
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((v) => (
              <li
                key={v.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start gap-2 p-2">
                  <input
                    type="checkbox"
                    checked={selectedVideoIds.includes(v.id)}
                    onChange={() => toggleSelectVideo(v.id)}
                    className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </div>
                <div className="aspect-video w-full shrink-0 overflow-hidden bg-slate-200 dark:bg-zinc-800">
                  <img
                    src={getThumbnailUrl(v.video_id)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-1 flex flex-wrap gap-1">
                    {v.courses?.title && (
                      <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                        {v.courses.title}
                      </span>
                    )}
                    {v.is_visible === false && (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        비노출
                      </span>
                    )}
                    {v.is_weekly_assignment && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        주간 과제
                      </span>
                    )}
                  </div>
                  <h3 className="font-medium text-slate-900 dark:text-white line-clamp-2">
                    {v.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {v.video_id}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleDelete(v.id)}
                    className="mt-3 self-start rounded-lg bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
