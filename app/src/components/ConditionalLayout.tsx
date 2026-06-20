"use client";
/**
 * ConditionalLayout.tsx
 * Wraps children in the sidebar layout ONLY for inner app pages.
 * The landing page (/) and any paths starting with /kill-switch render standalone.
 */
import { usePathname } from "next/navigation";
import SidebarLayout from "./SidebarLayout";

// Paths that render WITHOUT the sidebar shell
const STANDALONE_PATHS = ["/"];

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (STANDALONE_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  return <SidebarLayout>{children}</SidebarLayout>;
}
