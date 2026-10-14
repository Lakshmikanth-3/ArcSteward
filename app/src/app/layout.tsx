import type { Metadata } from "next";
import "./globals.css";
import "./arc-workspace.css";
import ConditionalLayout from "@/components/ConditionalLayout";
import { projectDescription } from "@/lib/arc/project";

export const metadata: Metadata = {
  title: "Velo402 — Arc Agent Vault",
  description: projectDescription,
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
