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
  /** 학년 (중1~고3). 없으면 null */
  grade?: string | null;
  enrollment_status?: "enrolled" | "withdrawn";
  /** 담당 강사 profile id */
  teacher_id?: string | null;
}

interface TeacherRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface ClassRow {
  id: string;
  title: string;
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
  teachers: TeacherRow[];
  classes: ClassRow[];
  at: number;
} | null = null;

export default function AdminDashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [students, setStudents] = useState<Profile[]>([]);
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

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [updatingClassId, setUpdatingClassId] = useState<string | null>(null);
  const [enrollmentTab, setEnrollmentTab] = useState<"enrolled" | "withdrawn">("enrolled");
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
  /** 학생 목록 정렬 기준: 기본, 학년별, 반별 */
  const [studentSort, setStudentSort] = useState<"none" | "grade" | "class">("none");
  /** 학생 이름 검색어 */
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  /** 목록 탭: 학생 | 강사 */
  const [listTab, setListTab] = useState<"students" | "teachers">("students");
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [addTeacherLoginId, setAddTeacherLoginId] = useState("");
  const [addTeacherPassword, setAddTeacherPassword] = useState("");
  const [addTeacherName, setAddTeacherName] = useState("");
  const [addTeacherLoading, setAddTeacherLoading] = useState(false);
  const [addTeacherMessage, setAddTeacherMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [assignTeacherId, setAssignTeacherId] = useState<string | null>(null);
  const [assignTeacherSelectedIds, setAssignTeacherSelectedIds] = useState<Set<string>>(new Set());
  const [assignTeacherSaving, setAssignTeacherSaving] = useState(false);

  async function load() {
    if (!supabase) {
      setLoading(false);
      return;
    }

    const now = Date.now();
    const useCache = dashboardCache && now - dashboardCache.at < DASHBOARD_CACHE_TTL_MS;
    if (useCache && dashboardCache) {
      setStudents(dashboardCache.students);
      setTeachers(dashboardCache.teachers);
      setClasses(dashboardCache.classes);
      setLoading(false);
    }

    const { data: { session } } = await supabase.auth.getSession();
    const authHeaders: Record<string, string> = session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};
    const [studentsRes, teachersRes, classesRes] = await Promise.all([
      fetch("/api/admin/students", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/admin/teachers", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
      supabase.from("classes").select("id, title").order("title"),
    ]);

    const nextStudents = Array.isArray(studentsRes) ? (studentsRes as Profile[]) : [];
    const nextTeachers = Array.isArray(teachersRes) ? (teachersRes as TeacherRow[]) : [];
    const nextClasses = (classesRes.error ? [] : (classesRes.data as ClassRow[]) ?? []);

    setStudents(nextStudents);
    setTeachers(nextTeachers);
    setClasses(nextClasses);
    setLoading(false);

    dashboardCache = {
      students: nextStudents,
      teachers: nextTeachers,
      classes: nextClasses,
      at: Date.now(),
    };
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    load();
    return () => {
      // 배정목록 탭으로 갔다가 돌아올 때마다 최신 데이터 로드하도록 캐시 비우기
      dashboardCache = null;
    };
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

  async function handleAddTeacher(e: React.FormEvent) {
    e.preventDefault();
    setAddTeacherMessage(null);
    const loginId = addTeacherLoginId.trim().toLowerCase();
    if (!loginId) {
      setAddTeacherMessage({ type: "error", text: "아이디를 입력해 주세요." });
      return;
    }
    if (!addTeacherPassword || addTeacherPassword.length < 4) {
      setAddTeacherMessage({ type: "error", text: "비밀번호는 4자 이상 입력해 주세요." });
      return;
    }
    if (!addTeacherName.trim()) {
      setAddTeacherMessage({ type: "error", text: "강사 이름을 입력해 주세요." });
      return;
    }
    setAddTeacherLoading(true);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const res = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : "",
        },
        body: JSON.stringify({
          login_id: loginId,
          password: addTeacherPassword,
          full_name: addTeacherName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "강사 등록 실패");
      setAddTeacherMessage({ type: "success", text: `${addTeacherName.trim()} 강사가 등록되었습니다.` });
      setAddTeacherLoginId("");
      setAddTeacherPassword("");
      setAddTeacherName("");
      dashboardCache = null;
      await load();
    } catch (err: unknown) {
      setAddTeacherMessage({
        type: "error",
        text: err instanceof Error ? err.message : "강사 등록에 실패했습니다.",
      });
    } finally {
      setAddTeacherLoading(false);
    }
  }

  async function handleSaveAssignTeacher() {
    if (!assignTeacherId || !supabase) return;
    setAssignTeacherSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/students/assign-teacher", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : "",
        },
        body: JSON.stringify({
          teacherId: assignTeacherId,
          studentIds: Array.from(assignTeacherSelectedIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "저장 실패");
      setAssignTeacherId(null);
      setAssignTeacherSelectedIds(new Set());
      dashboardCache = null;
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setAssignTeacherSaving(false);
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
      const { data: inserted, error } = await supabase
        .from("assignments")
        .insert({
          user_id: assignUserId,
          video_id: videoDbId,
          is_completed: false,
          progress_percent: 0,
          last_position: 0,
          is_visible: true,
          is_weekly_assignment: false,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") throw new Error("이미 해당 학생에게 배정된 영상입니다.");
        throw new Error(error.message);
      }
      setAssignMessage({ type: "success", text: "영상이 할당되었습니다." });
      setAssignUrl("");
      setAssignUserId(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token && inserted?.id) {
        fetch("/api/revalidate-student", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ assignmentIds: [inserted.id] }),
          cache: "no-store",
        }).catch(() => {});
      }
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
      const { data: inserted, error } = await supabase
        .from("assignments")
        .insert({
          user_id: assignUserId,
          video_id: videoDbId,
          is_completed: false,
          progress_percent: 0,
          last_position: 0,
          is_visible: true,
          is_weekly_assignment: false,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") throw new Error("이미 해당 학생에게 배정된 영상입니다.");
        throw new Error(error.message);
      }
      setAssignMessage({ type: "success", text: "영상이 할당되었습니다." });
      dashboardCache = null;
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token && inserted?.id) {
        fetch("/api/revalidate-student", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ assignmentIds: [inserted.id] }),
          cache: "no-store",
        }).catch(() => {});
      }
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
      const newIds: string[] = [];
      for (const videoId of videoIds) {
        const { data: row, error } = await supabase
          .from("assignments")
          .insert({
            user_id: assignUserId,
            video_id: videoId,
            is_completed: false,
            progress_percent: 0,
            last_position: 0,
            is_visible: true,
            is_weekly_assignment: false,
          })
          .select("id")
          .single();
        if (error) {
          if (error.code === "23505") skipped += 1;
          else throw new Error(error.message);
        } else {
          inserted += 1;
          if (row?.id) newIds.push(row.id);
        }
      }
      setAssignMessage({
        type: "success",
        text: `재생목록 전체 할당 완료. ${inserted}건 배정${skipped > 0 ? ` (이미 있던 ${skipped}건 제외)` : ""}`,
      });
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token && newIds.length > 0) {
        fetch("/api/revalidate-student", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ assignmentIds: newIds }),
          cache: "no-store",
        }).catch(() => {});
      }
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
      const text = await res.text();
      const data = text ? (JSON.parse(text) as { error?: string }) : {};
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
      const resText = await res.text();
      const reEnrollData = resText ? (JSON.parse(resText) as { error?: string }) : {};
      if (!res.ok) {
        const data = reEnrollData;
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

  async function handleStudentGradeChange(studentId: string, grade: string | null) {
    if (!supabase) return;
    try {
      await supabase.from("profiles").update({ grade: grade || null }).eq("id", studentId);
      // 로컬 상태도 즉시 반영
      setStudents((prev) =>
        prev.map((s) => (s.id === studentId ? { ...s, grade: grade || null } : s))
      );
    } catch {
      // 무시 (간단한 편집 기능이므로 알림만 없어도 무방)
    }
  }

  const searchLower = studentSearchQuery.trim().toLowerCase();
  const studentsFiltered = students
    .filter((s) => (s.enrollment_status ?? "enrolled") === enrollmentTab)
    .filter(
      (s) =>
        !searchLower ||
        (s.full_name ?? "").toLowerCase().includes(searchLower) ||
        (s.email ?? "").toLowerCase().includes(searchLower)
    );

  const gradeOrder = ["중1", "중2", "중3", "고1", "고2", "고3"] as const;
  const gradeRank: Record<string, number> = gradeOrder.reduce(
    (acc, g, idx) => ({ ...acc, [g]: idx }),
    {} as Record<string, number>
  );

  const getClassTitle = (classId: string | null) => {
    if (!classId) return "";
    const found = classes.find((c) => c.id === classId);
    return found?.title ?? "";
  };

  const studentsSorted = [...studentsFiltered].sort((a, b) => {
    if (studentSort === "grade") {
      const ra = gradeRank[a.grade ?? ""] ?? 999;
      const rb = gradeRank[b.grade ?? ""] ?? 999;
      if (ra !== rb) return ra - rb;
      return (a.full_name ?? "").localeCompare(b.full_name ?? "");
    }
    if (studentSort === "class") {
      const ca = getClassTitle(a.class_id);
      const cb = getClassTitle(b.class_id);
      if (ca !== cb) return ca.localeCompare(cb);
      return (a.full_name ?? "").localeCompare(b.full_name ?? "");
    }
    return 0;
  });

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

  const getTeacherName = (teacherId: string | null | undefined) => {
    if (!teacherId) return null;
    return teachers.find((t) => t.id === teacherId)?.full_name ?? null;
  };

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
        학생 목록 · 영상 할당 · 모니터링
      </h1>
      <p className="text-slate-600 dark:text-slate-400">
        학생 등록, 학년·반 설정, 영상 할당, 퇴원·재원·리포트 관리를 할 수 있습니다. 배정된 영상의 진도·상세·우선 학습·스킵 방지는 배정 목록 탭에서 설정하세요.
      </p>

      {/* 학생 / 강사 목록 전환 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">목록:</span>
          <button
            type="button"
            onClick={() => setListTab("students")}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              listTab === "students"
                ? "bg-indigo-600 text-white"
                : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
            }`}
          >
            학생 목록
          </button>
          <button
            type="button"
            onClick={() => setListTab("teachers")}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              listTab === "teachers"
                ? "bg-indigo-600 text-white"
                : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
            }`}
          >
            강사 목록
          </button>
        </div>
      </section>

      {listTab === "students" && (
      <>
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
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={studentSearchQuery}
              onChange={(e) => setStudentSearchQuery(e.target.value)}
              placeholder="학생 이름 검색"
              className="min-w-[140px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-slate-500"
            />
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
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">정렬 기준</span>
              <button
                type="button"
                onClick={() => setStudentSort("grade")}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  studentSort === "grade"
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
                }`}
              >
                학년별
              </button>
              <button
                type="button"
                onClick={() => setStudentSort("class")}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  studentSort === "class"
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
                }`}
              >
                반별
              </button>
            </div>
          </div>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-zinc-700">
          {studentsSorted.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
              {studentSearchQuery.trim()
                ? "검색 결과가 없습니다. 다른 이름으로 검색해 보세요."
                : enrollmentTab === "enrolled"
                  ? "재원생이 없습니다. 위에서 학생을 등록해 주세요."
                  : "퇴원생이 없습니다."}
            </div>
          ) : (
            studentsSorted.map((s) => (
              <div key={s.id} className="px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {s.full_name || s.email || s.id.slice(0, 8)}
                      {getTeacherName(s.teacher_id) && (
                        <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                          강사: {getTeacherName(s.teacher_id)}
                        </span>
                      )}
                    </span>
                    <select
                      value={s.grade ?? ""}
                      onChange={(e) => handleStudentGradeChange(s.id, e.target.value || null)}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                    >
                      <option value="">학년 선택</option>
                      <option value="중1">중1</option>
                      <option value="중2">중2</option>
                      <option value="중3">중3</option>
                      <option value="고1">고1</option>
                      <option value="고2">고2</option>
                      <option value="고3">고3</option>
                    </select>
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

              </div>
            ))
          )}
        </div>
      </section>
      </>
      )}

      {listTab === "teachers" && (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">강사 등록</h2>
            <form onSubmit={handleAddTeacher} className="flex flex-wrap items-end gap-4">
              <div className="min-w-[120px]">
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">아이디</label>
                <input
                  type="text"
                  value={addTeacherLoginId}
                  onChange={(e) => setAddTeacherLoginId(e.target.value)}
                  placeholder="영문 소문자, 숫자"
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                />
              </div>
              <div className="min-w-[160px]">
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">초기 비밀번호</label>
                <input
                  type="password"
                  value={addTeacherPassword}
                  onChange={(e) => setAddTeacherPassword(e.target.value)}
                  placeholder="4자 이상"
                  minLength={4}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                />
              </div>
              <div className="min-w-[160px]">
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">강사 이름</label>
                <input
                  type="text"
                  value={addTeacherName}
                  onChange={(e) => setAddTeacherName(e.target.value)}
                  placeholder="홍길동"
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                />
              </div>
              <button
                type="submit"
                disabled={addTeacherLoading}
                className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {addTeacherLoading ? "등록 중..." : "강사 등록"}
              </button>
              {addTeacherMessage && (
                <span className={addTeacherMessage.type === "error" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                  {addTeacherMessage.text}
                </span>
              )}
            </form>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="border-b border-slate-200 px-6 py-4 text-lg font-semibold text-slate-800 dark:border-zinc-700 dark:text-white">강사 목록</h2>
            <div className="divide-y divide-slate-100 dark:divide-zinc-700">
              {teachers.length === 0 ? (
                <div className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">등록된 강사가 없습니다.</div>
              ) : (
                teachers.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                    <span className="font-medium text-slate-900 dark:text-white">
                      {t.full_name || t.email || t.id.slice(0, 8)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAssignTeacherId(t.id);
                        setAssignTeacherSelectedIds(new Set(students.filter((s) => s.teacher_id === t.id).map((s) => s.id)));
                      }}
                      className="rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                    >
                      학생 할당
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}

      {/* 강사별 학생 할당 모달 */}
      {assignTeacherId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">학생 할당</h3>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
              담당할 학생을 선택하세요. (재원생만 표시)
            </p>
            <ul className="max-h-60 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-zinc-700">
              {students
                .filter((s) => (s.enrollment_status ?? "enrolled") === "enrolled")
                .map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`assign-${s.id}`}
                      checked={assignTeacherSelectedIds.has(s.id)}
                      onChange={(e) => {
                        setAssignTeacherSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(s.id);
                          else next.delete(s.id);
                          return next;
                        });
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor={`assign-${s.id}`} className="cursor-pointer text-sm text-slate-800 dark:text-slate-200">
                      {s.full_name || s.email || s.id.slice(0, 8)}
                    </label>
                  </li>
                ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setAssignTeacherId(null); setAssignTeacherSelectedIds(new Set()); }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 dark:border-zinc-600 dark:text-slate-200"
              >
                취소
              </button>
              <button
                type="button"
                disabled={assignTeacherSaving}
                onClick={handleSaveAssignTeacher}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {assignTeacherSaving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
