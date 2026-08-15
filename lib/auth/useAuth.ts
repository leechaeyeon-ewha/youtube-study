"use client";

import { createContext, useContext } from "react";
import type { Profile, ProfileRole } from "@/lib/types";

export interface AuthContextValue {
  accessToken: string | null;
  userId: string | null;
  profile: Profile | null;
  role: ProfileRole | null;
  isReady: boolean;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

/** AuthProvider가 children을 렌더할 때 profile은 항상 존재 */
export function useAuthProfile(): Profile {
  const { profile } = useAuth();
  if (!profile) {
    throw new Error("useAuthProfile must be used when profile is available");
  }
  return profile;
}

/** API fetch용 Authorization 헤더 (클라이언트 컴포넌트) */
export function useAuthHeaders(): Record<string, string> {
  const { accessToken } = useAuth();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}
