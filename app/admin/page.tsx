"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { extractYoutubeVideoId } from "@/lib/youtube";

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
  videos:
    | { id: string; title: string; video_id: string }
    | { id: string; title: string; video_id: string }[]
    | null;
}

/** 대시보드 데이터 캐시 (탭 이동 시 즉시 표시, 30초 유효) */
const DASHBOARD_CACHE_TTL_MS = 30 * 1000;
let dashboardCache: {
  students: Profile[];
  assignmentsByUser: Record<string, AssignmentWithVideo[]>;
  classes: ClassRow[];
  at: number;
} | null = null;

export default function AdminDashboardPage() {
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

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [updatingClassId, setUpdatingClassId] = useState<string | null>(null);
  const [enrollmentTab, setEnrollmentTab] = useState<"enrolled" | "withdrawn">("enrolled");
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [reEnrollUserId, setReEnrollUserId] = useState<string | null>(null);

  async function load() {
    if (!supabase) return;

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
        .select("id, user_id, is_completed, progress_percent, last_position, last_watched_at, videos(id, title, video_id)")
        .order("last_watched_at", { ascending: false }),
      supabase.from("classes").select("id, title").order("title"),
    ]);

    const nextStudents = Array.isArray(studentsRes) ? (studentsRes as Profile[]) : [];
    let nextByUser: Record<string, AssignmentWithVideo[]> = {};
    if (!assignmentsRes.error) {
      const list = ((assignmentsRes.data ?? []) as unknown) as AssignmentWithVideo[];
      list.forEach((a) => {
        if (!nextByUser[a.user_id]) nextByUser[a.user_id] = [];
        nextByUser[a.user_id].push(a);
      });
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
    load();
  }, []);

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
      // 등록된 학생을 즉시 목록에 반영 (서버 재조회 전에도 보이도록)
      const newProfile: Profile = {
        id: data.id,
        full_name: data.full_name ?? null,
        email: data.email ?? null,
        report_token: null,
        is_report_enabled: false,
        parent_phone: null,
        class_id: null,
        enrollment_status: "enrolled",
      };
      setStudents((prev) => [...prev, newProfile].sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")));
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

  /** 재원생 → 퇴원 처리 (상태만 변경, 계정 유지) */
  async function handleWithdraw(userId: string, fullName: string) {
    if (!confirm(`"${fullName}" 학생을 퇴원 처리하시겠습니까?\n퇴원생 목록으로 이동하며, 계정과 진도 기록은 유지됩니다.`)) return;
    setDeleteUserId(userId);
    setDeleteLoading(true);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const res = await fetch("/api/admin/students", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : "",
        },
        body: JSON.stringify({ user_id: userId, enrollment_status: "withdrawn" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "퇴원 처리 실패");
      load();
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
        throw new Error(data.error || "재원 복귀 실패");
      }
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "재원 복귀에 실패했습니다.");
    } finally {
      setReEnrollUserId(null);
    }
  }

  /** 퇴원생 완전 삭제 (계정·진도 기록 삭제) */
  async function handleDeleteStudent(userId: string, fullName: string) {
    if (!confirm(`"${fullName}" 학생을 완전 삭제하시겠습니까?\n계정과 진도 기록이 모두 삭제되며, 복구할 수 없습니다.`)) return;
    setDeleteUserId(userId);
    setDeleteLoading(true);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      const res = await fetch("/api/admin/students", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : "",
        },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "삭제 실패");
      load();
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
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
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
      </section>

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
                      }}
                      className="rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                    >
                      {assignUserId === s.id ? "취소" : "영상 할당"}
                    </button>
                    {enrollmentTab === "enrolled" ? (
                      <button
                        type="button"
                        onClick={() => handleWithdraw(s.id, s.full_name || s.email || "이 학생")}
                        disabled={deleteLoading}
                        className="rounded-lg bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
                      >
                        {deleteUserId === s.id ? "처리 중..." : "퇴원 처리"}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleReEnroll(s.id)}
                          disabled={reEnrollUserId !== null}
                          className="rounded-lg bg-green-100 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-200 disabled:opacity-50 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60"
                        >
                          {reEnrollUserId === s.id ? "처리 중..." : "재원 복귀"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteStudent(s.id, s.full_name || s.email || "이 학생")}
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

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setExpandedStudentId(expandedStudentId === s.id ? null : s.id)}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
                  >
                    {expandedStudentId === s.id ? "배정된 영상 접기" : "배정된 영상 보기"}
                    {(assignmentsByUser[s.id] ?? []).length > 0 && (
                      <span className="ml-1.5 text-slate-500">
                        ({(assignmentsByUser[s.id] ?? []).length}개)
                      </span>
                    )}
                  </button>
                  {expandedStudentId === s.id && (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-zinc-700">
                      <table className="w-full min-w-[400px] text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-left text-slate-500 dark:bg-zinc-800 dark:text-slate-400">
                            <th className="px-4 py-2 pr-4">영상</th>
                            <th className="px-4 py-2 pr-4">진도율</th>
                            <th className="px-4 py-2">마지막 시청</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(assignmentsByUser[s.id] ?? []).length === 0 ? (
                            <tr>
                              <td colSpan={3} className="px-4 py-4 text-slate-500 dark:text-slate-400">
                                할당된 영상 없음
                              </td>
                            </tr>
                          ) : (
                            (assignmentsByUser[s.id] ?? []).map((a) => {
                              const video = Array.isArray(a.videos) ? a.videos[0] : a.videos;
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
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
