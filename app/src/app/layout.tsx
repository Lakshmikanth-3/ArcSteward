import type { Metadata } from "next";
import "./globals.css";
import SidebarLayout from "@/components/SidebarLayout";
import ConditionalLayout from "@/components/ConditionalLayout";
import GlobalStatsTicker from "@/components/GlobalStatsTicker";

export const metadata: Metadata = {
  title: "Velo402 — Autonomous Agent Wallet",
  description:
    "Capability-scoped treasury for AI agents. PolicyCap-enforced budget, " +
    "HTTP 402 data payments, DeepBook trading — all without human signatures.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ConditionalLayout>{children}</ConditionalLayout>
      </body>
    </html>
  );
}
