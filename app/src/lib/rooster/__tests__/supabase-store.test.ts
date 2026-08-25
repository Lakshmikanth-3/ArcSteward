import { test } from "node:test";
import assert from "node:assert/strict";
import { SupabaseStore, type KvTableClient } from "../supabase-store";

interface FakeRow {
  value: unknown;
  version: number;
}

/**
 * In-memory fake of the flat KvTableClient seam — exercises SupabaseStore's
 * own logic (including the optimistic-concurrency retry loop) without any
 * real network/Supabase call. No global fetch mocking needed since
 * SupabaseStore never touches @supabase/supabase-js directly when a
 * KvTableClient is injected.
 */
function makeFakeTable(): { table: KvTableClient; rows: Map<string, FakeRow> } {
  const rows = new Map<string, FakeRow>();
  const rowKey = (storeName: string, key: string) => `${storeName}::${key}`;

  const table: KvTableClient = {
    async selectOne(storeName, key) {
      return rows.get(rowKey(storeName, key));
    },
    async selectAll(storeName) {
      const prefix = `${storeName}::`;
      const out: Array<{ key: string; value: unknown }> = [];
      for (const [k, v] of rows) {
        if (k.startsWith(prefix)) out.push({ key: k.slice(prefix.length), value: v.value });
      }
      return out;
    },
    async upsert(storeName, key, value) {
      const k = rowKey(storeName, key);
      const existing = rows.get(k);
      rows.set(k, { value, version: (existing?.version ?? 0) + 1 });
    },
    async insertIfAbsent(storeName, key, value) {
      const k = rowKey(storeName, key);
      if (rows.has(k)) return false;
      rows.set(k, { value, version: 1 });
      return true;
    },
    async updateIfVersion(storeName, key, value, expectedVersion) {
      const k = rowKey(storeName, key);
      const existing = rows.get(k);
      if (!existing || existing.version !== expectedVersion) return false;
      rows.set(k, { value, version: expectedVersion + 1 });
      return true;
    },
  };

  return { table, rows };
}

test("get returns undefined for a key that was never set", async () => {
  const { table } = makeFakeTable();
  const store = new SupabaseStore<{ n: number }>("s1", "url", "key", table);
  assert.equal(await store.get("missing"), undefined);
});

test("set then get round-trips the value", async () => {
  const { table } = makeFakeTable();
  const store = new SupabaseStore<{ n: number }>("s1", "url", "key", table);
  await store.set("k1", { n: 42 });
  assert.deepEqual(await store.get("k1"), { n: 42 });
});

test("getAll returns every key scoped to this store's storeName, not another store's rows in the same table", async () => {
  const { table } = makeFakeTable();
  const storeA = new SupabaseStore<{ n: number }>("store-a", "url", "key", table);
  const storeB = new SupabaseStore<{ n: number }>("store-b", "url", "key", table);
  await storeA.set("k1", { n: 1 });
  await storeA.set("k2", { n: 2 });
  await storeB.set("k1", { n: 999 });

  const all = await storeA.getAll();
  assert.deepEqual(all, { k1: { n: 1 }, k2: { n: 2 } });
});

test("update() inserts on first write for a key that doesn't exist yet", async () => {
  const { table } = makeFakeTable();
  const store = new SupabaseStore<number>("s1", "url", "key", table);
  const result = await store.update("counter", (current) => (current ?? 0) + 1);
  assert.equal(result, 1);
  assert.equal(await store.get("counter"), 1);
});

test("update() reads the current value and applies the updater on an existing key", async () => {
  const { table } = makeFakeTable();
  const store = new SupabaseStore<number>("s1", "url", "key", table);
  await store.set("counter", 5);
  const result = await store.update("counter", (current) => (current ?? 0) + 1);
  assert.equal(result, 6);
});

test("update() retries and succeeds when a concurrent writer changes the version between read and write", async () => {
  const { table } = makeFakeTable();
  const store = new SupabaseStore<number>("s1", "url", "key", table);
  await store.set("counter", 0);

  let calls = 0;
  const originalUpdateIfVersion = table.updateIfVersion.bind(table);
  table.updateIfVersion = async (storeName, key, value, expectedVersion) => {
    calls += 1;
    if (calls === 1) {
      // Simulate a concurrent writer landing between this store's read and
      // write, so the first conditional update loses the race.
      await originalUpdateIfVersion(storeName, key, -1, expectedVersion);
      return false;
    }
    return originalUpdateIfVersion(storeName, key, value, expectedVersion);
  };

  const result = await store.update("counter", (current) => (current ?? 0) + 1);
  // The retry re-reads the concurrent writer's value (-1) and applies the
  // updater on top of THAT, not the stale value from the first attempt.
  assert.equal(result, 0);
  assert.equal(calls, 2);
});

test("update() gives up after MAX_UPDATE_ATTEMPTS under permanent contention, rather than looping forever", async () => {
  const { table } = makeFakeTable();
  const store = new SupabaseStore<number>("s1", "url", "key", table);
  await store.set("counter", 0);
  table.updateIfVersion = async () => false; // always loses the race

  await assert.rejects(
    () => store.update("counter", (current) => (current ?? 0) + 1),
    /exceeded \d+ attempts/,
  );
});

test("a failed selectOne surfaces as a thrown error, not a silent undefined", async () => {
  const { table } = makeFakeTable();
  table.selectOne = async () => {
    throw new Error("connection reset");
  };
  const store = new SupabaseStore<number>("s1", "url", "key", table);
  await assert.rejects(() => store.get("k1"), /connection reset/);
});
