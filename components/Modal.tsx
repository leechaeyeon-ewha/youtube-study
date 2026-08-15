"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  /** false면 배경 클릭으로 닫지 않음 (기본: onClose 있으면 true) */
  closeOnBackdrop?: boolean;
  /** true면 닫기 차단 (로딩 중 등) */
  dismissDisabled?: boolean;
  labelledBy?: string;
  children: React.ReactNode;
}

/**
 * viewport 기준 모달. PageTransition(transform) 안에서 fixed가 깨지는 문제를
 * document.body Portal로 우회합니다.
 *
 * 모바일: body 스크롤 고정 + 오버레이 items-start → 헤더 잘림 방지
 */
export default function Modal({
  open,
  onClose,
  closeOnBackdrop,
  dismissDisabled = false,
  labelledBy,
  children,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canDismiss = Boolean(onClose) && !dismissDisabled;
  const backdropDismiss = closeOnBackdrop ?? canDismiss;

  useEffect(() => {
    setMounted(true);
  }, []);

  /** iOS 포함 — 배경 페이지 스크롤 위치 보존하며 잠금 */
  useEffect(() => {
    if (!open) return;

    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    return () => {
      body.style.overflow = prev.overflow;
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  /** 모달 열릴 때 오버레이 스크롤을 항상 최상단에서 시작 */
  useEffect(() => {
    if (!open) return;
    overlayRef.current?.scrollTo(0, 0);
  }, [open]);

  useEffect(() => {
    if (!open || !canDismiss || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, canDismiss, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={() => {
        if (backdropDismiss && canDismiss && onClose) onClose();
      }}
    >
      <div className="flex min-h-full items-start justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:py-8">
        <div onClick={(e) => e.stopPropagation()}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
