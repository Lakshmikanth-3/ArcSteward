-- Default-deny for anon/authenticated roles — no policies are defined, so
-- only the service_role key (used exclusively server-side by
-- supabase-store.ts, which bypasses RLS by design) can touch this table.
-- Defense in depth: this table holds capability grants and the funding
-- reconciliation ledger, never meant to be reachable from a client key.
alter table rooster_kv_store enable row level security;
