"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import LoadingSpinner from "@/components/LoadingSpinner";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  report_token: string | null;
  is_report_enabled: boolean;
  parent_phone: string | null;
  class_id: string | null;
  grade?: string | null;
  enrollment_status?: "enrolled" | "withdrawn";
  teacher_id?: string | null;
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
  courses?: { id: string; title: string } | null;
}

interface LibraryCourseGroup {
  courseId: string | null;
  courseTitle: string;
  videos: LibraryVideo[];
}

export default function TeacherDashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [students, setStudents] = useState<Profile[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingClassId, setUpdatingClassId] = useState<string | null>(null);
  const [reportToggleUserId, setReportToggleUserId] = useState<string | null>(null);
  const [assignUserId, setAssignUserId] = useState<string | null>(null);
  const [showAssignFromLibrary, setShowAssignFromLibrary] = useState(false);
  const [libraryGroups, setLibraryGroups] = useState<LibraryCourseGroup[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [assignFromLibraryVideoId, setAssignFromLibraryVideoId] = useState<string | null>(null);
  const [assignMessage, setAssignMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  const [addFullName, setAddFullName] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addMessage, setAddMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function load() {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const authHeaders: Record<string, string> = session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};
    try {
      const [studentsRes, classesRes] = await Promise.all([
        fetch("/api/teacher/students", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
        fetch("/api/teacher/classes", { headers: authHeaders }).then((r) => (r.ok ? r.json() : [])),
      ]);
      setStudents(Array.isArray(studentsRes) ? (studentsRes as Profile[]) : []);
      setClasses(Array.isArray(classesRes) ? (classesRes as ClassRow[]) : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && supabase) load();
  }, [mounted]);

  async function loadLibrary() {
    if (!supabase) return;
    setLibraryLoading(true);
    setLibraryGroups([]);
    try {
      const { data, error } = await supabase
        .from("videos")
        .select("id, title, video_id, course_id, courses(id, title)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const list = (data ?? []) as LibraryVideo[];
      const byCourse = new Map<string | null, LibraryVideo[]>();
      for (const v of list) {
        const cid = v.course_id ?? null;
        if (!byCourse.has(cid)) byCourse.set(cid, []);
        byCourse.get(cid)!.push(v);
      }
      const groups: LibraryCourseGroup[] = [];
      byCourse.forEach((videos, courseId) => {
        const courseTitle = videos[0]?.courses && typeof videos[0].courses === "object" && !Array.isArray(videos[0].courses)
          ? (videos[0].courses as { title: string }).title
          : "기타 동영상";
        groups.push({ courseId, courseTitle, videos });
      });
      groups.sort((a, b) => (a.courseTitle || "").localeCompare(b.courseTitle || ""));
      setLibraryGroups(groups);
    } catch {
      setLibraryGroups([]);
    } finally {
      setLibraryLoading(false);
    }
  }

  useEffect(() => {
    if (showAssignFromLibrary && assignUserId) loadLibrary();
  }, [showAssignFromLibrary, assignUserId]);

  async function handleStudentClassChange(studentId: string, classId: string | null) {
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    setUpdatingClassId(studentId);
    try {
      const res = await fetch("/api/teacher/students", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ student_id: studentId, class_id: classId || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "반 변경에 실패했습니다.");
        return;
      }
      await load();
    } finally {
      setUpdatingClassId(null);
    }
  }

  async function handleStudentGradeChange(studentId: string, grade: string | null) {
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    try {
      const res = await fetch("/api/teacher/students", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ student_id: studentId, grade: grade || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "학년 변경에 실패했습니다.");
        return;
      }
      setStudents((prev) =>
        prev.map((s) => (s.id === studentId ? { ...s, grade: grade || null } : s))
      );
    } catch {
      // ignore
    }
  }

  async function handleReportToggle(studentId: string, currentEnabled: boolean) {
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    setReportToggleUserId(studentId);
    try {
      const res = await fetch("/api/teacher/students", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ student_id: studentId, is_report_enabled: !currentEnabled }),
      });
      if (res.ok) await load();
    } finally {
      setReportToggleUserId(null);
    }
  }

  async function handleAssignFromLibrary(videoDbId: string) {
    if (!assignUserId) return;
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return;
    setAssignFromLibraryVideoId(videoDbId);
    setAssignMessage(null);
    try {
      const res = await fetch("/api/teacher/assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ student_id: assignUserId, video_id: videoDbId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAssignMessage({ type: "error", text: data.error || "할당에 실패했습니다." });
        return;
      }
      setAssignMessage({ type: "success", text: "영상이 할당되었습니다." });
      if (data.id) {
        fetch("/api/revalidate-student", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ assignmentIds: [data.id] }),
          cache: "no-store",
        }).catch(() => {});
      }
    } catch {
      setAssignMessage({ type: "error", text: "할당에 실패했습니다." });
    } finally {
      setAssignFromLibraryVideoId(null);
    }
  }

  function copyReportLink(token: string) {
    const url = typeof window !== "undefined" ? `${window.location.origin}/report/${token}` : "";
    if (url && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url);
      alert("리포트 링크가 클립보드에 복사되었습니다.");
    } else {
      prompt("아래 링크를 복사하세요.", url);
    }
  }

  async function handleAddStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || addLoading) return;
    const name = addFullName.trim();
    const pw = addPassword;
    if (!name) {
      setAddMessage({ type: "error", text: "이름을 입력해 주세요." });
      return;
    }
    if (!pw || pw.length < 4) {
      setAddMessage({ type: "error", text: "비밀번호는 4자 이상 입력해 주세요." });
      return;
    }
    setAddLoading(true);
    setAddMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/teacher/students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ full_name: name, password: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddMessage({ type: "error", text: (data as { error?: string }).error || "등록에 실패했습니다." });
        return;
      }
      setAddMessage({ type: "success", text: `${(data as { full_name?: string }).full_name || name} 학생이 등록되었습니다.` });
      setAddFullName("");
      setAddPassword("");
      load();
    } catch {
      setAddMessage({ type: "error", text: "등록에 실패했습니다." });
    } finally {
      setAddLoading(false);
    }
  }

  const getClassTitle = (classId: string | null) => {
    if (!classId) return "";
    return classes.find((c) => c.id === classId)?.title ?? "";
  };

  const searchLower = studentSearchQuery.trim().toLowerCase();
  const studentsFiltered = students.filter(
    (s) =>
      !searchLower ||
      (s.full_name ?? "").toLowerCase().includes(searchLower) ||
      (s.email ?? "").toLowerCase().includes(searchLower)
  );

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
        담당 학생 대시보드
      </h1>
      <p className="text-slate-600 dark:text-slate-400">
        담당 학생만 조회·관리할 수 있습니다. 학년·반 수정, 영상 배정, 리포트 공유 설정이 가능합니다.
      </p>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-zinc-700">
          <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">
            학생 등록
          </h2>
          <form onSubmit={handleAddStudent} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">이름</span>
              <input
                type="text"
                value={addFullName}
                onChange={(e) => setAddFullName(e.target.value)}
                placeholder="학생 이름"
                className="min-w-[140px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-slate-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">초기 비밀번호</span>
              <input
                type="password"
                value={addPassword}
                onChange={(e) => setAddPassword(e.target.value)}
                placeholder="4자 이상"
                autoComplete="new-password"
                className="min-w-[140px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-slate-500"
              />
            </label>
            <button
              type="submit"
              disabled={addLoading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {addLoading ? "등록 중..." : "등록"}
            </button>
          </form>
          {addMessage && (
            <div
              className={`mt-3 rounded px-3 py-2 text-sm ${
                addMessage.type === "error"
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                  : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
              }`}
            >
              {addMessage.text}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-zinc-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-white">
            담당 학생 목록
          </h2>
          <input
            type="text"
            value={studentSearchQuery}
            onChange={(e) => setStudentSearchQuery(e.target.value)}
            placeholder="학생 이름 검색"
            className="min-w-[140px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-slate-500"
          />
        </div>
        <div className="divide-y divide-slate-100 dark:divide-zinc-700">
          {studentsFiltered.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
              {studentSearchQuery.trim()
                ? "검색 결과가 없습니다."
                : "담당 학생이 없습니다. 위에서 학생을 등록하거나 관리자에게 할당을 요청하세요."}
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
                        setAssignMessage(null);
                        setShowAssignFromLibrary(assignUserId !== s.id);
                      }}
                      className="rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                    >
                      {assignUserId === s.id ? "취소" : "영상 할당"}
                    </button>
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
                  <div className="mt-4 rounded-lg bg-slate-50 p-4 dark:bg-zinc-800">
                    {assignMessage && (
                      <div
                        className={`mb-3 rounded px-3 py-2 text-sm ${
                          assignMessage.type === "error"
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                            : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                        }`}
                      >
                        {assignMessage.text}
                      </div>
                    )}
                    <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                      영상 라이브러리에서 배정할 영상을 선택하세요.
                    </p>
                    {libraryLoading ? (
                      <div className="flex items-center gap-2 py-4">
                        <LoadingSpinner />
                        <span className="text-sm text-slate-500">로딩 중...</span>
                      </div>
                    ) : (
                      <div className="max-h-60 space-y-2 overflow-y-auto">
                        {libraryGroups.map((grp) => (
                          <div key={grp.courseId ?? "none"} className="space-y-1">
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                              {grp.courseTitle}
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {grp.videos.map((v) => (
                                <button
                                  key={v.id}
                                  type="button"
                                  disabled={assignFromLibraryVideoId !== null}
                                  onClick={() => handleAssignFromLibrary(v.id)}
                                  className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-800 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600 disabled:opacity-50"
                                >
                                  {assignFromLibraryVideoId === v.id ? "처리 중..." : v.title || v.video_id}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                        {libraryGroups.length === 0 && (
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            등록된 영상이 없습니다. 영상 관리에서 새 영상을 등록할 수 있습니다.
                          </p>
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
    </div>
  );
}
