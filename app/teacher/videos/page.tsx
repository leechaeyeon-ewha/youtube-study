"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { extractYoutubeVideoId } from "@/lib/youtube";
import LoadingSpinner from "@/components/LoadingSpinner";

interface VideoRow {
  id: string;
  title: string;
  video_id: string;
  course_id: string | null;
  courses?: { id: string; title: string } | null;
}

interface StudentRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface CourseGroup {
  courseId: string | null;
  courseTitle: string;
  videos: VideoRow[];
}

export default function TeacherVideosPage() {
  const [mounted, setMounted] = useState(false);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistCourseTitle, setPlaylistCourseTitle] = useState("");
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistMessage, setPlaylistMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [assignVideoId, setAssignVideoId] = useState<string | null>(null);
  const [assignStudentId, setAssignStudentId] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignMessage, setAssignMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [searchTitle, setSearchTitle] = useState("");
  const [activeTab, setActiveTab] = useState<"playlist" | "single">("playlist");
  /** 재생목록 탭에서 펼친 재생목록: courseId (접히면 null) */
  const [expandedPlaylistCourseKey, setExpandedPlaylistCourseKey] = useState<string | null>(null);

  async function load() {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const h: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
    const [videosRes, studentsRes] = await Promise.all([
      fetch("/api/teacher/videos", { headers: h, cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/teacher/students", { headers: h, cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    ]);
    setVideos(Array.isArray(videosRes) ? videosRes : []);
    setStudents(Array.isArray(studentsRes) ? studentsRes : []);
    setLoading(false);
  }

  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    load();
  }, []);

  // 재생목록/개별 영상 그룹핑 (관리자 페이지와 동일한 구조를 간소화해서 사용)
  const allVideos = videos;
  const playlistGroups: CourseGroup[] = (() => {
    const byCourse = new Map<string, VideoRow[]>();
    for (const v of allVideos) {
      const cid = v.course_id ?? "__none__";
      if (!byCourse.has(cid)) byCourse.set(cid, []);
      byCourse.get(cid)!.push(v);
    }
    const groups: CourseGroup[] = [];
    byCourse.forEach((vs, courseId) => {
      if (courseId === "__none__") return;
      const title = vs[0]?.courses?.title ?? "기타 영상";
      groups.push({ courseId, courseTitle: title, videos: vs });
    });
    return groups;
  })();
  const standaloneVideos = allVideos.filter((v) => !v.course_id);

  async function handleAddVideo(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const videoId = extractYoutubeVideoId(urlInput);
    if (!videoId) {
      setMessage({ type: "error", text: "유효한 YouTube URL을 입력해 주세요." });
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
        if (res.ok && data.title) title = data.title as string;
      } catch {
        // ignore
      }
    }
    if (!title) title = `영상 ${videoId}`;

    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    setSubmitLoading(true);
    try {
      const res = await fetch("/api/teacher/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ url: urlInput, video_id: videoId, title }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "등록에 실패했습니다." });
        return;
      }
      setMessage({ type: "success", text: "영상이 등록되었습니다." });
      setUrlInput("");
      setTitleInput("");
      await load();
    } finally {
      setSubmitLoading(false);
    }
  }

  async function handleImportPlaylist(e: React.FormEvent) {
    e.preventDefault();
    setPlaylistMessage(null);
    if (!playlistUrl.trim()) {
      setPlaylistMessage({ type: "error", text: "재생목록 URL을 입력해 주세요." });
      return;
    }
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    setPlaylistLoading(true);
    try {
      const res = await fetch("/api/teacher/import-playlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          playlist_url: playlistUrl.trim(),
          course_title: playlistCourseTitle.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPlaylistMessage({ type: "error", text: data.error || "재생목록 등록에 실패했습니다." });
        return;
      }
      setPlaylistMessage({
        type: "success",
        text: `${data.courseTitle ?? "재생목록"}이(가) 등록되었습니다. (새 영상 ${data.added}개, 기존 ${data.skipped}개)`,
      });
      setPlaylistUrl("");
      setPlaylistCourseTitle("");
      await load();
    } finally {
      setPlaylistLoading(false);
    }
  }

  async function handleAssign() {
    if (!assignVideoId || !assignStudentId) return;
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    setAssignLoading(true);
    setAssignMessage(null);
    try {
      const res = await fetch("/api/teacher/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ student_id: assignStudentId, video_id: assignVideoId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAssignMessage({ type: "error", text: data.error || "배정에 실패했습니다." });
        return;
      }
      setAssignMessage({ type: "success", text: "배정되었습니다." });
      setAssignStudentId("");
      setTimeout(() => {
        setAssignVideoId(null);
        setAssignMessage(null);
      }, 1500);
    } finally {
      setAssignLoading(false);
    }
  }

  if (!mounted) return null;
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  const searchLower = searchTitle.trim().toLowerCase();
  const filteredPlaylistGroups = playlistGroups
    .map((g) => ({
      ...g,
      videos: searchLower
        ? g.videos.filter((v) => (v.title || "").toLowerCase().includes(searchLower))
        : g.videos,
    }))
    .filter((g) => g.videos.length > 0);
  const filteredStandaloneVideos = searchLower
    ? standaloneVideos.filter((v) => (v.title || "").toLowerCase().includes(searchLower))
    : standaloneVideos;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
        영상 관리
      </h1>
      <p className="text-slate-600 dark:text-slate-400">
        새 영상 등록과 담당 학생에게 배정만 가능합니다. 기존 영상 삭제는 할 수 없습니다.
      </p>

      {/* 재생목록 등록 (관리자와 유사) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">재생목록 등록</h2>
        <form onSubmit={handleImportPlaylist} className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">YouTube 재생목록 URL</label>
            <input
              type="text"
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              placeholder="https://www.youtube.com/playlist?list=..."
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div className="min-w-[200px]">
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">반/재생목록 이름 (선택)</label>
            <input
              type="text"
              value={playlistCourseTitle}
              onChange={(e) => setPlaylistCourseTitle(e.target.value)}
              placeholder="비우면 YouTube 제목 사용"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={playlistLoading}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {playlistLoading ? "등록 중..." : "재생목록 등록"}
          </button>
          {playlistMessage && (
            <span className={playlistMessage.type === "error" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
              {playlistMessage.text}
            </span>
          )}
        </form>
      </section>

      {/* 단일 영상 등록 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">새 영상 등록</h2>
        <form onSubmit={handleAddVideo} className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px]">
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">YouTube URL</label>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">제목 (선택)</label>
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="비우면 자동 조회"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={submitLoading}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitLoading ? "등록 중..." : "영상 등록"}
          </button>
          {message && (
            <span className={message.type === "error" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
              {message.text}
            </span>
          )}
        </form>
      </section>

      {/* 재생목록 / 개별 영상 목록 (관리자 페이지 구조와 유사) */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-zinc-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-white">영상 목록 (배정만 가능, 삭제 불가)</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("playlist")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                activeTab === "playlist"
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
              }`}
            >
              재생목록
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("single")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                activeTab === "single"
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
              }`}
            >
              개별 영상
            </button>
          </div>
          <input
            type="text"
            value={searchTitle}
            onChange={(e) => setSearchTitle(e.target.value)}
            placeholder="제목 검색"
            className="min-w-[140px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          />
        </div>
        {activeTab === "playlist" ? (
          <ul className="divide-y divide-slate-100 dark:divide-zinc-700">
            {filteredPlaylistGroups.length === 0 ? (
              <li className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                {searchTitle.trim() ? "검색 결과가 없습니다." : "등록된 재생목록이 없습니다."}
              </li>
            ) : (
              filteredPlaylistGroups.map((g) => {
                const courseKey = g.courseId ?? "__none__";
                const isExpanded = expandedPlaylistCourseKey === courseKey;
                return (
                  <li key={courseKey}>
                    <button
                      type="button"
                      onClick={() => setExpandedPlaylistCourseKey(isExpanded ? null : courseKey)}
                      className="flex w-full items-center justify-between gap-2 px-6 py-4 text-left hover:bg-slate-50 dark:hover:bg-zinc-800/50"
                    >
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {g.courseTitle}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {g.videos.length}개 영상 · {isExpanded ? "접기" : "펼치기"}
                      </span>
                    </button>
                    {isExpanded && (
                      <ul className="space-y-1 border-t border-slate-100 bg-slate-50/50 px-6 py-3 dark:border-zinc-700 dark:bg-zinc-800/30">
                        {g.videos.map((v) => (
                          <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                            <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">
                              {v.title || v.video_id}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAssignVideoId(assignVideoId === v.id ? null : v.id);
                                setAssignStudentId("");
                                setAssignMessage(null);
                              }}
                              className="shrink-0 rounded-lg bg-indigo-100 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                            >
                              {assignVideoId === v.id ? "취소" : "배정"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-zinc-700">
            {filteredStandaloneVideos.length === 0 ? (
              <li className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                {searchTitle.trim() ? "검색 결과가 없습니다." : "등록된 개별 영상이 없습니다."}
              </li>
            ) : (
              filteredStandaloneVideos.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                  <span className="font-medium text-slate-900 dark:text-white">{v.title || v.video_id}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAssignVideoId(assignVideoId === v.id ? null : v.id);
                      setAssignStudentId("");
                      setAssignMessage(null);
                    }}
                    className="rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                  >
                    {assignVideoId === v.id ? "취소" : "배정"}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
        {assignVideoId && (
          <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">담당 학생에게 배정할 학생 선택</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={assignStudentId}
                onChange={(e) => setAssignStudentId(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              >
                <option value="">선택</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name || s.email || s.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAssign}
                disabled={assignLoading || !assignStudentId}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {assignLoading ? "처리 중..." : "배정하기"}
              </button>
              {assignMessage && (
                <span className={assignMessage.type === "error" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                  {assignMessage.text}
                </span>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
