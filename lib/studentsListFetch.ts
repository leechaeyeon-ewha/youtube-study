import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaginated } from "@/lib/supabasePaginatedFetch";

const STUDENT_ORDER = [{ column: "full_name", ascending: true }] as const;

/** 관리자 assign scope 학생 목록 (페이지 fetch) */
export async function fetchAdminStudentsForAssign(
  supabase: SupabaseClient
): Promise<{ data: Record<string, unknown>[]; error: string | null }> {
  const withStatus = await fetchAllPaginated<Record<string, unknown>>(supabase, {
    from: "profiles",
    select: "id, full_name, email, grade, class_id, enrollment_status, teacher_id",
    filters: { role: "student" },
    order: [...STUDENT_ORDER],
  });

  if (!withStatus.error) {
    return withStatus;
  }

  return fetchAllPaginated(supabase, {
    from: "profiles",
    select: "id, full_name, email, grade, class_id, teacher_id",
    filters: { role: "student" },
    order: [...STUDENT_ORDER],
  });
}

/** 관리자 대시보드 학생 목록 (컬럼 fallback + 페이지 fetch) */
export async function fetchAdminStudentsFull(
  supabase: SupabaseClient
): Promise<{ data: Record<string, unknown>[]; error: string | null }> {
  const baseSelect =
    "id, full_name, email, report_token, is_report_enabled, parent_phone, class_id, grade, teacher_id";

  const withStatus = await fetchAllPaginated<Record<string, unknown>>(supabase, {
    from: "profiles",
    select: `${baseSelect}, enrollment_status`,
    filters: { role: "student" },
    order: [...STUDENT_ORDER],
  });

  if (!withStatus.error) {
    return withStatus;
  }

  const baseWithoutTeacher =
    "id, full_name, email, report_token, is_report_enabled, parent_phone, class_id, grade";

  const withoutTeacher = await fetchAllPaginated<Record<string, unknown>>(supabase, {
    from: "profiles",
    select: `${baseWithoutTeacher}, enrollment_status`,
    filters: { role: "student" },
    order: [...STUDENT_ORDER],
  });

  if (!withoutTeacher.error) {
    return withoutTeacher;
  }

  return fetchAllPaginated(supabase, {
    from: "profiles",
    select: "id, full_name, email",
    filters: { role: "student" },
    order: [...STUDENT_ORDER],
  });
}

/** 강사 담당 학생 목록 (페이지 fetch) */
export async function fetchTeacherStudents(
  supabase: SupabaseClient,
  teacherId: string
): Promise<{ data: Record<string, unknown>[]; error: string | null }> {
  const baseSelect =
    "id, full_name, email, report_token, is_report_enabled, parent_phone, class_id, grade, teacher_id";

  const withStatus = await fetchAllPaginated<Record<string, unknown>>(supabase, {
    from: "profiles",
    select: `${baseSelect}, enrollment_status`,
    filters: { role: "student", teacher_id: teacherId },
    order: [...STUDENT_ORDER],
  });

  if (!withStatus.error) {
    return withStatus;
  }

  const baseWithoutTeacher =
    "id, full_name, email, report_token, is_report_enabled, parent_phone, class_id, grade";

  const withoutTeacher = await fetchAllPaginated<Record<string, unknown>>(supabase, {
    from: "profiles",
    select: `${baseWithoutTeacher}, enrollment_status`,
    filters: { role: "student", teacher_id: teacherId },
    order: [...STUDENT_ORDER],
  });

  if (!withoutTeacher.error) {
    return withoutTeacher;
  }

  return fetchAllPaginated(supabase, {
    from: "profiles",
    select: "id, full_name, email",
    filters: { role: "student", teacher_id: teacherId },
    order: [...STUDENT_ORDER],
  });
}
