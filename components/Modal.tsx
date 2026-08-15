"use client";

import { useEffect, useState } from "react";
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
  const canDismiss = Boolean(onClose) && !dismissDisabled;
  const backdropDismiss = closeOnBackdrop ?? canDismiss;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={() => {
        if (backdropDismiss && canDismiss && onClose) onClose();
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body
  );
}
