"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import LoadingSpinner from "@/components/LoadingSpinner";

interface StudentSummary {
  id: string;
  full_name: string | null;
  email: string | null;
  grade?: string | null;
  class_id: string | null;
}

interface ClassRow {
  id: string;
  title: string;
}

export default function TeacherClassesPage() {
  const [mounted, setMounted] = useState(false);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const h: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
    const [studentsRes, classesRes] = await Promise.all([
      fetch("/api/teacher/students", { headers: h, cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/teacher/classes", { headers: h, cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    ]);
    setStudents(Array.isArray(studentsRes) ? studentsRes : []);
    setClasses(Array.isArray(classesRes) ? classesRes : []);
    setLoading(false);
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

  const byClass = new Map<string | null, StudentSummary[]>();
  for (const s of students) {
    const cid = s.class_id ?? null;
    const list = byClass.get(cid) ?? [];
    list.push(s);
    byClass.set(cid, list);
  }
  const unassigned = byClass.get(null) ?? [];
  const classIds = classes.map((c) => c.id);
  const getTitle = (classId: string | null) => {
    if (!classId) return "반 미배정";
    return classes.find((c) => c.id === classId)?.title ?? classId;
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
        반 관리
      </h1>
      <p className="text-slate-600 dark:text-slate-400">
        담당 학생만 반별로 확인할 수 있습니다. 반 배정 변경은 대시보드에서 학생별로 할 수 있습니다.
      </p>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="divide-y divide-slate-100 dark:divide-zinc-700">
          {classIds.map((classId) => {
            const list = byClass.get(classId) ?? [];
            const title = getTitle(classId);
            return (
              <div key={classId} className="px-6 py-4">
                <h2 className="mb-2 text-lg font-semibold text-slate-800 dark:text-white">
                  {title}
                  <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                    ({list.length}명)
                  </span>
                </h2>
                {list.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">담당 학생이 이 반에 없습니다.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {list.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-800 dark:bg-zinc-700 dark:text-slate-200"
                      >
                        {s.full_name || s.email || s.id.slice(0, 8)}
                        {s.grade ? ` (${s.grade})` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {unassigned.length > 0 && (
            <div className="px-6 py-4">
              <h2 className="mb-2 text-lg font-semibold text-slate-800 dark:text-white">
                반 미배정
                <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                  ({unassigned.length}명)
                </span>
              </h2>
              <ul className="flex flex-wrap gap-2">
                {unassigned.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
                  >
                    {s.full_name || s.email || s.id.slice(0, 8)}
                    {s.grade ? ` (${s.grade})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {classes.length === 0 && unassigned.length === 0 && (
          <div className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
            담당 학생이 없습니다.
          </div>
        )}
      </section>
    </div>
  );
}
