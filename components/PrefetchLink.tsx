"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, type ComponentProps, type MouseEvent, type FocusEvent } from "react";

type LinkProps = ComponentProps<typeof Link>;

export interface PrefetchLinkProps extends LinkProps {
  /** hover/focus 시 호출 — 데이터 warm-up (TTL 캐시 hit이면 no-op) */
  warmUp?: () => void | Promise<void>;
}

function hrefToPath(href: LinkProps["href"]): string {
  if (typeof href === "string") return href.split("?")[0].split("#")[0];
  if (typeof href === "object" && href.pathname) return href.pathname;
  return String(href);
}

export default function PrefetchLink({
  warmUp,
  href,
  onMouseEnter,
  onFocus,
  children,
  ...rest
}: PrefetchLinkProps) {
  const router = useRouter();
  const warmingRef = useRef(false);

  const triggerPrefetch = useCallback(
    (e?: MouseEvent<HTMLAnchorElement> | FocusEvent<HTMLAnchorElement>) => {
      const path = hrefToPath(href);
      try {
        router.prefetch(path);
      } catch {
        // prefetch 실패는 네비게이션을 막지 않음
      }
      if (warmUp && !warmingRef.current) {
        warmingRef.current = true;
        void Promise.resolve(warmUp()).finally(() => {
          warmingRef.current = false;
        });
      }
      if (e && "nativeEvent" in e) {
        if (e.type === "mouseenter") onMouseEnter?.(e as MouseEvent<HTMLAnchorElement>);
        else onFocus?.(e as FocusEvent<HTMLAnchorElement>);
      }
    },
    [href, onFocus, onMouseEnter, router, warmUp]
  );

  return (
    <Link
      href={href}
      onMouseEnter={(e) => triggerPrefetch(e)}
      onFocus={(e) => triggerPrefetch(e)}
      {...rest}
    >
      {children}
    </Link>
  );
}
