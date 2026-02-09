"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { extractYoutubeVideoId, getThumbnailUrl } from "@/lib/youtube";
import type { Video } from "@/lib/types";

export default function AdminVideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function loadVideos() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("videos")
      .select("id, title, video_id, created_at")
      .order("created_at", { ascending: false });
    if (!error) setVideos((data as Video[]) ?? []);
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
    const title = titleInput.trim() || `영상 ${videoId}`;
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

  async function handleDelete(id: string) {
    if (!supabase || !confirm("이 영상을 삭제할까요? 배정된 학습도 함께 영향을 받을 수 있습니다.")) return;
    await supabase.from("videos").delete().eq("id", id);
    loadVideos();
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">
        영상 관리
      </h1>
      <p className="mb-8 text-slate-600 dark:text-slate-400">
        YouTube URL을 붙여넣으면 자동으로 영상 ID를 추출해 등록합니다.
      </p>

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
        <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">
          등록된 영상 목록
        </h2>
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
                <div className="aspect-video w-full shrink-0 overflow-hidden bg-slate-200 dark:bg-zinc-800">
                  <img
                    src={getThumbnailUrl(v.video_id)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex flex-1 flex-col p-4">
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
