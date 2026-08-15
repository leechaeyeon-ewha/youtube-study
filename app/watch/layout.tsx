"use client";

import StudentLayoutClient from "@/app/student/StudentLayoutClient";

/** 시청 페이지 — student zone과 동일한 auth (student·teacher 허용) */
export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return <StudentLayoutClient>{children}</StudentLayoutClient>;
}
