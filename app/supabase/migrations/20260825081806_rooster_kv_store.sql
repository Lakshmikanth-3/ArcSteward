-- Generic key/value store backing lib/rooster/ledger-store.ts and
-- lib/rooster/capability-store.ts on serverless deployments (Vercel), where
-- the local FileStore JSON-file fallback used for local dev/tests doesn't
-- persist across invocations. One shared table, discriminated by
-- store_name, mirrors the previous one-JSON-file-per-store layout.
--
-- `version` backs optimistic-concurrency updates in supabase-store.ts's
-- update() — a real correctness requirement once multiple serverless
-- invocations can run concurrently, which FileStore's in-process mutex
-- never protected against.
create table if not exists rooster_kv_store (
  store_name  text not null,
  key         text not null,
  value       jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (store_name, key)
);

create index if not exists idx_rooster_kv_store_name on rooster_kv_store (store_name);
