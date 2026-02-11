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

interface CourseGroup {
  courseId: string | null;
  courseTitle: string;
  videos: VideoWithCourse[];
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  class_id: string | null;
}

interface ClassRow {
  id: string;
  title: string;
}

export default function AdminVideosPage() {
  const [courseGroups, setCourseGroups] = useState<CourseGroup[]>([]);
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
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [students, setStudents] = useState<Profile[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [assignTarget, setAssignTarget] = useState<"student" | "class">("class");
  const [assignStudentIds, setAssignStudentIds] = useState<string[]>([]);
  const [assignClassId, setAssignClassId] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignMessage, setAssignMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const [settingsTarget, setSettingsTarget] = useState<"all" | "class" | "student">("all");
  const [settingsClassId, setSettingsClassId] = useState("");
  const [settingsStudentIds, setSettingsStudentIds] = useState<string[]>([]);
  const [settingsVisible, setSettingsVisible] = useState<boolean | null>(null);
  const [settingsWeekly, setSettingsWeekly] = useState<boolean | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const [bulkMessage, setBulkMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function loadVideos() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("videos")
      .select("id, title, video_id, course_id, is_visible, is_weekly_assignment, created_at, courses(id, title)")
      .order("created_at", { ascending: false });
    if (!error && data) {
      const list = data as VideoWithCourse[];
      const normalized = list.map((row) => ({
        ...row,
        courses: Array.isArray(row.courses) ? row.courses[0] ?? null : row.courses ?? null,
      }));
      const byCourse = new Map<string | null, VideoWithCourse[]>();
      for (const v of normalized) {
        const cid = v.course_id ?? null;
        const title = v.courses?.title ?? "(강좌 없음)";
        if (!byCourse.has(cid)) byCourse.set(cid, []);
        byCourse.get(cid)!.push(v);
      }
      const groups: CourseGroup[] = [];
      byCourse.forEach((videos, courseId) => {
        const courseTitle = videos[0]?.courses?.title ?? "기타 영상";
        groups.push({ courseId, courseTitle, videos });
      });
      groups.sort((a, b) => {
        if (a.courseId == null) return 1;
        if (b.courseId == null) return -1;
        return a.courseTitle.localeCompare(b.courseTitle);
      });
      setCourseGroups(groups);
    }
    setLoading(false);
  }

  async function loadStudentsAndClasses() {
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    const authHeaders: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
    const [studentsRes, classesRes] = await Promise.all([
      fetch("/api/admin/students", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
      supabase.from("classes").select("id, title").order("title"),
    ]);
    setStudents(Array.isArray(studentsRes) ? studentsRes : []);
    if (!classesRes.error && classesRes.data) setClasses(classesRes.data as ClassRow[]);
  }

  useEffect(() => {
    loadVideos();
  }, []);

  useEffect(() => {
    if (assignModalOpen || settingsModalOpen) loadStudentsAndClasses();
  }, [assignModalOpen, settingsModalOpen]);

  const allVideos = courseGroups.flatMap((g) => g.videos);

  async function handleAdd(e: React.FormEvent) {
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
        const res = await fetch("/api/youtube-title", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: urlInput }) });
        const data = await res.json();
        if (res.ok && data.title) title = data.title as string;
        else title = `영상 ${videoId}`;
      } catch {
        title = `영상 ${videoId}`;
      }
    }
    if (!supabase) return;
    setSubmitLoading(true);
    const { error } = await supabase.from("videos").insert({ title, video_id: videoId });
    if (error) {
      setMessage({ type: "error", text: error.code === "23505" ? "이미 등록된 영상입니다." : error.message });
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
        headers: { "Content-Type": "application/json", Authorization: session?.access_token ? `Bearer ${session.access_token}` : "" },
        body: JSON.stringify({ playlist_url: playlistUrl.trim(), course_title: playlistCourseTitle.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "재생목록 등록 실패");
      setPlaylistMessage({ type: "success", text: `강좌 "${data.courseTitle}" 생성 완료. 새로 등록 ${data.added}개, 기존 영상 연결 ${data.skipped}개 (총 ${data.total}개)` });
      setPlaylistUrl("");
      setPlaylistCourseTitle("");
      loadVideos();
    } catch (err: unknown) {
      setPlaylistMessage({ type: "error", text: err instanceof Error ? err.message : "재생목록 등록에 실패했습니다." });
    } finally {
      setPlaylistLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!supabase || !confirm("이 영상을 삭제할까요? 배정된 학습도 함께 영향을 받을 수 있습니다.")) return;
    await supabase.from("videos").delete().eq("id", id);
    setSelectedVideoIds((prev) => prev.filter((x) => x !== id));
    loadVideos();
  }

  async function handleBulkDelete() {
    if (!supabase || selectedVideoIds.length === 0) return;
    if (!confirm(`선택한 ${selectedVideoIds.length}개 영상을 삭제할까요?\n배정된 학습 기록도 함께 삭제되며, 복구할 수 없습니다.`)) return;
    setDeleteLoading(true);
    setBulkMessage(null);
    try {
      const { error } = await supabase.from("videos").delete().in("id", selectedVideoIds);
      if (error) throw error;
      setBulkMessage({ type: "success", text: `선택한 ${selectedVideoIds.length}개 영상이 삭제되었습니다.` });
      setSelectedVideoIds([]);
      loadVideos();
    } catch (err) {
      setBulkMessage({ type: "error", text: err instanceof Error ? err.message : "삭제에 실패했습니다." });
    } finally {
      setDeleteLoading(false);
    }
  }

  function toggleSelectVideo(id: string) {
    setSelectedVideoIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectCourse(courseId: string | null) {
    const group = courseGroups.find((g) => g.courseId === courseId);
    if (!group) return;
    const ids = group.videos.map((v) => v.id);
    const allSelected = ids.every((id) => selectedVideoIds.includes(id));
    if (allSelected) {
      setSelectedVideoIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedVideoIds((prev) => [...new Set([...prev, ...ids])]);
    }
  }

  function toggleSelectAll() {
    if (selectedVideoIds.length === allVideos.length) {
      setSelectedVideoIds([]);
    } else {
      setSelectedVideoIds(allVideos.map((v) => v.id));
    }
  }

  async function handleAssignSubmit() {
    if (!supabase || selectedVideoIds.length === 0) return;
    let userIds: string[] = [];
    if (assignTarget === "class") {
      if (!assignClassId) {
        setAssignMessage({ type: "error", text: "반을 선택해 주세요." });
        return;
      }
      userIds = students.filter((s) => s.class_id === assignClassId).map((s) => s.id);
    } else {
      userIds = assignStudentIds;
    }
    if (userIds.length === 0) {
      setAssignMessage({ type: "error", text: "대상 학생이 없습니다." });
      return;
    }
    setAssignLoading(true);
    setAssignMessage(null);
    try {
      let added = 0;
      for (const videoId of selectedVideoIds) {
        for (const userId of userIds) {
          const { error } = await supabase.from("assignments").insert({
            user_id: userId,
            video_id: videoId,
            is_completed: false,
            progress_percent: 0,
            last_position: 0,
            is_visible: true,
            is_weekly_assignment: false,
          });
          if (!error) added += 1;
        }
      }
      setAssignMessage({ type: "success", text: `선택한 ${selectedVideoIds.length}개 영상을 ${userIds.length}명에게 할당했습니다. (중복 제외 ${added}건 추가)` });
      setSelectedVideoIds([]);
      setAssignModalOpen(false);
      setAssignClassId("");
      setAssignStudentIds([]);
      loadVideos();
    } catch (err) {
      setAssignMessage({ type: "error", text: err instanceof Error ? err.message : "할당 실패" });
    } finally {
      setAssignLoading(false);
    }
  }

  async function handleSettingsSubmit() {
    if (!supabase || selectedVideoIds.length === 0) return;
    if (settingsVisible === null && settingsWeekly === null) {
      setSettingsMessage({ type: "error", text: "노출 또는 주간 과제 중 하나 이상을 선택해 주세요." });
      return;
    }
    let userIds: string[] = [];
    if (settingsTarget === "all") {
      const { data } = await supabase.from("assignments").select("user_id").in("video_id", selectedVideoIds);
      const rows = (data ?? []) as { user_id: string }[];
      userIds = [...new Set(rows.map((a) => a.user_id))];
    } else if (settingsTarget === "class") {
      if (!settingsClassId) {
        setSettingsMessage({ type: "error", text: "반을 선택해 주세요." });
        return;
      }
      userIds = students.filter((s) => s.class_id === settingsClassId).map((s) => s.id);
    } else {
      userIds = settingsStudentIds;
    }
    if (userIds.length === 0) {
      setSettingsMessage({ type: "error", text: "대상이 없습니다." });
      return;
    }
    setSettingsLoading(true);
    setSettingsMessage(null);
    try {
      const updates: { is_visible?: boolean; is_weekly_assignment?: boolean } = {};
      if (settingsVisible !== null) updates.is_visible = settingsVisible;
      if (settingsWeekly !== null) updates.is_weekly_assignment = settingsWeekly;
      const { error } = await supabase
        .from("assignments")
        .update(updates)
        .in("video_id", selectedVideoIds)
        .in("user_id", userIds);
      if (error) throw error;
      setSettingsMessage({ type: "success", text: "설정이 적용되었습니다." });
      setSettingsModalOpen(false);
      setSettingsVisible(null);
      setSettingsWeekly(null);
      setSettingsClassId("");
      setSettingsStudentIds([]);
      setSelectedVideoIds([]);
      loadVideos();
    } catch (err) {
      setSettingsMessage({ type: "error", text: err instanceof Error ? err.message : "설정 적용 실패" });
    } finally {
      setSettingsLoading(false);
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">영상 관리</h1>
      <p className="mb-8 text-slate-600 dark:text-slate-400">
        YouTube URL 또는 재생목록으로 등록 후, 영상·재생목록 단위로 학생/반에 할당하고, 노출·주간과제를 학생/반별로 지정할 수 있습니다.
      </p>

      {/* 재생목록 한 번에 등록 */}
      <section className="mb-10 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6 shadow-sm dark:border-emerald-800 dark:bg-emerald-900/20">
        <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-white">YouTube 재생목록으로 한 번에 등록</h2>
        <form onSubmit={handleImportPlaylist} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">재생목록 URL</label>
            <input
              type="url"
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              placeholder="https://www.youtube.com/playlist?list=PL..."
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">강좌 이름 (선택)</label>
            <input
              type="text"
              value={playlistCourseTitle}
              onChange={(e) => setPlaylistCourseTitle(e.target.value)}
              placeholder="비우면 재생목록 제목 사용"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          {playlistMessage && (
            <div className={`rounded-lg px-4 py-3 text-sm ${playlistMessage.type === "error" ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" : "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"}`}>
              {playlistMessage.text}
            </div>
          )}
          <button type="submit" disabled={playlistLoading} className="rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {playlistLoading ? "가져오는 중..." : "재생목록 가져와서 강좌로 등록"}
          </button>
        </form>
      </section>

      {/* 단일 영상 등록 */}
      <form onSubmit={handleAdd} className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">YouTube URL (단일 영상)</label>
        <input
          type="url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">제목 (선택)</label>
        <input
          type="text"
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          placeholder="비우면 자동"
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
        {message && (
          <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.type === "error" ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400" : "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"}`}>
            {message.text}
          </div>
        )}
        <button type="submit" disabled={submitLoading} className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {submitLoading ? "등록 중..." : "영상 등록"}
        </button>
      </form>

      {/* 등록된 영상: 강좌별 그룹 + 할당/설정 */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-white">등록된 영상 (강좌별)</h2>
          {allVideos.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input type="checkbox" checked={selectedVideoIds.length === allVideos.length && allVideos.length > 0} onChange={toggleSelectAll} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                전체 선택
              </label>
              {selectedVideoIds.length > 0 && (
                <>
                  <button type="button" onClick={() => { setAssignMessage(null); setAssignModalOpen(true); }} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                    선택 항목 학생/반에 할당
                  </button>
                  <button type="button" onClick={() => { setSettingsMessage(null); setSettingsModalOpen(true); }} className="rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600">
                    선택 항목 노출/주간과제 설정 (학생·반별)
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkDelete}
                    disabled={deleteLoading}
                    className="rounded-lg bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                  >
                    {deleteLoading ? "삭제 중..." : "선택 항목 삭제"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {bulkMessage && <p className={`mb-4 text-sm ${bulkMessage.type === "error" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>{bulkMessage.text}</p>}
        {loading ? (
          <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
        ) : allVideos.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-slate-400">등록된 영상이 없습니다.</div>
        ) : (
          <div className="space-y-8">
            {courseGroups.map((group) => {
              const ids = group.videos.map((v) => v.id);
              const allInGroupSelected = ids.length > 0 && ids.every((id) => selectedVideoIds.includes(id));
              return (
                <div key={group.courseId ?? "none"} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-3 flex items-center gap-3 border-b border-slate-100 pb-3 dark:border-zinc-700">
                    <input
                      type="checkbox"
                      checked={allInGroupSelected}
                      onChange={() => toggleSelectCourse(group.courseId)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <h3 className="text-base font-semibold text-slate-800 dark:text-white">{group.courseTitle}</h3>
                    <span className="text-sm text-slate-500 dark:text-slate-400">({group.videos.length}개 영상)</span>
                  </div>
                  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {group.videos.map((v) => (
                      <li key={v.id} className="flex flex-col overflow-hidden rounded-xl border border-slate-100 bg-slate-50/50 dark:border-zinc-700 dark:bg-zinc-800/50">
                        <div className="flex items-start gap-2 p-2">
                          <input type="checkbox" checked={selectedVideoIds.includes(v.id)} onChange={() => toggleSelectVideo(v.id)} className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                        </div>
                        <div className="aspect-video w-full shrink-0 overflow-hidden bg-slate-200 dark:bg-zinc-700">
                          <img src={getThumbnailUrl(v.video_id)} alt="" className="h-full w-full object-cover" />
                        </div>
                        <div className="flex flex-1 flex-col p-3">
                          <h4 className="font-medium text-slate-900 dark:text-white line-clamp-2">{v.title}</h4>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{v.video_id}</p>
                          <button type="button" onClick={() => handleDelete(v.id)} className="mt-2 self-start rounded-lg bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">삭제</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 할당 모달 */}
      {assignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAssignModalOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">선택한 영상을 할당</h3>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">대상: {selectedVideoIds.length}개 영상</p>
            <div className="mb-4 flex gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="assignTarget" checked={assignTarget === "class"} onChange={() => setAssignTarget("class")} className="text-indigo-600" />
                반으로 할당
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="assignTarget" checked={assignTarget === "student"} onChange={() => setAssignTarget("student")} className="text-indigo-600" />
                학생 선택
              </label>
            </div>
            {assignTarget === "class" && (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">반 선택</label>
                <select value={assignClassId} onChange={(e) => setAssignClassId(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white">
                  <option value="">선택</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>
            )}
            {assignTarget === "student" && (
              <div className="mb-4 max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-zinc-700">
                {students.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 py-1">
                    <input type="checkbox" checked={assignStudentIds.includes(s.id)} onChange={() => setAssignStudentIds((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])} className="rounded text-indigo-600" />
                    <span className="text-sm">{s.full_name ?? s.email ?? s.id}</span>
                  </label>
                ))}
              </div>
            )}
            {assignMessage && <p className={`mb-4 text-sm ${assignMessage.type === "error" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>{assignMessage.text}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setAssignModalOpen(false)} className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 dark:bg-zinc-700 dark:text-slate-200">취소</button>
              <button type="button" onClick={handleAssignSubmit} disabled={assignLoading} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">할당</button>
            </div>
          </div>
        </div>
      )}

      {/* 설정 모달 (노출/주간과제 학생·반별) */}
      {settingsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSettingsModalOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">선택한 영상의 노출/주간과제 설정</h3>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">대상: {selectedVideoIds.length}개 영상</p>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">적용 대상</label>
              <div className="flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="settingsTarget" checked={settingsTarget === "all"} onChange={() => setSettingsTarget("all")} className="text-indigo-600" />
                  해당 영상이 할당된 전체 학생
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="settingsTarget" checked={settingsTarget === "class"} onChange={() => setSettingsTarget("class")} className="text-indigo-600" />
                  특정 반
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="settingsTarget" checked={settingsTarget === "student"} onChange={() => setSettingsTarget("student")} className="text-indigo-600" />
                  특정 학생
                </label>
              </div>
            </div>
            {settingsTarget === "class" && (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">반 선택</label>
                <select value={settingsClassId} onChange={(e) => setSettingsClassId(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white">
                  <option value="">선택</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>
            )}
            {settingsTarget === "student" && (
              <div className="mb-4 max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-zinc-700">
                {students.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 py-1">
                    <input type="checkbox" checked={settingsStudentIds.includes(s.id)} onChange={() => setSettingsStudentIds((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])} className="rounded text-indigo-600" />
                    <span className="text-sm">{s.full_name ?? s.email ?? s.id}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">노출</label>
              <div className="flex gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="visible" checked={settingsVisible === true} onChange={() => setSettingsVisible(true)} className="text-indigo-600" />
                  노출
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="visible" checked={settingsVisible === false} onChange={() => setSettingsVisible(false)} className="text-indigo-600" />
                  비노출
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="visible" checked={settingsVisible === null} onChange={() => setSettingsVisible(null)} className="text-indigo-600" />
                  변경 안 함
                </label>
              </div>
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">주간 과제</label>
              <div className="flex gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="weekly" checked={settingsWeekly === true} onChange={() => setSettingsWeekly(true)} className="text-indigo-600" />
                  지정
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="weekly" checked={settingsWeekly === false} onChange={() => setSettingsWeekly(false)} className="text-indigo-600" />
                  해제
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="weekly" checked={settingsWeekly === null} onChange={() => setSettingsWeekly(null)} className="text-indigo-600" />
                  변경 안 함
                </label>
              </div>
            </div>
            {settingsMessage && <p className={`mb-4 text-sm ${settingsMessage.type === "error" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>{settingsMessage.text}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setSettingsModalOpen(false)} className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 dark:bg-zinc-700 dark:text-slate-200">취소</button>
              <button type="button" onClick={handleSettingsSubmit} disabled={settingsLoading} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">적용</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
