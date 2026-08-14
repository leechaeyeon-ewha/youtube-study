"use client";

export default function PageTransition({ children }: { children: React.ReactNode }) {
  return <div className="page-transition-enter">{children}</div>;
}
