"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { extractYoutubeVideoId } from "@/lib/youtube";
import LoadingSpinner from "@/components/LoadingSpinner";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  report_token: string | null;
  is_report_enabled: boolean;
  parent_phone: string | null;
  class_id: string | null;
  enrollment_status?: "enrolled" | "withdrawn";
}

interface ClassRow {
  id: string;
  title: string;
}

// Supabase 조인 결과가 videos를 배열로 반환할 수 있어 단일·배열 모두 허용
interface AssignmentWithVideo {
  id: string;
  user_id: string;
  is_completed: boolean;
  progress_percent: number;
  last_position: number;
  last_watched_at: string | null;
  prevent_skip?: boolean;
  videos:
    | { id: string; title: string; video_id: string; course_id: string | null; courses?: { id: string; title: string } | { id: string; title: string }[] | null }
    | { id: string; title: string; video_id: string; course_id: string | null; courses?: { id: string; title: string } | { id: string; title: string }[] | null }[]
    | null;
}

interface LibraryVideo {
  id: string;
  title: string;
  video_id: string;
  course_id: string | null;
  courses?: { id: string; title: string } | { id: string; title: string }[] | null;
}

interface LibraryCourseGroup {
  courseId: string | null;
  courseTitle: string;
  videos: LibraryVideo[];
}

/** 대시보드 데이터 캐시 (탭 이동 시 즉시 표시, 30초 유효) */
const DASHBOARD_CACHE_TTL_MS = 30 * 1000;

const ENROLLMENT_STATUS_MIGRATION_SQL = `-- profiles에 재원/퇴원 상태 컬럼 추가
alter table public.profiles
  add column if not exists enrollment_status text not null default 'enrolled'
  check (enrollment_status in ('enrolled', 'withdrawn'));

comment on column public.profiles.enrollment_status is 'enrolled: 재원생, withdrawn: 퇴원생';`;
let dashboardCache: {
  students: Profile[];
  assignmentsByUser: Record<string, AssignmentWithVideo[]>;
  classes: ClassRow[];
  at: number;
} | null = null;

export default function AdminDashboardPage() {
  const [mounted, setMounted] = useState(false);
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
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [reportToggleUserId, setReportToggleUserId] = useState<string | null>(null);
  const [skipToggleAssignmentId, setSkipToggleAssignmentId] = useState<string | null>(null);
  const [watchStartsModal, setWatchStartsModal] = useState<{ assignmentId: string; videoTitle: string } | null>(null);
  const [watchStartsList, setWatchStartsList] = useState<{ id: string; started_at: string }[]>([]);
  const [watchStartsLoading, setWatchStartsLoading] = useState(false);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [updatingClassId, setUpdatingClassId] = useState<string | null>(null);
  const [enrollmentTab, setEnrollmentTab] = useState<"enrolled" | "withdrawn">("enrolled");
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  /** 학생별 배정 영상에서 펼친 재생목록: studentId -> courseId (null이면 재생목록 목록 보기) */
  const [expandedPlaylistByStudent, setExpandedPlaylistByStudent] = useState<Record<string, string | null>>({});
  const [reEnrollUserId, setReEnrollUserId] = useState<string | null>(null);
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);

  const [showAssignFromLibrary, setShowAssignFromLibrary] = useState(false);
  const [libraryGroups, setLibraryGroups] = useState<LibraryCourseGroup[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [assignFromLibraryVideoId, setAssignFromLibraryVideoId] = useState<string | null>(null);
  const [assignPlaylistCourseKey, setAssignPlaylistCourseKey] = useState<string | null>(null);
  const [expandedLibraryCourseKey, setExpandedLibraryCourseKey] = useState<string | null>(null);
  const [librarySearchTitle, setLibrarySearchTitle] = useState("");

  async function load() {
    if (!supabase) {
      setLoading(false);
      return;
    }

    const now = Date.now();
    const useCache = dashboardCache && now - dashboardCache.at < DASHBOARD_CACHE_TTL_MS;
    if (useCache && dashboardCache) {
      setStudents(dashboardCache.students);
      setAssignmentsByUser(dashboardCache.assignmentsByUser);
      setClasses(dashboardCache.classes);
      setLoading(false);
    }

    const { data: { session } } = await supabase.auth.getSession();
    const authHeaders: Record<string, string> = session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};
    const [studentsRes, assignmentsRes, classesRes] = await Promise.all([
      fetch("/api/admin/students", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
      supabase
        .from("assignments")
        .select("id, user_id, is_completed, progress_percent, last_position, last_watched_at, prevent_skip, videos(id, title, video_id, course_id, courses(id, title))")
        .order("last_watched_at", { ascending: false }),
      supabase.from("classes").select("id, title").order("title"),
    ]);

    const nextStudents = Array.isArray(studentsRes) ? (studentsRes as Profile[]) : [];
    let nextByUser: Record<string, AssignmentWithVideo[]> = {};
    if (!assignmentsRes.error && assignmentsRes.data != null) {
      const list = ((assignmentsRes.data ?? []) as unknown) as AssignmentWithVideo[];
      list.forEach((a) => {
        if (!nextByUser[a.user_id]) nextByUser[a.user_id] = [];
        nextByUser[a.user_id].push(a);
      });
    } else if (assignmentsRes.error) {
      const fallback = await supabase
        .from("assignments")
        .select("id, user_id, is_completed, progress_percent, last_position, last_watched_at, videos(id, title, video_id, course_id, courses(id, title))")
        .order("last_watched_at", { ascending: false });
      if (!fallback.error && fallback.data) {
        (fallback.data as AssignmentWithVideo[]).forEach((a) => {
          if (!nextByUser[a.user_id]) nextByUser[a.user_id] = [];
          nextByUser[a.user_id].push(a);
        });
      }
    }
    const nextClasses = (classesRes.error ? [] : (classesRes.data as ClassRow[]) ?? []);

    setStudents(nextStudents);
    setAssignmentsByUser(nextByUser);
    setClasses(nextClasses);
    setLoading(false);

    dashboardCache = {
      students: nextStudents,
      assignmentsByUser: nextByUser,
      classes: nextClasses,
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
      dashboardCache = null;
      await load();
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
        // 새 영상인 경우 YouTube에서 제목을 가져와 저장 시 사용
        let title = `영상 ${videoId}`;
        try {
          const res = await fetch("/api/youtube-title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: assignUrl }),
          });
          const data = await res.json();
          if (res.ok && data.title) {
            title = data.title as string;
          }
        } catch {
          // 실패 시 기본 제목 유지
        }

        const { data: inserted, error: insertErr } = await supabase
          .from("videos")
          .insert({ title, video_id: videoId })
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
        is_visible: true,
        is_weekly_assignment: false,
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

  async function loadLibrary() {
    if (!supabase) return;
    setLibraryLoading(true);
    setLibraryGroups([]);
    try {
      const { data, error } = await supabase
        .from("videos")
        .select("id, title, video_id, course_id, sort_order, created_at, courses(id, title, sort_order)")
        .order("created_at", { ascending: false });
      if (error) {
        const { data: fallback, error: err2 } = await supabase
          .from("videos")
          .select("id, title, video_id, course_id, courses(id, title)")
          .order("created_at", { ascending: false });
        if (err2) throw err2;
        const list = (fallback ?? []) as LibraryVideo[];
        const normalized = list.map((row) => ({
          ...row,
          courses: Array.isArray(row.courses) ? row.courses[0] ?? null : row.courses ?? null,
        }));
        const byCourse = new Map<string | null, typeof normalized>();
        for (const v of normalized) {
          const cid = v.course_id ?? null;
          if (!byCourse.has(cid)) byCourse.set(cid, []);
          byCourse.get(cid)!.push(v);
        }
        const groups: LibraryCourseGroup[] = [];
        byCourse.forEach((videos, courseId) => {
          const courseTitle = videos[0]?.courses && !Array.isArray(videos[0].courses) ? (videos[0].courses as { title: string }).title : "기타 동영상";
          groups.push({ courseId, courseTitle, videos });
        });
        groups.sort((a, b) => {
          if (a.courseId == null) return 1;
          if (b.courseId == null) return -1;
          return a.courseTitle.localeCompare(b.courseTitle);
        });
        setLibraryGroups(groups);
        setLibraryLoading(false);
        return;
      }
      const list = (data ?? []) as (LibraryVideo & { sort_order?: number; courses?: { id: string; title: string; sort_order?: number } | null })[];
      const normalized = list.map((row) => ({
        ...row,
        sort_order: row.sort_order ?? 0,
        courses: Array.isArray(row.courses) ? row.courses[0] ?? null : row.courses ?? null,
      }));
      const byCourse = new Map<string | null, typeof normalized>();
      for (const v of normalized) {
        const cid = v.course_id ?? null;
        if (!byCourse.has(cid)) byCourse.set(cid, []);
        byCourse.get(cid)!.push(v);
      }
      const groups: LibraryCourseGroup[] = [];
      byCourse.forEach((videos, courseId) => {
        const courseTitle = videos[0]?.courses && !Array.isArray(videos[0].courses) ? (videos[0].courses as { title: string }).title : "기타 동영상";
        const courseSortOrder = (videos[0]?.courses && !Array.isArray(videos[0].courses) ? (videos[0].courses as { sort_order?: number }).sort_order : undefined) ?? 0;
        const sortedVideos = [...videos].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || ((a as any).created_at ?? "").localeCompare((b as any).created_at ?? "")
        );
        groups.push({ courseId, courseTitle, videos: sortedVideos });
      });
      groups.sort((a, b) => {
        if (a.courseId == null) return 1;
        if (b.courseId == null) return -1;
        const aOrder = (a.videos[0]?.courses && !Array.isArray(a.videos[0].courses) ? (a.videos[0].courses as { sort_order?: number }).sort_order : undefined) ?? 0;
        const bOrder = (b.videos[0]?.courses && !Array.isArray(b.videos[0].courses) ? (b.videos[0].courses as { sort_order?: number }).sort_order : undefined) ?? 0;
        return aOrder - bOrder || a.courseTitle.localeCompare(b.courseTitle);
      });
      setLibraryGroups(groups);
    } catch (_) {
      setLibraryGroups([]);
    } finally {
      setLibraryLoading(false);
    }
  }

  async function handleAssignFromLibrary(videoDbId: string) {
    if (!assignUserId || !supabase) return;
    setAssignFromLibraryVideoId(videoDbId);
    setAssignMessage(null);
    try {
      const { error } = await supabase.from("assignments").insert({
        user_id: assignUserId,
        video_id: videoDbId,
        is_completed: false,
        progress_percent: 0,
        last_position: 0,
        is_visible: true,
        is_weekly_assignment: false,
      });
      if (error) {
        if (error.code === "23505") throw new Error("이미 해당 학생에게 배정된 영상입니다.");
        throw new Error(error.message);
      }
      setAssignMessage({ type: "success", text: "영상이 할당되었습니다." });
      dashboardCache = null;
      await load();
    } catch (err: unknown) {
      setAssignMessage({
        type: "error",
        text: err instanceof Error ? err.message : "할당에 실패했습니다.",
      });
    } finally {
      setAssignFromLibraryVideoId(null);
    }
  }

  /** 재생목록 전체 할당: 해당 목록의 모든 영상을 선택한 학생에게 한 번에 배정 (이미 배정된 건 스킵) */
  async function handleAssignPlaylistToStudent(courseKey: string, videoIds: string[]) {
    if (!assignUserId || !supabase || videoIds.length === 0) return;
    setAssignPlaylistCourseKey(courseKey);
    setAssignMessage(null);
    try {
      let inserted = 0;
      let skipped = 0;
      for (const videoId of videoIds) {
        const { error } = await supabase.from("assignments").insert({
          user_id: assignUserId,
          video_id: videoId,
          is_completed: false,
          progress_percent: 0,
          last_position: 0,
          is_visible: true,
          is_weekly_assignment: false,
        });
        if (error) {
          if (error.code === "23505") skipped += 1;
          else throw new Error(error.message);
        } else {
          inserted += 1;
        }
      }
      setAssignMessage({
        type: "success",
        text: `재생목록 전체 할당 완료. ${inserted}건 배정${skipped > 0 ? ` (이미 있던 ${skipped}건 제외)` : ""}`,
      });
      dashboardCache = null;
      await load();
    } catch (err: unknown) {
      setAssignMessage({
        type: "error",
        text: err instanceof Error ? err.message : "재생목록 전체 할당에 실패했습니다.",
      });
    } finally {
      setAssignPlaylistCourseKey(null);
    }
  }

  /** 재원생 → 퇴원 처리 (상태만 변경, 계정 유지) — 한 명만 대상 */
  async function handleWithdraw(userId: string, fullName: string) {
    const targetId = typeof userId === "string" ? userId.trim() : "";
    if (!targetId) return;
    if (!confirm(`"${fullName}" 학생을 퇴원 처리하시겠습니까?\n퇴원생 목록으로 이동하며, 계정과 진도 기록은 유지됩니다.`)) return;
    setDeleteUserId(targetId);
    setDeleteLoading(true);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const res = await fetch("/api/admin/students", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : "",
        },
        body: JSON.stringify({ user_id: targetId, enrollment_status: "withdrawn" }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || "퇴원 처리 실패";
        if (typeof msg === "string" && msg.includes("enrollment_status")) {
          setShowMigrationModal(true);
        }
        throw new Error(msg);
      }
      dashboardCache = null;
      await load();
      // 재원생 탭 유지 → 남은 학생들이 그대로 보이도록 (퇴원생은 퇴원생 탭에서 확인)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "퇴원 처리에 실패했습니다.");
    } finally {
      setDeleteUserId(null);
      setDeleteLoading(false);
    }
  }

  /** 퇴원생 → 재원 복귀 */
  async function handleReEnroll(userId: string) {
    setReEnrollUserId(userId);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const res = await fetch("/api/admin/students", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : "",
        },
        body: JSON.stringify({ user_id: userId, enrollment_status: "enrolled" }),
      });
      if (!res.ok) {
        const data = await res.json();
        const msg = data.error || "재원 복귀 실패";
        if (typeof msg === "string" && msg.includes("enrollment_status")) {
          setShowMigrationModal(true);
        }
        throw new Error(msg);
      }
      dashboardCache = null;
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "재원 복귀에 실패했습니다.");
    } finally {
      setReEnrollUserId(null);
    }
  }

  /** 퇴원생 완전 삭제 (계정·진도 기록 삭제) — 한 명만 대상 */
  async function handleDeleteStudent(userId: string, fullName: string) {
    const targetId = typeof userId === "string" ? userId.trim() : "";
    if (!targetId) return;
    if (!confirm(`"${fullName}" 학생을 완전 삭제하시겠습니까?\n계정과 진도 기록이 모두 삭제되며, 복구할 수 없습니다.`)) return;
    setDeleteUserId(targetId);
    setDeleteLoading(true);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const res = await fetch("/api/admin/students", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : "",
        },
        body: JSON.stringify({ user_id: targetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "삭제 실패");
      dashboardCache = null;
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    } finally {
      setDeleteUserId(null);
      setDeleteLoading(false);
    }
  }

  async function handleReportToggle(studentId: string, currentEnabled: boolean) {
    if (!supabase) return;
    setReportToggleUserId(studentId);
    try {
      await supabase.from("profiles").update({ is_report_enabled: !currentEnabled }).eq("id", studentId);
      load();
    } finally {
      setReportToggleUserId(null);
    }
  }

  /** 영상별 스킵 방지 on/off (DB에 prevent_skip 컬럼이 있을 때만 동작) */
  async function handleTogglePreventSkip(assignmentId: string, currentPreventSkip: boolean) {
    if (!supabase) return;
    setSkipToggleAssignmentId(assignmentId);
    try {
      const { error } = await supabase.from("assignments").update({ prevent_skip: !currentPreventSkip }).eq("id", assignmentId);
      if (error) {
        if (error.message?.includes("prevent_skip") || error.code === "42703") {
          alert("스킵 방지 설정을 사용하려면 Supabase에서 prevent_skip 컬럼을 추가해 주세요. (supabase/migration_prevent_skip.sql)");
        } else {
          alert(error.message || "설정 변경에 실패했습니다.");
        }
        return;
      }
      dashboardCache = null;
      await load();
    } finally {
      setSkipToggleAssignmentId(null);
    }
  }

  /** 학습 시작 시각 목록 모달 열기 및 데이터 로드 */
  async function openWatchStartsModal(assignmentId: string, videoTitle: string) {
    setWatchStartsModal({ assignmentId, videoTitle });
    setWatchStartsList([]);
    setWatchStartsLoading(true);
    try {
      const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } };
      const res = await fetch(
        `/api/admin/watch-starts?assignmentId=${encodeURIComponent(assignmentId)}`,
        { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} }
      );
      const data = await res.json();
      setWatchStartsList(Array.isArray(data) ? data : []);
    } catch {
      setWatchStartsList([]);
    } finally {
      setWatchStartsLoading(false);
    }
  }

  function copyReportLink(token: string) {
    const url = typeof window !== "undefined" ? `${window.location.origin}/report/${token}` : "";
    if (url && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url);
      alert("리포트 링크가 클립보드에 복사되었습니다. 카톡 등으로 학부모에게 보내주세요.");
    } else {
      prompt("아래 링크를 복사하세요.", url);
    }
  }

  async function handleStudentClassChange(studentId: string, classId: string | null) {
    if (!supabase) return;
    setUpdatingClassId(studentId);
    try {
      await supabase.from("profiles").update({ class_id: classId || null }).eq("id", studentId);
      load();
    } finally {
      setUpdatingClassId(null);
    }
  }

  function formatLastWatched(at: string | null) {
    if (!at) return "-";
    const d = new Date(at);
    return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  }

  const studentsFiltered = students.filter(
    (s) => (s.enrollment_status ?? "enrolled") === enrollmentTab
  );

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
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          퇴원/재원 버튼이 안 되면{" "}
          <button
            type="button"
            onClick={() => setShowMigrationModal(true)}
            className="text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400"
          >
            enrollment_status 컬럼 추가 안내
          </button>
        </p>
      </section>

      {/* enrollment_status 마이그레이션 안내 모달 */}
      {showMigrationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
              퇴원/재원 기능 사용을 위한 설정
            </h3>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
              Supabase 대시보드 → <strong>SQL Editor</strong> → 새 쿼리에서 아래 SQL을 붙여넣고 <strong>Run</strong>을 눌러 주세요. 한 번만 실행하면 됩니다.
            </p>
            <pre className="mb-4 overflow-x-auto rounded-lg bg-slate-100 p-4 text-xs text-slate-800 dark:bg-zinc-800 dark:text-slate-200">
              {ENROLLMENT_STATUS_MIGRATION_SQL}
            </pre>
            {migrationError && (
              <p className="mb-3 text-sm text-red-600 dark:text-red-400">{migrationError}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={migrationRunning}
                onClick={async () => {
                  setMigrationError(null);
                  setMigrationRunning(true);
                  try {
                    const { data: { session } } = await supabase!.auth.getSession();
                    const res = await fetch("/api/admin/migration/enrollment-status", {
                      method: "POST",
                      headers: {
                        Authorization: session?.access_token ? `Bearer ${session.access_token}` : "",
                      },
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      setMigrationError(data.error || "실행 실패");
                      if (data.sql) navigator.clipboard?.writeText(data.sql);
                      return;
                    }
                    setShowMigrationModal(false);
                    dashboardCache = null;
                    await load();
                    alert("enrollment_status 컬럼이 추가되었습니다. 퇴원/재원 기능을 사용할 수 있습니다.");
                  } catch (e) {
                    setMigrationError(e instanceof Error ? e.message : "실행 중 오류가 발생했습니다.");
                  } finally {
                    setMigrationRunning(false);
                  }
                }}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {migrationRunning ? "실행 중…" : "앱에서 실행 (DATABASE_URL 설정 시)"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMigrationError(null);
                  navigator.clipboard?.writeText(ENROLLMENT_STATUS_MIGRATION_SQL);
                  alert("SQL이 클립보드에 복사되었습니다. Supabase SQL Editor에 붙여넣고 실행하세요.");
                }}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                SQL 복사
              </button>
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-zinc-600 dark:text-slate-200 dark:hover:bg-zinc-800"
              >
                Supabase 대시보드 (프로젝트 → SQL Editor)
              </a>
              <button
                type="button"
                onClick={() => {
                  setShowMigrationModal(false);
                  setMigrationError(null);
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-zinc-600 dark:text-slate-200 dark:hover:bg-zinc-800"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 학생 목록 + 영상 할당 + 모니터링 */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-zinc-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-white">
            학생 목록
          </h2>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setEnrollmentTab("enrolled")}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                enrollmentTab === "enrolled"
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
              }`}
            >
              재원생
            </button>
            <button
              type="button"
              onClick={() => setEnrollmentTab("withdrawn")}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                enrollmentTab === "withdrawn"
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
              }`}
            >
              퇴원생
            </button>
          </div>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-zinc-700">
          {studentsFiltered.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
              {enrollmentTab === "enrolled"
                ? "재원생이 없습니다. 위에서 학생을 등록해 주세요."
                : "퇴원생이 없습니다."}
            </div>
          ) : (
            studentsFiltered.map((s) => (
              <div key={s.id} className="px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {s.full_name || s.email || s.id.slice(0, 8)}
                    </span>
                    <select
                      value={s.class_id ?? ""}
                      onChange={(e) => handleStudentClassChange(s.id, e.target.value || null)}
                      disabled={updatingClassId === s.id}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                    >
                      <option value="">반 없음</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setAssignUserId(assignUserId === s.id ? null : s.id);
                        setAssignUrl("");
                        setAssignMessage(null);
                        if (assignUserId === s.id) setShowAssignFromLibrary(false);
                      }}
                      className="rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                    >
                      {assignUserId === s.id ? "취소" : "영상 할당"}
                    </button>
                    {enrollmentTab === "enrolled" ? (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleWithdraw(s.id, s.full_name || s.email || "이 학생");
                          }}
                          disabled={deleteLoading}
                          className="rounded-lg bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
                        >
                          {deleteUserId === s.id ? "처리 중..." : "퇴원 처리"}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteStudent(s.id, s.full_name || s.email || "이 학생");
                          }}
                          disabled={deleteLoading}
                          className="rounded-lg bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60"
                        >
                          {deleteUserId === s.id ? "삭제 중..." : "완전 삭제"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleReEnroll(s.id);
                          }}
                          disabled={reEnrollUserId !== null}
                          className="rounded-lg bg-green-100 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-200 disabled:opacity-50 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60"
                        >
                          {reEnrollUserId === s.id ? "처리 중..." : "재원 복귀"}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteStudent(s.id, s.full_name || s.email || "이 학생");
                          }}
                          disabled={deleteLoading}
                          className="rounded-lg bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60"
                        >
                          {deleteUserId === s.id ? "삭제 중..." : "완전 삭제"}
                        </button>
                      </>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-600 dark:text-slate-400">리포트 공유</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={s.is_report_enabled ?? false}
                        disabled={reportToggleUserId !== null}
                        onClick={() => handleReportToggle(s.id, s.is_report_enabled ?? false)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${
                          s.is_report_enabled
                            ? "border-indigo-500 bg-indigo-600"
                            : "border-slate-300 bg-slate-200 dark:border-zinc-600 dark:bg-zinc-700"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                            s.is_report_enabled ? "translate-x-5" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {(s.is_report_enabled && s.report_token) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 dark:bg-zinc-800">
                    <span className="text-sm text-slate-600 dark:text-slate-400">학부모 리포트 URL:</span>
                    <code className="max-w-full truncate rounded bg-slate-200 px-2 py-1 text-xs dark:bg-zinc-700">
                      {typeof window !== "undefined" ? `${window.location.origin}/report/${s.report_token}` : `/report/${s.report_token}`}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyReportLink(s.report_token!)}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                    >
                      링크 복사
                    </button>
                  </div>
                )}

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

                {assignUserId === s.id && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => {
                        const next = !showAssignFromLibrary;
                        setShowAssignFromLibrary(next);
                        if (next) {
                          loadLibrary();
                          setExpandedLibraryCourseKey(null);
                        }
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-slate-200 dark:hover:bg-zinc-700"
                    >
                      {showAssignFromLibrary ? "등록된 목록 접기" : "등록된 재생목록/동영상에서 할당"}
                    </button>
                    {showAssignFromLibrary && (
                      <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white dark:border-zinc-600 dark:bg-zinc-800">
                        {libraryLoading ? (
                          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">불러오는 중...</p>
                        ) : libraryGroups.length === 0 ? (
                          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">등록된 재생목록/동영상이 없습니다.</p>
                        ) : (
                          <>
                            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white p-2 dark:border-zinc-600 dark:bg-zinc-800">
                              <input
                                type="text"
                                value={librarySearchTitle}
                                onChange={(e) => setLibrarySearchTitle(e.target.value)}
                                placeholder="제목으로 검색..."
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white"
                              />
                            </div>
                            <ul className="divide-y divide-slate-200 dark:divide-zinc-600">
                              {libraryGroups
                                .map((grp) => {
                                  const searchLower = librarySearchTitle.trim().toLowerCase();
                                  const filteredVideos = searchLower
                                    ? grp.videos.filter((v) => (v.title || "").toLowerCase().includes(searchLower))
                                    : grp.videos;
                                  return { ...grp, filteredVideos };
                                })
                                .filter((grp) => grp.filteredVideos.length > 0)
                                .map((grp) => {
                                  const courseKey = grp.courseId ?? "single";
                                  const isExpanded = expandedLibraryCourseKey === courseKey;
                                  return (
                                    <li key={courseKey}>
                                      <div className="flex w-full items-center justify-between gap-2 bg-slate-50 px-3 py-2.5 dark:bg-zinc-700">
                                        <button
                                          type="button"
                                          onClick={() => setExpandedLibraryCourseKey(isExpanded ? null : courseKey)}
                                          className="flex flex-1 items-center justify-between text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-zinc-600"
                                        >
                                          <span>{grp.courseTitle}</span>
                                          <span className="text-slate-400 dark:text-slate-500">
                                            {grp.filteredVideos.length}개 · {isExpanded ? "접기" : "펼치기"}
                                          </span>
                                        </button>
                                        <button
                                          type="button"
                                          disabled={assignPlaylistCourseKey === courseKey}
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleAssignPlaylistToStudent(courseKey, grp.videos.map((v) => v.id));
                                          }}
                                          className="shrink-0 rounded bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                                        >
                                          {assignPlaylistCourseKey === courseKey ? "할당 중…" : "재생목록 전체 할당"}
                                        </button>
                                      </div>
                                      {isExpanded && (
                                        <ul className="divide-y divide-slate-100 dark:divide-zinc-700">
                                          {grp.filteredVideos.map((v) => (
                                        <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2">
                                          <span className="min-w-0 truncate text-sm text-slate-800 dark:text-slate-200" title={v.title}>
                                            {v.title}
                                          </span>
                                          <a
                                            href={`https://www.youtube.com/watch?v=${v.video_id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="shrink-0 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                                          >
                                            보기
                                          </a>
                                          <button
                                            type="button"
                                            disabled={assignFromLibraryVideoId === v.id}
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              handleAssignFromLibrary(v.id);
                                            }}
                                            className="shrink-0 rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                                          >
                                            {assignFromLibraryVideoId === v.id ? "할당 중..." : "할당"}
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                            </ul>
                            {librarySearchTitle.trim() &&
                              libraryGroups.every((grp) => {
                                const searchLower = librarySearchTitle.trim().toLowerCase();
                                return !grp.videos.some((v) => (v.title || "").toLowerCase().includes(searchLower));
                              }) && (
                                <p className="p-4 text-sm text-slate-500 dark:text-slate-400">제목에 맞는 영상이 없습니다.</p>
                              )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      const next = expandedStudentId === s.id ? null : s.id;
                      setExpandedStudentId(next);
                      if (next === s.id) setExpandedPlaylistByStudent((p) => ({ ...p, [s.id]: null }));
                    }}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
                  >
                    {expandedStudentId === s.id ? "배정된 영상 접기" : "배정된 영상 보기"}
                    {(assignmentsByUser[s.id] ?? []).length > 0 && (
                      <span className="ml-1.5 text-slate-500">
                        ({(assignmentsByUser[s.id] ?? []).length}개)
                      </span>
                    )}
                  </button>
                  {expandedStudentId === s.id && (() => {
                    const list = assignmentsByUser[s.id] ?? [];
                    const NONE_KEY = "__none__";
                    const groups = (() => {
                      const map = new Map<string, { courseTitle: string; assignments: AssignmentWithVideo[] }>();
                      for (const a of list) {
                        const v = Array.isArray(a.videos) ? a.videos[0] : a.videos;
                        const key = v?.course_id ?? NONE_KEY;
                        const courseTitle = (() => {
                          if (!v?.courses) return "기타 동영상";
                          const c = Array.isArray(v.courses) ? v.courses[0] : v.courses;
                          return (c as { title?: string })?.title ?? "기타 동영상";
                        })();
                        if (!map.has(key)) map.set(key, { courseTitle, assignments: [] });
                        map.get(key)!.assignments.push(a);
                      }
                      return Array.from(map.entries()).map(([courseKey, { courseTitle, assignments }]) => ({ courseKey, courseTitle, assignments }));
                    })();
                    const selectedKey = expandedPlaylistByStudent[s.id];
                    const showPlaylistList = selectedKey == null;

                    if (list.length === 0) {
                      return (
                        <div className="mt-3 rounded-lg border border-slate-200 px-4 py-4 text-sm text-slate-500 dark:border-zinc-700 dark:text-slate-400">
                          할당된 영상 없음
                        </div>
                      );
                    }
                    if (showPlaylistList) {
                      return (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">재생목록을 선택하면 해당 영상 목록을 볼 수 있습니다.</p>
                          <ul className="space-y-1.5 rounded-lg border border-slate-200 dark:border-zinc-700">
                            {groups.map(({ courseKey, courseTitle, assignments }) => (
                              <li key={courseKey}>
                                <button
                                  type="button"
                                  onClick={() => setExpandedPlaylistByStudent((p) => ({ ...p, [s.id]: courseKey }))}
                                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-zinc-800/50"
                                >
                                  <span className="truncate">{courseTitle}</span>
                                  <span className="ml-2 shrink-0 text-slate-500 dark:text-slate-400">({assignments.length}개 영상) →</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    }
                    const current = groups.find((g) => g.courseKey === selectedKey);
                    const showList = current?.assignments ?? [];
                    return (
                      <div className="mt-3 space-y-2">
                        <button
                          type="button"
                          onClick={() => setExpandedPlaylistByStudent((p) => ({ ...p, [s.id]: null }))}
                          className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          ← 재생목록으로
                        </button>
                        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-zinc-700">
                          <table className="w-full min-w-[400px] text-sm">
                            <thead>
                              <tr className="bg-slate-50 text-left text-slate-500 dark:bg-zinc-800 dark:text-slate-400">
                                <th className="px-4 py-2 pr-4">영상</th>
                                <th className="px-4 py-2 pr-4">진도율</th>
                                <th className="px-4 py-2 pr-4">마지막 시청</th>
                                <th className="px-4 py-2 pr-4">학습 시작</th>
                                <th className="px-4 py-2">스킵 방지</th>
                              </tr>
                            </thead>
                            <tbody>
                              {showList.map((a) => {
                                const video = Array.isArray(a.videos) ? a.videos[0] : a.videos;
                                const preventSkip = a.prevent_skip !== false;
                                return (
                                  <tr key={a.id} className="border-t border-slate-100 dark:border-zinc-700/50">
                                    <td className="px-4 py-2 pr-4 font-medium text-slate-800 dark:text-slate-200">
                                      {video?.title ?? "-"}
                                    </td>
                                    <td className="px-4 py-2 pr-4">
                                      <span className={a.is_completed ? "text-green-600 dark:text-green-400" : "text-slate-600 dark:text-slate-400"}>
                                        {a.progress_percent.toFixed(1)}%
                                      </span>
                                    </td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                                      {formatLastWatched(a.last_watched_at)}
                                    </td>
                                    <td className="px-4 py-2 pr-4">
                                      <button
                                        type="button"
                                        onClick={() => openWatchStartsModal(a.id, video?.title ?? "영상")}
                                        className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                                      >
                                        학습 시작 시간 모두 보기
                                      </button>
                                    </td>
                                    <td className="px-4 py-2">
                                      <button
                                        type="button"
                                        disabled={skipToggleAssignmentId === a.id}
                                        onClick={() => handleTogglePreventSkip(a.id, preventSkip)}
                                        role="switch"
                                        aria-checked={preventSkip}
                                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${
                                          preventSkip
                                            ? "border-indigo-500 bg-indigo-600"
                                            : "border-slate-300 bg-slate-200 dark:border-zinc-600 dark:bg-zinc-700"
                                        }`}
                                        title={preventSkip ? "스킵 방지 켜짐 (끄려면 클릭)" : "스킵 방지 꺼짐 (켜려면 클릭)"}
                                      >
                                        <span
                                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                                            preventSkip ? "translate-x-5" : "translate-x-1"
                                          }`}
                                        />
                                      </button>
                                      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                                        {preventSkip ? "켜짐" : "꺼짐"}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* 학습 시작 시각 목록 모달 */}
      {watchStartsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setWatchStartsModal(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="watch-starts-modal-title"
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-4 py-3 dark:border-zinc-700">
              <h2 id="watch-starts-modal-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                학습 시작 시각
              </h2>
              <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400" title={watchStartsModal.videoTitle}>
                {watchStartsModal.videoTitle}
              </p>
            </div>
            <div className="max-h-[50vh] overflow-y-auto px-4 py-3">
              {watchStartsLoading ? (
                <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">불러오는 중...</p>
              ) : watchStartsList.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                  아직 기록된 학습 시작 시각이 없습니다. (학생이 이 영상 시청 페이지에 들어온 적이 없습니다)
                </p>
              ) : (
                <ul className="space-y-2">
                  {watchStartsList.map((row) => (
                    <li key={row.id} className="text-sm text-slate-800 dark:text-slate-200">
                      {new Date(row.started_at).toLocaleString("ko-KR", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        hour12: false,
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-slate-200 px-4 py-3 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setWatchStartsModal(null)}
                className="w-full rounded-lg bg-slate-200 py-2 text-sm font-medium text-slate-800 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
