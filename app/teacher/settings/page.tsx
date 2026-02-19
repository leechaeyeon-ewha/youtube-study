"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import LoadingSpinner from "@/components/LoadingSpinner";

type AuthSessionResponse = { data: { session: Session | null } };

export default function TeacherSettingsPage() {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!supabase || !mounted) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }: AuthSessionResponse) => {
      const email = session?.user?.email ?? null;
      setCurrentEmail(email);
      setEmailInput(email ?? "");
      setLoading(false);
    });
  }, [mounted]);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setEmailMessage(null);
    const email = emailInput.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setEmailMessage({ type: "error", text: "올바른 이메일을 입력해 주세요." });
      return;
    }
    setEmailSaving(true);
    try {
      const { data: sessionData }: AuthSessionResponse = await supabase.auth.getSession() as AuthSessionResponse;
      const session = sessionData.session;
      const res = await fetch("/api/teacher/email", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ email }),
      });
      const resultData = await res.json().catch((): Record<string, unknown> => ({})) as { error?: string };
      if (!res.ok) {
        setEmailMessage({ type: "error", text: resultData.error || "이메일 저장에 실패했습니다." });
        return;
      }
      setCurrentEmail(email);
      setEmailInput(email);
      setEmailMessage({ type: "success", text: "이메일이 저장되었습니다. 비밀번호 찾기 시 사용됩니다." });
    } catch {
      setEmailMessage({ type: "error", text: "이메일 저장에 실패했습니다." });
    } finally {
      setEmailSaving(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMessage(null);
    if (newPassword.length < 4) {
      setPasswordMessage({ type: "error", text: "비밀번호는 4자 이상 입력해 주세요." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: "error", text: "비밀번호가 일치하지 않습니다." });
      return;
    }
    if (!supabase) return;
    setPasswordSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordMessage({ type: "success", text: "비밀번호가 변경되었습니다." });
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      setPasswordMessage({
        type: "error",
        text: err instanceof Error ? err.message : "비밀번호 변경에 실패했습니다.",
      });
    } finally {
      setPasswordSaving(false);
    }
  }

  if (!mounted) return null;
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
        계정 설정
      </h1>
      <p className="text-slate-600 dark:text-slate-400">
        이메일 등록(비밀번호 찾기용)과 비밀번호 변경을 할 수 있습니다.
      </p>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">
          이메일 등록 (비밀번호 찾기용)
        </h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          비밀번호 분실 시 이메일로 재설정 링크를 받을 수 있도록 이메일을 등록해 두세요.
        </p>
        <form onSubmit={handleEmailSubmit} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">이메일</span>
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="example@email.com"
              className="min-w-[220px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-slate-500"
            />
          </label>
          <button
            type="submit"
            disabled={emailSaving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {emailSaving ? "저장 중..." : "저장"}
          </button>
        </form>
        {currentEmail && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            현재 로그인 이메일: {currentEmail}
          </p>
        )}
        {emailMessage && (
          <div
            className={`mt-3 rounded px-3 py-2 text-sm ${
              emailMessage.type === "error"
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
            }`}
          >
            {emailMessage.text}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-white">
          비밀번호 변경
        </h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          새 비밀번호를 입력해 변경할 수 있습니다.
        </p>
        <form onSubmit={handlePasswordSubmit} className="flex max-w-md flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">새 비밀번호</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="4자 이상"
              autoComplete="new-password"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-slate-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">비밀번호 확인</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="다시 입력"
              autoComplete="new-password"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder:text-slate-500"
            />
          </label>
          <button
            type="submit"
            disabled={passwordSaving}
            className="w-fit rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {passwordSaving ? "변경 중..." : "비밀번호 변경"}
          </button>
        </form>
        {passwordMessage && (
          <div
            className={`mt-3 rounded px-3 py-2 text-sm ${
              passwordMessage.type === "error"
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
            }`}
          >
            {passwordMessage.text}
          </div>
        )}
      </section>
    </div>
  );
}
