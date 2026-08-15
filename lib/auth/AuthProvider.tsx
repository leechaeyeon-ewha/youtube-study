"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import type { Profile, ProfileRole } from "@/lib/types";
import { setAuthSync } from "@/lib/auth/accessTokenStore";
import { AuthContext, type AuthContextValue } from "@/lib/auth/useAuth";

const LOGIN_PROFILE_SEED_KEY = "youtube_study_auth_me_cache";

function clearAuthClientStorage(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(LOGIN_PROFILE_SEED_KEY);
  } catch {
    // ignore
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.includes("auth-token")) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }
}

function readLoginProfileSeed(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LOGIN_PROFILE_SEED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile & { at?: number };
    if (!parsed.id || !parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface AuthProviderProps {
  children: React.ReactNode;
  /** 이 zone에서 허용할 role 목록 */
  allowedRoles: ProfileRole[];
  /** role이 allowedRoles에 없을 때 redirect 경로 (null이면 /login) */
  resolveWrongRoleRedirect: (role: ProfileRole | null) => string;
}

export function AuthProvider({
  children,
  allowedRoles,
  resolveWrongRoleRedirect,
}: AuthProviderProps) {
  const router = useRouter();
  const logoutOnceRef = useRef(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isReady, setIsReady] = useState(false);

  const applySession = useCallback((token: string | null, uid: string | null, nextProfile: Profile | null) => {
    setAccessToken(token);
    setUserId(uid);
    setProfile(nextProfile);
    setAuthSync(token, uid);
  }, []);

  const redirectToLogin = useCallback(() => {
    applySession(null, null, null);
    setIsReady(true);
    router.replace("/login");
  }, [applySession, router]);

  const fetchProfile = useCallback(
    async (token: string): Promise<Profile | null> => {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = (err as { error?: string })?.error?.includes("프로필") ? "no_profile" : "";
        router.replace(msg ? `/login?error=${msg}` : "/login");
        return null;
      }
      return (await res.json()) as Profile;
    },
    [router]
  );

  const completeAuth = useCallback(
    async (token: string, uid: string, seedProfile?: Profile | null) => {
      let nextProfile = seedProfile ?? null;
      if (!nextProfile || !allowedRoles.includes(nextProfile.role)) {
        nextProfile = await fetchProfile(token);
        if (!nextProfile) return;
      }

      if (!allowedRoles.includes(nextProfile.role)) {
        applySession(null, null, null);
        setIsReady(true);
        router.replace(resolveWrongRoleRedirect(nextProfile.role));
        return;
      }

      applySession(token, uid, nextProfile);
      setIsReady(true);
    },
    [allowedRoles, applySession, fetchProfile, resolveWrongRoleRedirect, router]
  );

  const finishLogout = useCallback(() => {
    if (logoutOnceRef.current) return;
    logoutOnceRef.current = true;
    clearAuthClientStorage();
    applySession(null, null, null);
    setIsReady(false);
    if (typeof window !== "undefined") {
      window.location.replace("/login");
      return;
    }
    router.replace("/login");
  }, [applySession, router]);

  useEffect(() => {
    if (!supabase) {
      setIsReady(true);
      return;
    }

    let cancelled = false;

    async function init() {
      const client = supabase;
      if (!client) {
        setIsReady(true);
        return;
      }

      const { data: { session } } = await client.auth.getSession();
      if (cancelled) return;

      if (!session?.access_token || !session.user?.id) {
        redirectToLogin();
        return;
      }

      const seed = readLoginProfileSeed();
      await completeAuth(session.access_token, session.user.id, seed);
    }

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
      if (cancelled) return;

      if (event === "SIGNED_OUT") {
        finishLogout();
        return;
      }

      if (event === "TOKEN_REFRESHED" && session?.access_token) {
        setAccessToken(session.access_token);
        setAuthSync(session.access_token, session.user?.id ?? userId);
        return;
      }

      if (event === "SIGNED_IN" && session?.access_token && session.user?.id) {
        setIsReady(false);
        await completeAuth(session.access_token, session.user.id);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount 1회 + supabase listener
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (supabase) {
        await supabase.auth.signOut({ scope: "local" });
      }
    } catch {
      // 네트워크 오류 등 — 로컬 세션은 finishLogout에서 정리
    }
    finishLogout();
  }, [finishLogout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      userId,
      profile,
      role: profile?.role ?? null,
      isReady,
      signOut,
    }),
    [accessToken, userId, profile, isReady, signOut]
  );

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (!accessToken || !profile) {
    return null;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
