import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Academy play",
  description: "학부모 전용 학습 리포트",
  openGraph: {
    title: "Academy play",
    description: "학부모 전용 학습 리포트",
  },
};

export default function ReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
