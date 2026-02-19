"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";
import LoadingSpinner from "@/components/LoadingSpinner";

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function check() {
      const client = supabase;
      if (!client) {
        setLoading(false);
        return;
      }
      const { data: { session } } = await client.auth.getSession();
      if (cancelled) return;
      if (!session?.access_token) {
        setLoading(false);
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
        setLoading(false);
        router.replace(msg ? `/login?error=${msg}` : "/");
        return;
      }
      const profileData = (await res.json()) as { role?: string } | null;
      if (cancelled) return;
      if (profileData?.role !== "teacher") {
        setLoading(false);
        if (profileData?.role === "admin") router.replace("/admin");
        else if (profileData?.role === "student") router.replace("/student");
        else router.replace("/");
        return;
      }
      setProfile(profileData as Profile);
      setLoading(false);
    }
    check();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-zinc-950">
        <LoadingSpinner />
      </div>
    );
  }

  if (!profile) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-zinc-950">
      <LoadingSpinner />
    </div>
  );

  const nav = [
    { href: "/teacher", label: "대시보드" },
    { href: "/teacher/videos", label: "영상 관리" },
    { href: "/teacher/classes", label: "반 관리" },
    { href: "/teacher/assign", label: "배정 목록" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-2.5 md:px-4 md:py-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-6">
            <Link
              href="/teacher"
              className="truncate text-base font-bold text-slate-800 dark:text-white hover:underline md:text-lg"
              title="영어는 김현정 영어전문학원"
            >
              <span className="md:hidden">김현정 영어</span>
              <span className="hidden md:inline">영어는 김현정 영어전문학원</span>
            </Link>
            <span className="hidden flex-shrink-0 text-slate-400 dark:text-zinc-500 md:inline">|</span>
            <span className="hidden flex-shrink-0 text-sm font-medium text-slate-600 dark:text-slate-400 md:inline">
              강사
            </span>
            <nav className="hidden gap-1 md:flex">
              {nav.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    pathname === href
                      ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="hidden flex-shrink-0 items-center gap-4 md:flex">
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {profile.full_name ?? profile.email ?? "강사"}
            </span>
            <Link
              href="/"
              className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
            >
              학생 화면
            </Link>
            <button
              type="button"
              onClick={async () => {
                if (!supabase) return;
                await supabase.auth.signOut();
                router.replace("/login");
                router.refresh();
              }}
              className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-600"
            >
              로그아웃
            </button>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((o) => !o)}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-zinc-800 md:hidden"
            aria-label={mobileMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? (
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900 md:hidden">
            <nav className="flex flex-col gap-0.5">
              {nav.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-lg px-3 py-2.5 text-sm font-medium ${
                    pathname === href
                      ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                      : "text-slate-700 dark:text-slate-300"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-zinc-700">
              <span className="w-full truncate text-xs text-slate-500 dark:text-slate-400">
                {profile.full_name ?? profile.email ?? "강사"}
              </span>
              <Link
                href="/"
                className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:bg-zinc-700 dark:text-slate-200"
              >
                학생 화면
              </Link>
              <button
                type="button"
                onClick={async () => {
                  if (!supabase) return;
                  await supabase.auth.signOut();
                  router.replace("/login");
                  router.refresh();
                }}
                className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:bg-zinc-700 dark:text-slate-200"
              >
                로그아웃
              </button>
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
