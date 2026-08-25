/**
 * lib/rooster/store.ts
 * Store<T> — the persistence interface ledger-store.ts and
 * capability-store.ts depend on. createStore() picks the implementation:
 *
 *   - SupabaseStore when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are both
 *     set — real Postgres persistence, safe across concurrent serverless
 *     invocations (Vercel).
 *   - FileStore otherwise — local JSON file, unchanged, still what tests
 *     and local dev without Supabase configured use. FileStore already
 *     satisfies this interface structurally; it doesn't need to import it.
 */
import { FileStore } from "./file-store";
import { SupabaseStore } from "./supabase-store";

export interface Store<T> {
  get(key: string): Promise<T | undefined>;
  getAll(): Promise<Record<string, T>>;
  set(key: string, value: T): Promise<void>;
  update(key: string, updater: (current: T | undefined) => T): Promise<T>;
}

export interface CreateStoreOptions {
  /** SupabaseStore's store_name discriminator (rooster_kv_store.store_name). */
  name: string;
  /** Env var that overrides the local file path — FileStore fallback only. */
  filePathEnvVar: string;
  /** Default local file path if filePathEnvVar is unset — FileStore fallback only. */
  defaultFilePath: string;
}

export function createStore<T>(opts: CreateStoreOptions): Store<T> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseServiceRoleKey) {
    return new SupabaseStore<T>(opts.name, supabaseUrl, supabaseServiceRoleKey);
  }
  return new FileStore<T>(process.env[opts.filePathEnvVar] ?? opts.defaultFilePath);
}
