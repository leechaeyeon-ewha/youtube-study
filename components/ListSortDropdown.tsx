"use client";

import type { ListSortOption } from "@/lib/listSort";

interface ListSortDropdownProps {
  value: ListSortOption;
  onChange: (value: ListSortOption) => void;
  id?: string;
  className?: string;
}

export default function ListSortDropdown({ value, onChange, id, className = "" }: ListSortDropdownProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as ListSortOption)}
      aria-label="정렬"
      className={
        className ||
        "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
      }
    >
      <option value="">정렬</option>
      <option value="date-asc">날짜순 ↑</option>
      <option value="date-desc">날짜순 ↓</option>
      <option value="name-asc">이름순 ↑(ㄱ→ㅎ)</option>
      <option value="name-desc">이름순 ↓(ㅎ→ㄱ)</option>
    </select>
  );
}
