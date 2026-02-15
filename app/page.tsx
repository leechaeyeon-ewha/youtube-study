"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LoadingSpinner from "@/components/LoadingSpinner";

export default function Home() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    async function redirect() {
      const client = supabase;
      const { data: { session } } = await client.auth.getSession();
      if (cancelled) return;
      if (!session?.access_token) {
        router.replace("/login");
        return;
      }
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (cancelled) return;
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.includes("프로필") ? "no_profile" : "";
        router.replace(msg ? `/login?error=${msg}` : "/login");
        return;
      }
      const profile = await res.json();
      if (cancelled) return;
      if (profile?.role === "admin") {
        router.replace("/admin");
      } else {
        router.replace("/student");
      }
    }

    redirect();
    return () => { cancelled = true; };
    // 마운트 시 한 번만 실행. router는 안정 참조이지만 의존성에 넣으면 재실행으로 인한 루프 가능성 방지.
  }, []);

  if (!mounted) return null;

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
      <LoadingSpinner />
    </div>
  );
}
