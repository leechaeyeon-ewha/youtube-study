"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getThumbnailUrl } from "@/lib/youtube";
import LoadingSpinner from "@/components/LoadingSpinner";

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

interface AssignmentWithVideo {
  id: string;
  user_id: string;
  progress_percent: number;
  videos: { id: string; title: string; video_id: string } | { id: string; title: string; video_id: string }[] | null;
}

interface VideoWithCourse {
  id: string;
  title: string;
  video_id: string;
  course_id: string | null;
  courses: { id: string; title: string } | null;
}

interface CourseGroup {
  courseId: string | null;
  courseTitle: string;
  videos: VideoWithCourse[];
}

const CLASSES_CACHE_TTL_MS = 30 * 1000;
let classesPageCache: {
  students: Profile[];
  classes: ClassRow[];
  assignmentsByUser: Record<string, AssignmentWithVideo[]>;
  classProgress: Record<string, number>;
  courseGroups: CourseGroup[];
  at: number;
} | null = null;

export default function AdminClassesPage() {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<Profile[]>([]);
  const [assignmentsByUser, setAssignmentsByUser] = useState<Record<string, AssignmentWithVideo[]>>({});
  const [classProgress, setClassProgress] = useState<Record<string, number>>({});
  const [courseGroups, setCourseGroups] = useState<CourseGroup[]>([]);

  const [newClassTitle, setNewClassTitle] = useState("");
  const [addClassLoading, setAddClassLoading] = useState(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editClassLoading, setEditClassLoading] = useState(false);

  const [bulkAssignClassId, setBulkAssignClassId] = useState("");
  const [bulkAssignVideoIds, setBulkAssignVideoIds] = useState<string[]>([]);
  const [bulkAssignLoading, setBulkAssignLoading] = useState(false);
  const [bulkAssignMessage, setBulkAssignMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const [videoSourceTab, setVideoSourceTab] = useState<"playlist" | "single">("playlist");
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [videoSearchTitle, setVideoSearchTitle] = useState("");
  /** 반 카드 클릭 시 해당 반 학생 목록 표시 */
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);
  /** 반에 학생 추가: 선택한 학생 ID 목록 */
  const [addToClassSelectedIds, setAddToClassSelectedIds] = useState<string[]>([]);
  const [addToClassLoading, setAddToClassLoading] = useState(false);
  const [addToClassMessage, setAddToClassMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function load() {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const now = Date.now();
    if (classesPageCache && now - classesPageCache.at < CLASSES_CACHE_TTL_MS) {
      setStudents(classesPageCache.students);
      setClasses(classesPageCache.classes);
      setAssignmentsByUser(classesPageCache.assignmentsByUser);
      setClassProgress(classesPageCache.classProgress);
      setCourseGroups(classesPageCache.courseGroups);
      setLoading(false);
    }

    const { data: { session } } = await supabase.auth.getSession();
    const authHeaders: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
    const [studentsRes, assignmentsRes, classesRes, videosRes] = await Promise.all([
      fetch("/api/admin/students", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
      supabase.from("assignments").select("id, user_id, progress_percent, videos(id, title, video_id)"),
      supabase.from("classes").select("id, title").order("title"),
      supabase.from("videos").select("id, title, video_id, course_id, courses(id, title)").order("created_at", { ascending: false }),
    ]);

    const studentsList = Array.isArray(studentsRes) ? (studentsRes as Profile[]) : [];
    const nextClasses = (classesRes?.data as ClassRow[]) ?? [];
    setStudents(studentsList);
    setClasses(nextClasses);

    let nextByUser: Record<string, AssignmentWithVideo[]> = {};
    if (!assignmentsRes.error && assignmentsRes.data) {
      const list = (assignmentsRes.data as unknown) as AssignmentWithVideo[];
      list.forEach((a) => {
        if (!nextByUser[a.user_id]) nextByUser[a.user_id] = [];
        nextByUser[a.user_id].push(a);
      });
      setAssignmentsByUser(nextByUser);
    }

    let nextProgress: Record<string, number> = {};
    if (studentsList.length > 0 && !assignmentsRes.error && !classesRes?.error) {
      const classList = (classesRes?.data ?? []) as ClassRow[];
      classList.forEach((c) => {
        const studentIds = studentsList.filter((s) => s.class_id === c.id).map((s) => s.id);
        if (studentIds.length === 0) {
          nextProgress[c.id] = 0;
          return;
        }
        let total = 0;
        let count = 0;
        studentIds.forEach((uid) => {
          (nextByUser[uid] ?? []).forEach((a) => {
            total += a.progress_percent;
            count += 1;
          });
        });
        nextProgress[c.id] = count === 0 ? 0 : Math.round((total / count) * 10) / 10;
      });
    }
    setClassProgress(nextProgress);

    let nextGroups: CourseGroup[] = [];
    if (!videosRes.error && videosRes.data) {
      const list = videosRes.data as VideoWithCourse[];
      const normalized = list.map((row) => ({
        ...row,
        courses: Array.isArray(row.courses) ? row.courses[0] ?? null : row.courses ?? null,
      }));
      const byCourse = new Map<string | null, VideoWithCourse[]>();
      for (const v of normalized) {
        const cid = v.course_id ?? null;
        if (!byCourse.has(cid)) byCourse.set(cid, []);
        byCourse.get(cid)!.push(v);
      }
      byCourse.forEach((videos, courseId) => {
        const courseTitle = videos[0]?.courses?.title ?? "기타 영상";
        nextGroups.push({ courseId, courseTitle, videos });
      });
      nextGroups.sort((a, b) => {
        if (a.courseId == null) return 1;
        if (b.courseId == null) return -1;
        return a.courseTitle.localeCompare(b.courseTitle);
      });
      setCourseGroups(nextGroups);
    }

    setLoading(false);
    classesPageCache = {
      students: studentsList,
      classes: nextClasses,
      assignmentsByUser: nextByUser,
      classProgress: nextProgress,
      courseGroups: nextGroups,
      at: Date.now(),
    };
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

  const playlistGroups = courseGroups.filter((g) => g.courseId !== null);
  const allVideos = courseGroups.flatMap((g) => g.videos);
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

  async function handleAddClass(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !newClassTitle.trim()) return;
    setAddClassLoading(true);
    try {
      await supabase.from("classes").insert({ title: newClassTitle.trim() });
      setNewClassTitle("");
      load();
    } finally {
      setAddClassLoading(false);
    }
  }

  async function handleDeleteClass(classId: string) {
    if (!supabase || !confirm("이 반을 삭제할까요? 소속 학생의 반 정보만 해제됩니다.")) return;
    if (editingClassId === classId) setEditingClassId(null);
    await supabase.from("profiles").update({ class_id: null }).eq("class_id", classId);
    await supabase.from("classes").delete().eq("id", classId);
    load();
  }

  async function handleSaveClassTitle(classId: string) {
    const title = editingTitle.trim();
    if (!supabase || !title) return;
    setEditClassLoading(true);
    try {
      const { error } = await supabase.from("classes").update({ title }).eq("id", classId);
      if (error) throw error;
      setEditingClassId(null);
      setEditingTitle("");
      classesPageCache = null;
      load();
    } catch (_err: unknown) {
      alert("반 이름 수정에 실패했습니다.");
    } finally {
      setEditClassLoading(false);
    }
  }

  async function handleBulkAssignToClass(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !bulkAssignClassId || bulkAssignVideoIds.length === 0) {
      setBulkAssignMessage({ type: "error", text: "반과 영상을 선택해 주세요." });
      return;
    }
    setBulkAssignLoading(true);
    setBulkAssignMessage(null);
    try {
      const studentIds = students.filter((s) => s.class_id === bulkAssignClassId).map((s) => s.id);
      if (studentIds.length === 0) {
        setBulkAssignMessage({ type: "error", text: "선택한 반에 소속 학생이 없습니다." });
        setBulkAssignLoading(false);
        return;
      }
      let inserted = 0;
      const newIds: string[] = [];
      for (const videoId of bulkAssignVideoIds) {
        for (const userId of studentIds) {
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
            })
            .select("id")
            .single();
          if (!error) {
            inserted += 1;
            if (row?.id) newIds.push(row.id);
          }
        }
      }
      const className = classes.find((c) => c.id === bulkAssignClassId)?.title ?? "반";
      setBulkAssignMessage({ type: "success", text: `${className}에 ${inserted}건 배정되었습니다. (이미 있던 건 제외)` });
      setBulkAssignVideoIds([]);
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token && newIds.length > 0) {
        fetch("/api/revalidate-student", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ assignmentIds: newIds }),
          cache: "no-store",
        }).catch(() => {});
      }
      load();
    } catch (err: unknown) {
      setBulkAssignMessage({ type: "error", text: err instanceof Error ? err.message : "배정 실패" });
    } finally {
      setBulkAssignLoading(false);
    }
  }

  function toggleBulkVideo(videoId: string) {
    setBulkAssignVideoIds((prev) =>
      prev.includes(videoId) ? prev.filter((id) => id !== videoId) : [...prev, videoId]
    );
  }

  function toggleAddToClassStudent(studentId: string) {
    setAddToClassSelectedIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  }

  async function handleAddStudentsToClass(classId: string) {
    if (!supabase || addToClassSelectedIds.length === 0) return;
    setAddToClassLoading(true);
    setAddToClassMessage(null);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ class_id: classId })
        .in("id", addToClassSelectedIds);
      if (error) throw error;
      const className = classes.find((c) => c.id === classId)?.title ?? "반";
      setAddToClassMessage({ type: "success", text: `${addToClassSelectedIds.length}명을 ${className}에 추가했습니다.` });
      setAddToClassSelectedIds([]);
      load();
    } catch (err: unknown) {
      setAddToClassMessage({ type: "error", text: err instanceof Error ? err.message : "추가 실패" });
    } finally {
      setAddToClassLoading(false);
    }
  }

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">반 관리</h1>

      {/* 반별 평균 진도율 — 반 클릭 시 해당 반 학생 목록 표시 */}
      {classes.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">반별 평균 진도율</h2>
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">반을 클릭하면 해당 반에 속한 학생을 보고, 여러 학생을 선택해 한 번에 반에 추가할 수 있습니다.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {classes.map((c) => {
              const classStudents = students.filter((s) => s.class_id === c.id);
              const isExpanded = expandedClassId === c.id;
              return (
                <div
                  key={c.id}
                  className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50/50 dark:border-zinc-700 dark:bg-zinc-800/50"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedClassId(isExpanded ? null : c.id);
                      if (!isExpanded) {
                        setAddToClassSelectedIds([]);
                        setAddToClassMessage(null);
                      }
                    }}
                    className="w-full p-4 text-left hover:bg-slate-100/80 dark:hover:bg-zinc-700/50"
                  >
                    <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">{c.title}</p>
                    <p className="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400">{classProgress[c.id] ?? 0}%</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{classStudents.length}명</p>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/80">
                      <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">소속 학생</p>
                      {classStudents.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">소속 학생이 없습니다.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {classStudents.map((s) => (
                            <li key={s.id} className="text-sm text-slate-800 dark:text-slate-200">
                              {s.full_name || s.email || s.id.slice(0, 8)}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="mt-4 border-t border-slate-200 pt-3 dark:border-zinc-700">
                        <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">이 반에 학생 추가</p>
                        {(() => {
                          const notInClass = students.filter((s) => s.class_id !== c.id);
                          if (notInClass.length === 0) {
                            return <p className="text-sm text-slate-500 dark:text-slate-400">추가할 수 있는 학생이 없습니다. (모든 학생이 이미 이 반에 있거나 다른 반에 소속되어 있습니다)</p>;
                          }
                          return (
                            <>
                              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">추가할 학생을 선택한 뒤 버튼을 누르세요.</p>
                              <ul className="mb-3 max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800/50">
                                {notInClass.map((s) => (
                                  <li key={s.id} className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      id={`add-${c.id}-${s.id}`}
                                      checked={addToClassSelectedIds.includes(s.id)}
                                      onChange={() => toggleAddToClassStudent(s.id)}
                                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-700"
                                    />
                                    <label htmlFor={`add-${c.id}-${s.id}`} className="cursor-pointer text-sm text-slate-800 dark:text-slate-200">
                                      {s.full_name || s.email || s.id.slice(0, 8)}
                                    </label>
                                  </li>
                                ))}
                              </ul>
                              {addToClassMessage && (
                                <p className={`mb-2 text-sm ${addToClassMessage.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                                  {addToClassMessage.text}
                                </p>
                              )}
                              <button
                                type="button"
                                disabled={addToClassLoading || addToClassSelectedIds.length === 0}
                                onClick={() => handleAddStudentsToClass(c.id)}
                                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                              >
                                {addToClassLoading ? "추가 중..." : `선택한 ${addToClassSelectedIds.length}명 반에 추가`}
                              </button>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 반 추가 / 삭제 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">반(Class) 관리</h2>
        <form onSubmit={handleAddClass} className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[160px]">
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">반 이름</label>
            <input
              type="text"
              value={newClassTitle}
              onChange={(e) => setNewClassTitle(e.target.value)}
              placeholder="예: 중1-A"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={addClassLoading || !newClassTitle.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {addClassLoading ? "추가 중..." : "반 추가"}
          </button>
        </form>
        {classes.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {classes.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-zinc-800">
                {editingClassId === c.id ? (
                  <>
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveClassTitle(c.id);
                        if (e.key === "Escape") setEditingClassId(null);
                      }}
                      placeholder="예: 중2-A"
                      className="w-32 rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                      autoFocus
                    />
                    <button
                      type="button"
                      disabled={editClassLoading || !editingTitle.trim()}
                      onClick={() => handleSaveClassTitle(c.id)}
                      className="rounded bg-indigo-600 px-2 py-1 text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {editClassLoading ? "저장 중…" : "저장"}
                    </button>
                    <button
                      type="button"
                      disabled={editClassLoading}
                      onClick={() => { setEditingClassId(null); setEditingTitle(""); }}
                      className="text-slate-600 hover:underline dark:text-slate-400"
                    >
                      취소
                    </button>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-slate-800 dark:text-white">{c.title}</span>
                    <button
                      type="button"
                      onClick={() => { setEditingClassId(c.id); setEditingTitle(c.title); }}
                      className="text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      수정
                    </button>
                    <button type="button" onClick={() => handleDeleteClass(c.id)} className="text-red-600 hover:underline dark:text-red-400">
                      삭제
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 반에 영상 일괄 배정 */}
      {classes.length > 0 && (playlistGroups.length > 0 || standaloneVideos.length > 0) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">반에 영상 일괄 배정</h2>
          <form onSubmit={handleBulkAssignToClass} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">반 선택</label>
              <select
                value={bulkAssignClassId}
                onChange={(e) => setBulkAssignClassId(e.target.value)}
                className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              >
                <option value="">선택</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">영상 선택</label>
              <div className="mb-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setVideoSourceTab("playlist")}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    videoSourceTab === "playlist" ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-700 dark:bg-zinc-700 dark:text-slate-200"
                  }`}
                >
                  등록된 재생목록
                </button>
                <button
                  type="button"
                  onClick={() => setVideoSourceTab("single")}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    videoSourceTab === "single" ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-700 dark:bg-zinc-700 dark:text-slate-200"
                  }`}
                >
                  등록된 영상
                </button>
              </div>
              {(playlistGroups.length > 0 || standaloneVideos.length > 0) && (
                <input
                  type="text"
                  value={videoSearchTitle}
                  onChange={(e) => setVideoSearchTitle(e.target.value)}
                  placeholder="제목으로 검색..."
                  className="mb-3 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                />
              )}

              <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-zinc-700">
                {videoSourceTab === "playlist" ? (
                  filteredPlaylistGroups.length === 0 ? (
                    <p className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">
                      {videoSearchTitle.trim() && (playlistGroups.length > 0 || standaloneVideos.length > 0)
                        ? "제목에 맞는 영상이 없습니다."
                        : "등록된 재생목록이 없습니다."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-zinc-700">
                      {filteredPlaylistGroups.map((group) => {
                        const ids = group.videos.map((v) => v.id);
                        const allInGroupSelected = ids.length > 0 && ids.every((id) => bulkAssignVideoIds.includes(id));
                        const isExpanded = expandedCourseId === group.courseId;
                        return (
                          <li key={group.courseId ?? "none"} className="bg-white dark:bg-zinc-900">
                            <button
                              type="button"
                              onClick={() => setExpandedCourseId(isExpanded ? null : (group.courseId as string | null))}
                              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-zinc-800/50"
                            >
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={allInGroupSelected}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    if (allInGroupSelected) {
                                      setBulkAssignVideoIds((prev) => prev.filter((id) => !ids.includes(id)));
                                    } else {
                                      setBulkAssignVideoIds((prev) => [...new Set([...prev, ...ids])]);
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="font-semibold text-slate-800 dark:text-white">{group.courseTitle}</span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">({group.videos.length}개 영상)</span>
                              </div>
                              <span className="text-sm text-slate-500">{isExpanded ? "접기 ▲" : "영상 보기 ▼"}</span>
                            </button>
                            {isExpanded && (
                              <ul className="divide-y divide-slate-100 bg-slate-50/50 dark:divide-zinc-800 dark:bg-zinc-800/30">
                                {group.videos.map((v) => (
                                  <li key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                                    <input
                                      type="checkbox"
                                      checked={bulkAssignVideoIds.includes(v.id)}
                                      onChange={() => toggleBulkVideo(v.id)}
                                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-200 dark:bg-zinc-700">
                                      <img src={getThumbnailUrl(v.video_id)} alt="" className="h-full w-full object-cover" />
                                    </div>
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-white">{v.title}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : (
                  filteredStandaloneVideos.length === 0 ? (
                    <p className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">
                      {videoSearchTitle.trim() && standaloneVideos.length > 0 ? "제목에 맞는 영상이 없습니다." : "등록된 영상이 없습니다."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-zinc-700">
                      {filteredStandaloneVideos.map((v) => (
                        <li key={v.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-zinc-800/50">
                          <input
                            type="checkbox"
                            checked={bulkAssignVideoIds.includes(v.id)}
                            onChange={() => toggleBulkVideo(v.id)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-200 dark:bg-zinc-700">
                            <img src={getThumbnailUrl(v.video_id)} alt="" className="h-full w-full object-cover" />
                          </div>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-white">{v.title}</span>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            </div>

            {bulkAssignMessage && (
              <p className={bulkAssignMessage.type === "error" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                {bulkAssignMessage.text}
              </p>
            )}
            <button
              type="submit"
              disabled={bulkAssignLoading || !bulkAssignClassId || bulkAssignVideoIds.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {bulkAssignLoading ? "배정 중..." : "선택 영상 선택 반에 배정"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
