/**
 * lib/rooster/file-store.ts
 * Minimal JSON-file-backed key/value store with an in-process write mutex
 * and atomic (write-tmp-then-rename) persistence.
 *
 * Pilot-scale only: safe for a single Node process (dev server or a tsx
 * script), NOT safe across multiple server instances/replicas. This is a
 * deliberate simplification for the Base Sepolia pilot — swap for a real
 * database (e.g. Postgres/Supabase, already a dependency of this repo) before
 * scaling this rail beyond a single-instance deployment. Nothing security-
 * critical about Sui state depends on this store; it exists purely for the
 * off-chain Rooster capability/reconciliation ledger.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export class FileStore<T> {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private cache: Record<string, T> | null = null;

  constructor(relativeOrAbsolutePath: string) {
    this.filePath = path.isAbsolute(relativeOrAbsolutePath)
      ? relativeOrAbsolutePath
      : path.join(process.cwd(), relativeOrAbsolutePath);
  }

  private async load(): Promise<Record<string, T>> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.cache = JSON.parse(raw) as Record<string, T>;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache = {};
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private async persist(data: Record<string, T>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmpPath, this.filePath);
    this.cache = data;
  }

  async get(key: string): Promise<T | undefined> {
    const data = await this.load();
    return data[key];
  }

  async getAll(): Promise<Record<string, T>> {
    return { ...(await this.load()) };
  }

  /** Serializes writes through a single queue to avoid lost-update races within one process. */
  async set(key: string, value: T): Promise<void> {
    const task = this.writeQueue.then(async () => {
      const data = await this.load();
      data[key] = value;
      await this.persist(data);
    });
    this.writeQueue = task.catch(() => undefined);
    return task;
  }

  /** Atomically read-modify-write a single key. Returns the new value. */
  async update(key: string, updater: (current: T | undefined) => T): Promise<T> {
    let result!: T;
    const task = this.writeQueue.then(async () => {
      const data = await this.load();
      result = updater(data[key]);
      data[key] = result;
      await this.persist(data);
    });
    this.writeQueue = task.catch(() => undefined);
    await task;
    return result;
  }
}
