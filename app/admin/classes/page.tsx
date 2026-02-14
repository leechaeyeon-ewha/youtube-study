"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getThumbnailUrl } from "@/lib/youtube";

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
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<Profile[]>([]);
  const [assignmentsByUser, setAssignmentsByUser] = useState<Record<string, AssignmentWithVideo[]>>({});
  const [classProgress, setClassProgress] = useState<Record<string, number>>({});
  const [courseGroups, setCourseGroups] = useState<CourseGroup[]>([]);

  const [newClassTitle, setNewClassTitle] = useState("");
  const [addClassLoading, setAddClassLoading] = useState(false);

  const [bulkAssignClassId, setBulkAssignClassId] = useState("");
  const [bulkAssignVideoIds, setBulkAssignVideoIds] = useState<string[]>([]);
  const [bulkAssignLoading, setBulkAssignLoading] = useState(false);
  const [bulkAssignMessage, setBulkAssignMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const [videoSourceTab, setVideoSourceTab] = useState<"playlist" | "single">("playlist");
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);

  async function load() {
    if (!supabase) return;
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
    load();
  }, []);

  const playlistGroups = courseGroups.filter((g) => g.courseId !== null);
  const allVideos = courseGroups.flatMap((g) => g.videos);
  const standaloneVideos = allVideos.filter((v) => !v.course_id);

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
    await supabase.from("profiles").update({ class_id: null }).eq("class_id", classId);
    await supabase.from("classes").delete().eq("id", classId);
    load();
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
      for (const videoId of bulkAssignVideoIds) {
        for (const userId of studentIds) {
          const { error } = await supabase.from("assignments").insert({
            user_id: userId,
            video_id: videoId,
            is_completed: false,
            progress_percent: 0,
            last_position: 0,
            is_visible: true,
            is_weekly_assignment: false,
          });
          if (!error) inserted += 1;
        }
      }
      const className = classes.find((c) => c.id === bulkAssignClassId)?.title ?? "반";
      setBulkAssignMessage({ type: "success", text: `${className}에 ${inserted}건 배정되었습니다. (이미 있던 건 제외)` });
      setBulkAssignVideoIds([]);
      load();
    } catch (err) {
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

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">반 관리</h1>

      {/* 반별 평균 진도율 */}
      {classes.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">반별 평균 진도율</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {classes.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50"
              >
                <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">{c.title}</p>
                <p className="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400">{classProgress[c.id] ?? 0}%</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{students.filter((s) => s.class_id === c.id).length}명</p>
              </div>
            ))}
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
                <span className="font-medium text-slate-800 dark:text-white">{c.title}</span>
                <button type="button" onClick={() => handleDeleteClass(c.id)} className="text-red-600 hover:underline dark:text-red-400">
                  삭제
                </button>
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

              <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-zinc-700">
                {videoSourceTab === "playlist" ? (
                  playlistGroups.length === 0 ? (
                    <p className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">등록된 재생목록이 없습니다.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-zinc-700">
                      {playlistGroups.map((group) => {
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
                  standaloneVideos.length === 0 ? (
                    <p className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">등록된 영상이 없습니다.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-zinc-700">
                      {standaloneVideos.map((v) => (
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
