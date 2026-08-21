"use client";

import ListSortDropdown from "@/components/ListSortDropdown";
import type { ListSortOption } from "@/lib/listSort";

interface AssignVideoListToolbarProps {
  videoSearch: string;
  onVideoSearchChange: (value: string) => void;
  playlistListSort: ListSortOption;
  onPlaylistListSortChange: (value: ListSortOption) => void;
  playlistVideoListSort: ListSortOption;
  onPlaylistVideoListSortChange: (value: ListSortOption) => void;
  isSearchActive: boolean;
  showPlaylistList: boolean;
  searchInputId?: string;
}

/** 배정목록(관리자/강사): 영상 제목 검색 + 재생목록/영상 정렬 */
export default function AssignVideoListToolbar({
  videoSearch,
  onVideoSearchChange,
  playlistListSort,
  onPlaylistListSortChange,
  playlistVideoListSort,
  onPlaylistVideoListSortChange,
  isSearchActive,
  showPlaylistList,
  searchInputId,
}: AssignVideoListToolbarProps) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input
        id={searchInputId}
        type="search"
        value={videoSearch}
        onChange={(e) => onVideoSearchChange(e.target.value)}
        placeholder="영상 제목 검색..."
        aria-label="영상 제목 검색"
        className="min-w-[140px] flex-1 basis-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white sm:max-w-md sm:basis-auto"
      />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {!isSearchActive && showPlaylistList && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">재생목록</span>
            <ListSortDropdown value={playlistListSort} onChange={onPlaylistListSortChange} />
          </div>
        )}
        {(isSearchActive || !showPlaylistList) && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
              {isSearchActive ? "검색 결과" : "재생목록 내 영상"}
            </span>
            <ListSortDropdown value={playlistVideoListSort} onChange={onPlaylistVideoListSortChange} />
          </div>
        )}
      </div>
    </div>
  );
}
