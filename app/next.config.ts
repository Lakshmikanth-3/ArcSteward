import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Browser integration tests run alongside the user's dev server.
  distDir: process.env.ARC_UI_TEST === "1" ? ".next-arc-ui-test" : ".next",
};

export default nextConfig;
