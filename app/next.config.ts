import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Browser integration tests run alongside the user's dev server.
  distDir: process.env.ARC_UI_TEST === "1" ? ".next-arc-ui-test" : ".next",
  // @mysten/* packages are ESM-only; tell webpack to treat them as external
  // on the server so they are not bundled (Next.js handles ESM externals natively).
  serverExternalPackages: [
    "@mysten/sui",
    "@mysten/deepbook-v3",
    "@mysten/seal",
    "@mysten/walrus",
  ],

  // Expose server-only env vars to API routes (not to the browser bundle)
  env: {
    KNOWLEDGE_PRICE_MIST: process.env.KNOWLEDGE_PRICE_MIST ?? "50000000",
  },
};

export default nextConfig;
