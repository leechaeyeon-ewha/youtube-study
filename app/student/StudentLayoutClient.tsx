"use client";

import { AuthProvider } from "@/lib/auth/AuthProvider";
import type { ProfileRole } from "@/lib/types";

export default function StudentLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider
      allowedRoles={["student", "teacher"]}
      resolveWrongRoleRedirect={(role: ProfileRole | null) => {
        if (role === "admin") return "/admin";
        return "/login";
      }}
    >
      {children}
    </AuthProvider>
  );
}
