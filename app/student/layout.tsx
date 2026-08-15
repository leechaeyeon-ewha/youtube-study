/** 배정 해제/숨김 시 학생 목록이 즉시 반영되도록 캐시 비활성화 */
export const dynamic = "force-dynamic";

import StudentLayoutClient from "./StudentLayoutClient";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <StudentLayoutClient>{children}</StudentLayoutClient>;
}
