"use client";
/**
 * ConditionalLayout.tsx
 * The landing page (/) and EarlyPay (/earlypay) render standalone; every other page uses the Arc workspace shell.
 */
import { usePathname } from "next/navigation";
import ArcWorkspace from "./ArcWorkspace";

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/" || pathname.startsWith("/earlypay")) return <>{children}</>;
  return <ArcWorkspace>{children}</ArcWorkspace>;
}
