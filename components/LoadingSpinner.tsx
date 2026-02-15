"use client";

export default function LoadingSpinner() {
  return (
    <div className="flex min-h-[12rem] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
    </div>
  );
}
