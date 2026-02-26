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
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignStudentIds, setAssignStudentIds] = useState<string[]>([]);
  const [assignStudentSearch, setAssignStudentSearch] = useState("");
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

  async function handleAssignSubmit() {
    if (selectedVideoIds.length === 0 || assignStudentIds.length === 0) return;
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    setAssignLoading(true);
    setAssignMessage(null);
    try {
      let successCount = 0;
      const errors: string[] = [];
      for (const videoId of selectedVideoIds) {
        for (const studentId of assignStudentIds) {
          const res = await fetch("/api/teacher/assignments", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ student_id: studentId, video_id: videoId }),
          });
          const data = await res.json();
          if (res.ok) successCount += 1;
          else if (data?.error && !errors.includes(data.error)) errors.push(data.error);
        }
      }
      if (successCount > 0) {
        setAssignMessage({ type: "success", text: `선택한 ${selectedVideoIds.length}개 영상을 ${assignStudentIds.length}명에게 배정했습니다. (${successCount}건 추가)${errors.length > 0 ? ` 일부 실패: ${errors.join(", ")}` : ""}` });
        setSelectedVideoIds([]);
        setAssignStudentIds([]);
        setAssignStudentSearch("");
        setAssignModalOpen(false);
        setTimeout(() => setAssignMessage(null), 3000);
        load();
      } else {
        setAssignMessage({ type: "error", text: errors[0] || "배정에 실패했습니다." });
      }
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

  const displayedVideos =
    activeTab === "playlist"
      ? filteredPlaylistGroups.flatMap((g) => g.videos)
      : filteredStandaloneVideos;

  function toggleSelectAll() {
    if (displayedVideos.length === 0) return;
    const allSelected = displayedVideos.every((v) => selectedVideoIds.includes(v.id));
    if (allSelected) {
      const idsToUnselect = new Set(displayedVideos.map((v) => v.id));
      setSelectedVideoIds((prev) => prev.filter((id) => !idsToUnselect.has(id)));
    } else {
      setSelectedVideoIds((prev) => [...new Set([...prev, ...displayedVideos.map((v) => v.id)])]);
    }
  }

  function toggleSelectCourse(courseKey: string) {
    const group = filteredPlaylistGroups.find((g) => (g.courseId ?? "__none__") === courseKey);
    if (!group) return;
    const ids = group.videos.map((v) => v.id);
    const allSelected = ids.every((id) => selectedVideoIds.includes(id));
    if (allSelected) {
      setSelectedVideoIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedVideoIds((prev) => [...new Set([...prev, ...ids])]);
    }
  }

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

      {/* 재생목록 / 개별 영상 목록 (관리자 페이지와 동일하게 선택 후 할당) */}
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
        {displayedVideos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-6 py-3 dark:border-zinc-700">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={displayedVideos.length > 0 && displayedVideos.every((v) => selectedVideoIds.includes(v.id))}
                onChange={toggleSelectAll}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              전체 선택
            </label>
            {selectedVideoIds.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAssignMessage(null);
                  setAssignModalOpen(true);
                }}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                선택 항목 학생에게 할당
              </button>
            )}
          </div>
        )}
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
                const ids = g.videos.map((v) => v.id);
                const allInGroupSelected = ids.length > 0 && ids.every((id) => selectedVideoIds.includes(id));
                return (
                  <li key={courseKey}>
                    <div className="flex items-center gap-2 px-6 py-4">
                      <input
                        type="checkbox"
                        checked={allInGroupSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelectCourse(courseKey);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setExpandedPlaylistCourseKey(isExpanded ? null : courseKey)}
                        className="flex flex-1 items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-zinc-800/50 rounded px-2 -mx-2 py-1 -my-1"
                      >
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                          {g.courseTitle}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {g.videos.length}개 영상 · {isExpanded ? "접기" : "펼치기"}
                        </span>
                      </button>
                    </div>
                    {isExpanded && (
                      <ul className="space-y-1 border-t border-slate-100 bg-slate-50/50 px-6 py-3 dark:border-zinc-700 dark:bg-zinc-800/30">
                        {g.videos.map((v) => (
                          <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selectedVideoIds.includes(v.id)}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setSelectedVideoIds((prev) =>
                                    prev.includes(v.id) ? prev.filter((x) => x !== v.id) : [...prev, v.id]
                                  );
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              <a
                                href={`https://www.youtube.com/watch?v=${v.video_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-w-0 truncate text-sm text-indigo-600 hover:underline dark:text-indigo-400"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {v.title || v.video_id}
                              </a>
                            </label>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedVideoIds([v.id]);
                                setAssignStudentIds([]);
                                setAssignStudentSearch("");
                                setAssignMessage(null);
                                setAssignModalOpen(true);
                              }}
                              className="shrink-0 rounded-lg bg-indigo-100 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                            >
                              배정
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
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedVideoIds.includes(v.id)}
                      onChange={() =>
                        setSelectedVideoIds((prev) =>
                          prev.includes(v.id) ? prev.filter((x) => x !== v.id) : [...prev, v.id]
                        )
                      }
                      className="shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <a
                      href={`https://www.youtube.com/watch?v=${v.video_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {v.title || v.video_id}
                    </a>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedVideoIds([v.id]);
                      setAssignStudentIds([]);
                      setAssignStudentSearch("");
                      setAssignMessage(null);
                      setAssignModalOpen(true);
                    }}
                    className="rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                  >
                    배정
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </section>

      {/* 할당 모달 (선택한 영상을 담당 학생에게 할당) */}
      {assignModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setAssignModalOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
              선택한 영상을 담당 학생에게 할당
            </h3>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
              대상: {selectedVideoIds.length}개 영상
            </p>
            <div className="mb-4">
              <input
                type="text"
                value={assignStudentSearch}
                onChange={(e) => setAssignStudentSearch(e.target.value)}
                placeholder="학생 이름으로 검색..."
                className="mb-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-zinc-500"
              />
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-zinc-700">
                {(() => {
                  const q = assignStudentSearch.trim().toLowerCase();
                  const list = q ? students.filter((s) => (s.full_name ?? "").toLowerCase().includes(q)) : students;
                  return list.length === 0 ? (
                    <p className="py-2 text-center text-sm text-slate-500 dark:text-zinc-400">
                      {q ? "검색 결과가 없습니다." : "담당 학생이 없습니다."}
                    </p>
                  ) : (
                    list.map((s) => (
                      <label key={s.id} className="flex cursor-pointer items-center gap-2 py-1">
                        <input
                          type="checkbox"
                          checked={assignStudentIds.includes(s.id)}
                          onChange={() =>
                            setAssignStudentIds((prev) =>
                              prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]
                            )
                          }
                          className="rounded text-indigo-600"
                        />
                        <span className="text-sm">{s.full_name ?? s.email ?? s.id.slice(0, 8)}</span>
                      </label>
                    ))
                  );
                })()}
              </div>
              {assignStudentIds.length > 0 && (
                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                  선택한 학생: {assignStudentIds.length}명
                </p>
              )}
            </div>
            {assignMessage && (
              <p
                className={`mb-4 text-sm ${
                  assignMessage.type === "error"
                    ? "text-red-600 dark:text-red-400"
                    : "text-green-600 dark:text-green-400"
                }`}
              >
                {assignMessage.text}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAssignModalOpen(false)}
                className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 dark:bg-zinc-700 dark:text-slate-200"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleAssignSubmit}
                disabled={assignLoading || assignStudentIds.length === 0}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {assignLoading ? "처리 중..." : "할당"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
