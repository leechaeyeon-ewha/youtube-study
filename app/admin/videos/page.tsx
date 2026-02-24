"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { extractYoutubeVideoId, getThumbnailUrl } from "@/lib/youtube";
import type { Video } from "@/lib/types";
import LoadingSpinner from "@/components/LoadingSpinner";

interface VideoWithCourse extends Video {
  sort_order?: number;
  courses: { id: string; title: string; sort_order?: number } | null;
  is_visible?: boolean;
  is_weekly_assignment?: boolean;
}

interface CourseGroup {
  courseId: string | null;
  courseTitle: string;
  courseSortOrder: number;
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

const VIDEOS_CACHE_TTL_MS = 30 * 1000;
let videosPageCache: { courseGroups: CourseGroup[]; at: number } | null = null;

export default function AdminVideosPage() {
  const [mounted, setMounted] = useState(false);
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
  const [activeTab, setActiveTab] = useState<"playlist" | "single">("playlist");
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [students, setStudents] = useState<Profile[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [assignTarget, setAssignTarget] = useState<"student" | "class">("class");
  const [assignStudentIds, setAssignStudentIds] = useState<string[]>([]);
  const [assignClassId, setAssignClassId] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignMessage, setAssignMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [assignPriority, setAssignPriority] = useState(false);

  const [settingsTarget, setSettingsTarget] = useState<"all" | "class" | "student">("all");
  const [settingsClassId, setSettingsClassId] = useState("");
  const [settingsStudentIds, setSettingsStudentIds] = useState<string[]>([]);
  const [settingsVisible, setSettingsVisible] = useState<boolean | null>(null);
  const [settingsWeekly, setSettingsWeekly] = useState<boolean | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const [bulkMessage, setBulkMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [videoSearchTitle, setVideoSearchTitle] = useState("");
  const [reorderLoading, setReorderLoading] = useState<string | null>(null);
  const [refreshTitlesLoading, setRefreshTitlesLoading] = useState(false);
  const [refreshTitlesMessage, setRefreshTitlesMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [videoDetailModal, setVideoDetailModal] = useState<{ id: string; title: string } | null>(null);
  const [assignmentDetailList, setAssignmentDetailList] = useState<{ user_id: string; full_name: string | null; email: string | null; progress_percent: number; last_watched_at: string | null }[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  function buildCourseGroupsFromVideos(list: VideoWithCourse[]): CourseGroup[] {
    const normalized = list.map((row) => ({
      ...row,
      sort_order: row.sort_order ?? 0,
      courses: Array.isArray(row.courses) ? row.courses[0] ?? null : row.courses ?? null,
    }));
    const byCourse = new Map<string | null, VideoWithCourse[]>();
    for (const v of normalized) {
      const cid = v.course_id ?? null;
      if (!byCourse.has(cid)) byCourse.set(cid, []);
      byCourse.get(cid)!.push(v);
    }
    const groups: CourseGroup[] = [];
    byCourse.forEach((videos, courseId) => {
      const courseTitle = videos[0]?.courses?.title ?? "기타 영상";
      const courseSortOrder = videos[0]?.courses?.sort_order ?? 0;
      const sortedVideos = [...videos].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.created_at ?? "").localeCompare(b.created_at ?? "")
      );
      groups.push({ courseId, courseTitle, courseSortOrder, videos: sortedVideos });
    });
    groups.sort((a, b) => {
      if (a.courseId == null) return 1;
      if (b.courseId == null) return -1;
      return a.courseSortOrder - b.courseSortOrder || a.courseTitle.localeCompare(b.courseTitle);
    });
    return groups;
  }

  async function loadVideos() {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const now = Date.now();
    if (videosPageCache && now - videosPageCache.at < VIDEOS_CACHE_TTL_MS) {
      setCourseGroups(videosPageCache.courseGroups);
      setLoading(false);
      return;
    }
    let data: VideoWithCourse[] | null = null;
    let error: { message: string } | null = null;
    const res = await supabase
      .from("videos")
      .select("id, title, video_id, course_id, is_visible, is_weekly_assignment, sort_order, created_at, courses(id, title, sort_order)")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    data = res.data as VideoWithCourse[] | null;
    error = res.error;
    if (error && data == null) {
      const fallback = await supabase
        .from("videos")
        .select("id, title, video_id, course_id, created_at, courses(id, title)")
        .order("created_at", { ascending: false });
      if (!fallback.error && fallback.data) {
        data = fallback.data as VideoWithCourse[];
        error = null;
      }
    }
    if (!error && data && data.length >= 0) {
      const groups = buildCourseGroupsFromVideos(data);
      setCourseGroups(groups);
      videosPageCache = { courseGroups: groups, at: Date.now() };
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
    setMounted(true);
  }, []);

  useEffect(() => {
    loadVideos();
  }, []);

  useEffect(() => {
    if (assignModalOpen || settingsModalOpen) loadStudentsAndClasses();
  }, [assignModalOpen, settingsModalOpen]);

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

  const allVideos = courseGroups.flatMap((g) => g.videos);
  const playlistGroups = courseGroups.filter((g) => g.courseId !== null);
  const standaloneVideos = allVideos.filter((v) => !v.course_id);
  const searchLower = videoSearchTitle.trim().toLowerCase();
  const filteredPlaylistGroups = playlistGroups
    .map((g) => ({
      ...g,
      videos: searchLower ? g.videos.filter((v) => (v.title || "").toLowerCase().includes(searchLower)) : g.videos,
    }))
    .filter((g) => g.videos.length > 0);
  const filteredStandaloneVideos = searchLower
    ? standaloneVideos.filter((v) => (v.title || "").toLowerCase().includes(searchLower))
    : standaloneVideos;
  const displayedVideos =
    activeTab === "playlist" ? filteredPlaylistGroups.flatMap((g) => g.videos) : filteredStandaloneVideos;

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
      const data = (await res.json().catch(() => ({}))) as { error?: string; courseTitle?: string; added?: number; skipped?: number; total?: number };
      if (!res.ok) throw new Error(data?.error || `서버 오류 (${res.status}). Vercel 환경 변수 YOUTUBE_API_KEY, SUPABASE_SERVICE_ROLE_KEY 확인 후 재배포해 주세요.`);
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

  async function handleRefreshAllTitles() {
    setRefreshTitlesMessage(null);
    setRefreshTitlesLoading(true);
    try {
      const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } };
      const res = await fetch("/api/admin/refresh-video-titles", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: session?.access_token ? `Bearer ${session.access_token}` : "" },
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; updated?: number; total?: number };
      if (!res.ok) {
        setRefreshTitlesMessage({ type: "error", text: data?.error ?? `요청 실패 (${res.status})` });
        return;
      }
      setRefreshTitlesMessage({ type: "success", text: data?.message ?? `${data.updated ?? 0}개 제목을 업데이트했습니다.` });
      videosPageCache = null;
      loadVideos();
    } catch (err: unknown) {
      setRefreshTitlesMessage({ type: "error", text: err instanceof Error ? err.message : "제목 일괄 업데이트에 실패했습니다." });
    } finally {
      setRefreshTitlesLoading(false);
    }
  }

  async function openVideoDetailModal(videoId: string, title: string) {
    setVideoDetailModal({ id: videoId, title });
    setAssignmentDetailList([]);
    setDetailLoading(true);
    try {
      const { data, error } = await supabase
        .from("assignments")
        .select("user_id, progress_percent, last_watched_at, profiles(full_name, email)")
        .eq("video_id", videoId)
        .order("last_watched_at", { ascending: false });
      if (error) throw error;
      const rows = ((data ?? []) as { user_id: string; progress_percent: number; last_watched_at: string | null; profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null }[]).map((row) => {
        const p = Array.isArray(row.profiles) ? row.profiles[0] ?? null : row.profiles;
        return {
          user_id: row.user_id,
          full_name: p?.full_name ?? null,
          email: p?.email ?? null,
          progress_percent: Number(row.progress_percent) ?? 0,
          last_watched_at: row.last_watched_at ?? null,
        };
      });
      setAssignmentDetailList(rows);
    } catch (_err: unknown) {
      setAssignmentDetailList([]);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!supabase || !confirm("이 영상을 삭제할까요? 해당 영상에 대한 학생 배정이 자동으로 해제됩니다.")) return;
    const { data: affected } = await supabase.from("assignments").select("id").eq("video_id", id);
    const assignmentIds = ((affected ?? []) as { id: string }[]).map((r) => r.id);
    await supabase.from("assignments").delete().eq("video_id", id);
    await supabase.from("videos").delete().eq("id", id);
    setSelectedVideoIds((prev) => prev.filter((x) => x !== id));
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token && assignmentIds.length > 0) {
      fetch("/api/revalidate-student", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ assignmentIds }),
        cache: "no-store",
      }).catch(() => {});
    }
    loadVideos();
  }

  async function handleBulkDelete() {
    if (!supabase || selectedVideoIds.length === 0) return;
    if (!confirm(`선택한 ${selectedVideoIds.length}개 영상을 삭제할까요?\n해당 영상에 대한 학생 배정이 자동으로 해제되며, 복구할 수 없습니다.`)) return;
    setDeleteLoading(true);
    setBulkMessage(null);
    try {
      const { data: affected } = await supabase.from("assignments").select("id").in("video_id", selectedVideoIds);
      const assignmentIds = ((affected ?? []) as { id: string }[]).map((r) => r.id);
      await supabase.from("assignments").delete().in("video_id", selectedVideoIds);
      const { error } = await supabase.from("videos").delete().in("id", selectedVideoIds);
      if (error) throw error;
      setBulkMessage({ type: "success", text: `선택한 ${selectedVideoIds.length}개 영상이 삭제되었습니다. (배정 자동 해제)` });
      setSelectedVideoIds([]);
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token && assignmentIds.length > 0) {
        fetch("/api/revalidate-student", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ assignmentIds }),
          cache: "no-store",
        }).catch(() => {});
      }
      loadVideos();
    } catch (err: unknown) {
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
    if (displayedVideos.length === 0) return;
    const allSelected = displayedVideos.every((v) =>
      selectedVideoIds.includes(v.id)
    );
    if (allSelected) {
      const idsToUnselect = new Set(displayedVideos.map((v) => v.id));
      setSelectedVideoIds((prev) => prev.filter((id) => !idsToUnselect.has(id)));
    } else {
      setSelectedVideoIds((prev) => [
        ...new Set([...prev, ...displayedVideos.map((v) => v.id)]),
      ]);
    }
  }

  /** 재생목록(강좌) 순서: 위로 — 낙관적 업데이트 후 Supabase(courses) 동기화 */
  async function moveCourseUp(groupIndex: number) {
    if (!supabase || groupIndex <= 0) return;
    const groups = filteredPlaylistGroups;
    const prev = groups[groupIndex - 1];
    const curr = groups[groupIndex];
    if (!prev?.courseId || !curr?.courseId) return;
    const prevOrder = prev.courseSortOrder;
    const currOrder = curr.courseSortOrder;

    setReorderLoading(`course-${curr.courseId}`);
    videosPageCache = null;

    const previousGroups = courseGroups;
    setCourseGroups((prevGroups) => {
      const prevIdx = prevGroups.findIndex((g) => g.courseId === prev.courseId);
      const currIdx = prevGroups.findIndex((g) => g.courseId === curr.courseId);
      if (prevIdx === -1 || currIdx === -1) return prevGroups;
      const next = [...prevGroups];
      [next[prevIdx], next[currIdx]] = [next[currIdx], next[prevIdx]];
      return next;
    });

    try {
      const [prevRes, currRes] = await Promise.all([
        supabase.from("courses").update({ sort_order: currOrder }).eq("id", prev.courseId),
        supabase.from("courses").update({ sort_order: prevOrder }).eq("id", curr.courseId),
      ]);
      if (prevRes.error || currRes.error) {
        setCourseGroups(previousGroups);
        await loadVideos();
      }
    } finally {
      setReorderLoading(null);
    }
  }

  /** 재생목록(강좌) 순서: 아래로 — 낙관적 업데이트 후 Supabase(courses) 동기화 */
  async function moveCourseDown(groupIndex: number) {
    if (!supabase || groupIndex >= filteredPlaylistGroups.length - 1) return;
    const groups = filteredPlaylistGroups;
    const curr = groups[groupIndex];
    const next = groups[groupIndex + 1];
    if (!curr?.courseId || !next?.courseId) return;
    const currOrder = curr.courseSortOrder;
    const nextOrder = next.courseSortOrder;

    setReorderLoading(`course-${curr.courseId}`);
    videosPageCache = null;

    const previousGroups = courseGroups;
    setCourseGroups((prevGroups) => {
      const currIdx = prevGroups.findIndex((g) => g.courseId === curr.courseId);
      const nextIdx = prevGroups.findIndex((g) => g.courseId === next.courseId);
      if (currIdx === -1 || nextIdx === -1) return prevGroups;
      const nextArr = [...prevGroups];
      [nextArr[currIdx], nextArr[nextIdx]] = [nextArr[nextIdx], nextArr[currIdx]];
      return nextArr;
    });

    try {
      const [currRes, nextRes] = await Promise.all([
        supabase.from("courses").update({ sort_order: nextOrder }).eq("id", curr.courseId),
        supabase.from("courses").update({ sort_order: currOrder }).eq("id", next.courseId),
      ]);
      if (currRes.error || nextRes.error) {
        setCourseGroups(previousGroups);
        await loadVideos();
      }
    } finally {
      setReorderLoading(null);
    }
  }

  /** 영상 순서: 위로 (같은 강좌 내 또는 기타 영상 목록 내) — 낙관적 업데이트 후 Supabase 동기화 */
  async function moveVideoUp(courseId: string | null, videoIndex: number) {
    if (!supabase || videoIndex <= 0) return;
    const group = courseGroups.find((g) => g.courseId === courseId);
    if (!group) return;
    const prev = group.videos[videoIndex - 1];
    const curr = group.videos[videoIndex];
    if (!prev || !curr) return;
    setReorderLoading(`video-${curr.id}`);
    videosPageCache = null;

    const previousGroups = courseGroups;
    setCourseGroups((prevGroups) => {
      const gIdx = prevGroups.findIndex((g) => g.courseId === courseId);
      if (gIdx === -1) return prevGroups;
      const nextVideos = [...prevGroups[gIdx].videos];
      [nextVideos[videoIndex - 1], nextVideos[videoIndex]] = [nextVideos[videoIndex], nextVideos[videoIndex - 1]];
      const next = [...prevGroups];
      next[gIdx] = { ...next[gIdx], videos: nextVideos };
      return next;
    });

    try {
      const [prevOrder, currOrder] = [prev.sort_order ?? 0, curr.sort_order ?? 0];
      const [prevRes, currRes] = await Promise.all([
        supabase.from("videos").update({ sort_order: currOrder }).eq("id", prev.id),
        supabase.from("videos").update({ sort_order: prevOrder }).eq("id", curr.id),
      ]);
      if (prevRes.error || currRes.error) {
        setCourseGroups(previousGroups);
        await loadVideos();
      }
    } finally {
      setReorderLoading(null);
    }
  }

  /** 영상 순서: 아래로 — 낙관적 업데이트 후 Supabase 동기화 */
  async function moveVideoDown(courseId: string | null, videoIndex: number) {
    if (!supabase || videoIndex >= (courseGroups.find((g) => g.courseId === courseId)?.videos.length ?? 0) - 1) return;
    const group = courseGroups.find((g) => g.courseId === courseId);
    if (!group) return;
    const curr = group.videos[videoIndex];
    const next = group.videos[videoIndex + 1];
    if (!curr || !next) return;
    setReorderLoading(`video-${curr.id}`);
    videosPageCache = null;

    const previousGroups = courseGroups;
    setCourseGroups((prevGroups) => {
      const gIdx = prevGroups.findIndex((g) => g.courseId === courseId);
      if (gIdx === -1) return prevGroups;
      const nextVideos = [...prevGroups[gIdx].videos];
      [nextVideos[videoIndex], nextVideos[videoIndex + 1]] = [nextVideos[videoIndex + 1], nextVideos[videoIndex]];
      const next = [...prevGroups];
      next[gIdx] = { ...next[gIdx], videos: nextVideos };
      return next;
    });

    try {
      const [currOrder, nextOrder] = [curr.sort_order ?? 0, next.sort_order ?? 0];
      const [currRes, nextRes] = await Promise.all([
        supabase.from("videos").update({ sort_order: nextOrder }).eq("id", curr.id),
        supabase.from("videos").update({ sort_order: currOrder }).eq("id", next.id),
      ]);
      if (currRes.error || nextRes.error) {
        setCourseGroups(previousGroups);
        await loadVideos();
      }
    } finally {
      setReorderLoading(null);
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
      const newIds: string[] = [];
      for (const videoId of selectedVideoIds) {
        for (const userId of userIds) {
          const { data: row, error } = await supabase
            .from("assignments")
            .insert({
              user_id: userId,
              video_id: videoId,
              is_completed: false,
              progress_percent: 0,
              last_position: 0,
              is_visible: true,
              is_weekly_assignment: false,
              is_priority: assignPriority,
            })
            .select("id")
            .single();
          if (!error) {
            added += 1;
            if (row?.id) newIds.push(row.id);
          }
        }
      }
      setAssignMessage({ type: "success", text: `선택한 ${selectedVideoIds.length}개 영상을 ${userIds.length}명에게 할당했습니다. (중복 제외 ${added}건 추가)` });
      setSelectedVideoIds([]);
      setAssignModalOpen(false);
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token && newIds.length > 0) {
        fetch("/api/revalidate-student", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ assignmentIds: newIds }),
          cache: "no-store",
        }).catch(() => {});
      }
      setAssignClassId("");
      setAssignStudentIds([]);
      setAssignPriority(false);
      loadVideos();
    } catch (err: unknown) {
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
    } catch (err: unknown) {
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

      {/* 등록된 재생목록 / 등록된 영상: 탭 + 할당/설정 */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("playlist")}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                activeTab === "playlist"
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
              }`}
            >
              등록된 재생목록
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("single")}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                activeTab === "single"
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
              }`}
            >
              등록된 영상
            </button>
            <button
              type="button"
              onClick={handleRefreshAllTitles}
              disabled={refreshTitlesLoading}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-slate-200 dark:hover:bg-zinc-700"
            >
              {refreshTitlesLoading ? "업데이트 중…" : "등록된 영상 제목 일괄 업데이트"}
            </button>
          </div>
        </div>
        {refreshTitlesMessage && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              refreshTitlesMessage.type === "error"
                ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                : "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
            }`}
          >
            {refreshTitlesMessage.text}
          </div>
        )}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          {(playlistGroups.length > 0 || standaloneVideos.length > 0) && (
            <div className="mb-3">
              <input
                type="text"
                value={videoSearchTitle}
                onChange={(e) => setVideoSearchTitle(e.target.value)}
                placeholder="제목으로 검색..."
                className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              />
            </div>
          )}
          {displayedVideos.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={
                    displayedVideos.length > 0 &&
                    displayedVideos.every((v) => selectedVideoIds.includes(v.id))
                  }
                  onChange={toggleSelectAll}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
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
        ) : displayedVideos.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-slate-400">
            {videoSearchTitle.trim() &&
            (activeTab === "playlist" ? playlistGroups : standaloneVideos).length > 0
              ? "제목에 맞는 영상이 없습니다."
              : activeTab === "playlist"
                ? "등록된 재생목록이 없습니다."
                : "등록된 영상이 없습니다."}
          </div>
        ) : activeTab === "playlist" ? (
          <div className="space-y-4">
            {filteredPlaylistGroups.map((group, groupIndex) => {
              const ids = group.videos.map((v) => v.id);
              const allInGroupSelected =
                ids.length > 0 && ids.every((id) => selectedVideoIds.includes(id));
              const isExpanded = expandedCourseId === group.courseId;
              const courseBusy = group.courseId && reorderLoading === `course-${group.courseId}`;
              return (
                <div
                  key={group.courseId ?? "none"}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-zinc-700">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveCourseUp(groupIndex)}
                          disabled={groupIndex === 0 || !!courseBusy}
                          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-zinc-700 dark:hover:text-slate-300"
                          title="위로"
                          aria-label="재생목록 위로"
                        >
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCourseDown(groupIndex)}
                          disabled={groupIndex === filteredPlaylistGroups.length - 1 || !!courseBusy}
                          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-zinc-700 dark:hover:text-slate-300"
                          title="아래로"
                          aria-label="재생목록 아래로"
                        >
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                      </div>
                      <input
                        type="checkbox"
                        checked={allInGroupSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelectCourse(group.courseId);
                        }}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCourseId(
                            isExpanded ? null : (group.courseId as string | null)
                          )
                        }
                        className="flex flex-1 items-center justify-between gap-3 text-left min-w-0"
                      >
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold text-slate-800 dark:text-white truncate">
                            {group.courseTitle}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            재생목록 내 영상 {group.videos.length}개
                          </p>
                        </div>
                        <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
                          {isExpanded ? "접기 ▲" : "영상 보기 ▼"}
                        </span>
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <ul className="divide-y divide-slate-100 dark:divide-zinc-800">
                      {group.videos.map((v, videoIndex) => {
                        const videoBusy = reorderLoading === `video-${v.id}`;
                        return (
                          <li
                            key={v.id}
                            className="flex items-center gap-3 px-4 py-3 bg-slate-50/60 dark:bg-zinc-900"
                          >
                            <div className="flex flex-col gap-0.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => moveVideoUp(group.courseId, videoIndex)}
                                disabled={videoIndex === 0 || !!videoBusy}
                                className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-zinc-600 dark:hover:text-slate-300"
                                title="위로"
                                aria-label="영상 위로"
                              >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => moveVideoDown(group.courseId, videoIndex)}
                                disabled={videoIndex === group.videos.length - 1 || !!videoBusy}
                                className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-zinc-600 dark:hover:text-slate-300"
                                title="아래로"
                                aria-label="영상 아래로"
                              >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                              </button>
                            </div>
                            <input
                              type="checkbox"
                              checked={selectedVideoIds.includes(v.id)}
                              onChange={() => toggleSelectVideo(v.id)}
                              className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded-lg bg-slate-200 dark:bg-zinc-700">
                              <img
                                src={getThumbnailUrl(v.video_id)}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-900 dark:text-white line-clamp-2">
                                <a
                                  href={`https://www.youtube.com/watch?v=${v.video_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-indigo-600 hover:underline dark:text-indigo-400"
                                >
                                  {v.title}
                                </a>
                              </p>
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                {v.video_id}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => openVideoDetailModal(v.id, v.title)}
                              className="shrink-0 rounded-lg bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-900/50"
                            >
                              배정 현황
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(v.id)}
                              className="shrink-0 rounded-lg bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                            >
                              삭제
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <ul className="space-y-3">
            {(() => {
              const standaloneGroup = courseGroups.find((g) => g.courseId === null);
              const standaloneVideosList = standaloneGroup?.videos ?? [];
              return filteredStandaloneVideos.map((v) => {
                const videoIndex = standaloneVideosList.findIndex((vv) => vv.id === v.id);
                const videoBusy = reorderLoading === `video-${v.id}`;
                return (
                  <li
                    key={v.id}
                    className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveVideoUp(null, videoIndex)}
                        disabled={videoIndex <= 0 || !!videoBusy}
                        className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-zinc-600 dark:hover:text-slate-300"
                        title="위로"
                        aria-label="영상 위로"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => moveVideoDown(null, videoIndex)}
                        disabled={videoIndex >= standaloneVideosList.length - 1 || videoIndex < 0 || !!videoBusy}
                        className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-zinc-600 dark:hover:text-slate-300"
                        title="아래로"
                        aria-label="영상 아래로"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedVideoIds.includes(v.id)}
                      onChange={() => toggleSelectVideo(v.id)}
                      className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded-lg bg-slate-200 dark:bg-zinc-700">
                      <img
                        src={getThumbnailUrl(v.video_id)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-white line-clamp-2">
                        <a
                          href={`https://www.youtube.com/watch?v=${v.video_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          {v.title}
                        </a>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {v.video_id}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openVideoDetailModal(v.id, v.title)}
                      className="shrink-0 rounded-lg bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-900/50"
                    >
                      배정 현황
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(v.id)}
                      className="shrink-0 rounded-lg bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                    >
                      삭제
                    </button>
                  </li>
                );
              });
            })()}
          </ul>
        )}
      </section>

      {/* 영상별 배정 현황 모달 (이름 / 진도율 / 최근 시청일) */}
      {videoDetailModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setVideoDetailModal(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="video-detail-modal-title"
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-4 py-3 dark:border-zinc-700">
              <h2 id="video-detail-modal-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                배정 현황
              </h2>
              <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400" title={videoDetailModal.title}>
                {videoDetailModal.title}
              </p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
              {detailLoading ? (
                <div className="flex justify-center py-8">
                  <LoadingSpinner />
                </div>
              ) : assignmentDetailList.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  이 영상을 배정받은 학생이 없습니다.
                </p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-zinc-700">
                      <th className="py-2 pr-4 font-medium text-slate-600 dark:text-slate-400">이름</th>
                      <th className="py-2 pr-4 font-medium text-slate-600 dark:text-slate-400">진도율</th>
                      <th className="py-2 font-medium text-slate-600 dark:text-slate-400">최근 시청일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignmentDetailList.map((row) => (
                      <tr key={row.user_id} className="border-b border-slate-100 last:border-0 dark:border-zinc-700/50">
                        <td className="py-2.5 pr-4 font-medium text-slate-800 dark:text-slate-200">
                          {row.full_name || row.email || row.user_id.slice(0, 8)}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className={row.progress_percent >= 100 ? "text-green-600 dark:text-green-400" : "text-slate-600 dark:text-slate-400"}>
                            {row.progress_percent.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-600 dark:text-slate-400">
                          {row.last_watched_at
                            ? new Date(row.last_watched_at).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short", hour12: false })
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="border-t border-slate-200 px-4 py-3 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setVideoDetailModal(null)}
                className="w-full rounded-lg bg-slate-200 py-2 text-sm font-medium text-slate-800 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

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
            <div className="mb-4">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={assignPriority}
                  onChange={(e) => setAssignPriority(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>
                  이 영상을 <span className="font-semibold text-indigo-600 dark:text-indigo-400">우선 학습</span>으로 표시
                  <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">(학생 화면 상단에 [우선 학습] 배지로 노출)</span>
                </span>
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
