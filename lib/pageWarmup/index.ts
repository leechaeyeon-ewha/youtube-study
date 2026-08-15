import { warmAdminDashboard } from "./adminDashboard";
import { warmAdminAssign } from "./adminAssign";
import { warmAdminVideos } from "./adminVideos";
import { warmAdminClasses } from "./adminClasses";
import { warmTeacherDashboard } from "./teacherDashboard";
import { warmTeacherAssign } from "./teacherAssign";
import { warmTeacherVideos } from "./teacherVideos";
import { warmTeacherClasses } from "./teacherClasses";
import { warmStudentAssignmentsList } from "@/lib/studentAssignmentsCache";

const WARMUP_BY_PATH: Record<string, () => Promise<void>> = {
  "/admin": warmAdminDashboard,
  "/admin/assign": warmAdminAssign,
  "/admin/videos": warmAdminVideos,
  "/admin/classes": warmAdminClasses,
  "/teacher": warmTeacherDashboard,
  "/teacher/assign": warmTeacherAssign,
  "/teacher/videos": warmTeacherVideos,
  "/teacher/classes": warmTeacherClasses,
};

/** nav href에 대응하는 데이터 warm-up (TTL 캐시 hit 시 no-op) */
export function getWarmUpForHref(href: string): (() => Promise<void>) | undefined {
  const path = href.split("?")[0].split("#")[0];
  return WARMUP_BY_PATH[path];
}

export { warmStudentAssignmentsList };
