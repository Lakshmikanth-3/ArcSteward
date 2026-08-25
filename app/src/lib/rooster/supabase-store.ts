/**
 * lib/rooster/supabase-store.ts
 * Store<T> backed by the shared `rooster_kv_store` Postgres table (see
 * supabase/migrations) — used in place of FileStore whenever SUPABASE_URL/
 * SUPABASE_SERVICE_ROLE_KEY are configured (Vercel deployments, where the
 * local filesystem doesn't persist writes across invocations).
 *
 * KvTableClient flattens Supabase's chainable query builder into plain
 * async methods with simple signatures — easier to reason about, and lets
 * tests inject an in-memory fake instead of mocking PostgREST's builder
 * chain (the real implementation is the only thing that talks to
 * @supabase/supabase-js).
 */
import { createClient } from "@supabase/supabase-js";
import type { Store } from "./store";

const TABLE = "rooster_kv_store";
const MAX_UPDATE_ATTEMPTS = 5;

export interface KvTableClient {
  selectOne(storeName: string, key: string): Promise<{ value: unknown; version: number } | undefined>;
  selectAll(storeName: string): Promise<Array<{ key: string; value: unknown }>>;
  upsert(storeName: string, key: string, value: unknown): Promise<void>;
  /** Returns true if inserted, false if a row for this key already existed (conflict). */
  insertIfAbsent(storeName: string, key: string, value: unknown): Promise<boolean>;
  /** Returns true if updated, false if `expectedVersion` no longer matched (lost the race). */
  updateIfVersion(
    storeName: string,
    key: string,
    value: unknown,
    expectedVersion: number,
  ): Promise<boolean>;
}

function createSupabaseKvTableClient(url: string, serviceRoleKey: string): KvTableClient {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  return {
    async selectOne(storeName, key) {
      const { data, error } = await client
        .from(TABLE)
        .select("value, version")
        .eq("store_name", storeName)
        .eq("key", key)
        .maybeSingle();
      if (error) throw new Error(`rooster_kv_store select failed: ${error.message}`);
      return data ? { value: data.value, version: data.version as number } : undefined;
    },

    async selectAll(storeName) {
      const { data, error } = await client.from(TABLE).select("key, value").eq("store_name", storeName);
      if (error) throw new Error(`rooster_kv_store select-all failed: ${error.message}`);
      return (data ?? []) as Array<{ key: string; value: unknown }>;
    },

    async upsert(storeName, key, value) {
      const { error } = await client
        .from(TABLE)
        .upsert(
          { store_name: storeName, key, value, updated_at: new Date().toISOString() },
          { onConflict: "store_name,key" },
        );
      if (error) throw new Error(`rooster_kv_store upsert failed: ${error.message}`);
    },

    async insertIfAbsent(storeName, key, value) {
      const { error } = await client
        .from(TABLE)
        .insert({ store_name: storeName, key, value, version: 1, updated_at: new Date().toISOString() });
      return !error; // a unique-violation error means someone else inserted first
    },

    async updateIfVersion(storeName, key, value, expectedVersion) {
      const { data, error } = await client
        .from(TABLE)
        .update({ value, version: expectedVersion + 1, updated_at: new Date().toISOString() })
        .eq("store_name", storeName)
        .eq("key", key)
        .eq("version", expectedVersion)
        .select("value")
        .maybeSingle();
      if (error) throw new Error(`rooster_kv_store conditional update failed: ${error.message}`);
      return !!data;
    },
  };
}

export class SupabaseStore<T> implements Store<T> {
  private readonly table: KvTableClient;
  private readonly storeName: string;

  constructor(storeName: string, url: string, serviceRoleKey: string, table?: KvTableClient) {
    this.storeName = storeName;
    this.table = table ?? createSupabaseKvTableClient(url, serviceRoleKey);
  }

  async get(key: string): Promise<T | undefined> {
    const row = await this.table.selectOne(this.storeName, key);
    return row ? (row.value as T) : undefined;
  }

  async getAll(): Promise<Record<string, T>> {
    const rows = await this.table.selectAll(this.storeName);
    const out: Record<string, T> = {};
    for (const row of rows) out[row.key] = row.value as T;
    return out;
  }

  async set(key: string, value: T): Promise<void> {
    await this.table.upsert(this.storeName, key, value);
  }

  /**
   * Optimistic-concurrency read-modify-write. FileStore's in-process write
   * queue only ever protected against races within a single Node process —
   * concurrent serverless invocations are a real possibility here, so a
   * plain read-then-write would risk silently losing an update. Retries
   * (bounded) on a lost race, same as any optimistic-locking pattern.
   */
  async update(key: string, updater: (current: T | undefined) => T): Promise<T> {
    for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt++) {
      const existing = await this.table.selectOne(this.storeName, key);
      const current = existing ? (existing.value as T) : undefined;
      const next = updater(current);

      if (!existing) {
        const inserted = await this.table.insertIfAbsent(this.storeName, key, next);
        if (inserted) return next;
        continue; // someone else inserted first — retry, we'll see their row next loop
      }

      const updated = await this.table.updateIfVersion(this.storeName, key, next, existing.version);
      if (updated) return next;
      // version mismatch — a concurrent writer won this round, retry.
    }
    throw new Error(
      `SupabaseStore.update(${key}) exceeded ${MAX_UPDATE_ATTEMPTS} attempts due to concurrent writes.`,
    );
  }
}
