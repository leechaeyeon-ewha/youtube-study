"use client";

import InAppBrowserGuard from "@/components/InAppBrowserGuard";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import type { ProfileRole } from "@/lib/types";

export default function StudentLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <InAppBrowserGuard className="mx-auto max-w-4xl px-4 pt-4" />
      <AuthProvider
        allowedRoles={["student", "teacher"]}
        resolveWrongRoleRedirect={(role: ProfileRole | null) => {
          if (role === "admin") return "/admin";
          return "/login";
        }}
      >
        {children}
      </AuthProvider>
    </>
  );
}
