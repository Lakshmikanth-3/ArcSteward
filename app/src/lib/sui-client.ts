import { SuiGrpcClient } from "@mysten/sui/grpc";

// Sui deprecated JSON-RPC on public fullnodes (confirmed live 2026-08-25 —
// every JSON-RPC method, including writes, returns "Method not found" on
// fullnode.<network>.sui.io). gRPC is the migration target: same hostname,
// different protocol. GraphQL was evaluated and rejected — its SDK client
// has no built-in default endpoint (unlike gRPC/JSON-RPC), the conventional
// public URL doesn't resolve, and it has weaker event-query support (no
// live subscription).
const network =
  (process.env.NEXT_PUBLIC_SUI_NETWORK as "testnet" | "mainnet" | "devnet") ??
  "testnet";

export const suiClient = new SuiGrpcClient({
  network,
  baseUrl: `https://fullnode.${network}.sui.io:443`,
});

export const PACKAGE_ID = process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID!;
export const TREASURY_ID = process.env.NEXT_PUBLIC_TREASURY_ID!;
export const POLICY_CAP_ID = process.env.NEXT_PUBLIC_POLICY_CAP_ID!;
export const NETWORK = network;
