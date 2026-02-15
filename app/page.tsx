"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (!supabase) return;
    async function redirect() {
      const client = supabase;
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) {
        router.replace("/login");
        return;
      }
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.includes("프로필") ? "no_profile" : "";
        router.replace(msg ? `/login?error=${msg}` : "/login");
        return;
      }
      const profile = await res.json();
      if (profile?.role === "admin") {
        router.replace("/admin");
      } else {
        router.replace("/student");
      }
    }

    redirect();
  }, [router]);

  if (!supabase) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-zinc-950">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Supabase 설정이 필요합니다. 환경 변수를 확인해 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-zinc-950">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
    </div>
  );
}
