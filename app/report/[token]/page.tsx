"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface ReportData {
  allowed: boolean;
  studentName?: string;
  weeklyCompletion?: number;
  monthlyCompletion?: number;
  recentVideos?: { title: string; is_completed: boolean; last_watched_at: string | null }[];
  comment?: string;
}

function CircularProgress({ percent, label }: { percent: number; label: string }) {
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const stroke = (percent / 100) * circumference;
  return (
    <div className="flex flex-col items-center">
      <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-slate-200 dark:text-zinc-700"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - stroke}
          className="text-indigo-600 dark:text-indigo-400 transition-all duration-500"
        />
      </svg>
      <span className="mt-2 text-2xl font-bold text-slate-800 dark:text-white">{percent}%</span>
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
    </div>
  );
}

export default function ReportPage() {
  const params = useParams();
  const token = params?.token as string | undefined;
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setData({ allowed: false });
      return;
    }
    fetch(`/api/report/${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((json: ReportData) => {
        setData(json);
      })
      .catch(() => setData({ allowed: false }))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 dark:bg-zinc-950">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (!data?.allowed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-zinc-950">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-lg font-medium text-slate-800 dark:text-white">접근 권한이 없습니다.</p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            링크가 만료되었거나 공유가 비활성화되었습니다.
          </p>
        </div>
      </div>
    );
  }

  const week = data.weeklyCompletion ?? 0;
  const month = data.monthlyCompletion ?? 0;
  const recentVideos = data.recentVideos ?? [];

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-zinc-950">
      <div className="mx-auto max-w-lg">
        <header className="mb-8 text-center">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white sm:text-2xl">
            {data.studentName} 학생
          </h1>
          <p className="mt-1 text-lg font-semibold text-indigo-600 dark:text-indigo-400">
            주간 학습 리포트
          </p>
        </header>

        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-6 text-center text-sm font-medium text-slate-500 dark:text-slate-400">
            과제 이수율
          </h2>
          <div className="flex justify-center gap-12 sm:gap-16">
            <CircularProgress percent={week} label="이번 주 (최근 7일)" />
            <CircularProgress percent={month} label="이번 달 (최근 30일)" />
          </div>
        </section>

        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-base font-semibold text-slate-800 dark:text-white">
            학습 이력 (최근 7일)
          </h2>
          {recentVideos.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
              최근 시청한 영상이 없습니다.
            </p>
          ) : (
            <ul className="space-y-3">
              {recentVideos.map((v, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 py-3 px-4 dark:border-zinc-700 dark:bg-zinc-800/50"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-white">
                    {v.title}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      v.is_completed
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    }`}
                  >
                    {v.is_completed ? "완료" : "미완료"}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    {v.last_watched_at
                      ? new Date(v.last_watched_at).toLocaleDateString("ko-KR", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "-"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 text-sm font-medium text-slate-500 dark:text-slate-400">자동 코멘트</h2>
          <p
            className={`text-lg font-medium ${
              (data.weeklyCompletion ?? 0) >= 80 || (data.monthlyCompletion ?? 0) >= 80
                ? "text-green-600 dark:text-green-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {data.comment ?? "-"}
          </p>
        </section>

        <p className="mt-8 text-center text-xs text-slate-400 dark:text-slate-500">
          영어는 김현정 영어전문학원 · 학부모 전용 리포트
        </p>
      </div>
    </div>
  );
}
