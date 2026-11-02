/**
 * Stable shuffle order cache.
 *
 * The first call for a key generates a random permutation and stores the ID
 * order in localStorage. Later calls reuse that order for the TTL window, so a
 * refresh does not reshuffle the user's learning sequence.
 */

const STORAGE_PREFIX = 'cetlab:stable-order:v1:';
export const DEFAULT_STABLE_ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredOrder {
  version: number;
  createdAt: number;
  ids: string[];
}

export interface StableOrderOptions {
  /** How long a stored order remains valid. Default: 7 days. */
  ttlMs?: number;
  /** Bump this when the ID semantics change. */
  version?: number;
}

const memory = new Map<string, string>();

export function getStableOrder(
  key: string,
  ids: string[],
  options: StableOrderOptions = {},
): string[] {
  if (ids.length === 0) return [];

  const ttlMs = options.ttlMs ?? DEFAULT_STABLE_ORDER_TTL_MS;
  const version = options.version ?? 1;
  const storageKey = STORAGE_PREFIX + key;
  const now = Date.now();
  const stored = readStored(storageKey);

  if (
    stored &&
    stored.version === version &&
    now - stored.createdAt <= ttlMs
  ) {
    const current = new Set(ids);
    const seen = new Set<string>();
    const ordered: string[] = [];

    for (const id of stored.ids) {
      if (current.has(id) && !seen.has(id)) {
        ordered.push(id);
        seen.add(id);
      }
    }

    const missing = ids.filter((id) => !seen.has(id));
    if (missing.length > 0) {
      shuffleInPlace(missing);
      ordered.push(...missing);
      writeStored(storageKey, {
        version,
        createdAt: stored.createdAt,
        ids: ordered,
      });
    }

    if (ordered.length === ids.length) return ordered;
  }

  const fresh = [...ids];
  shuffleInPlace(fresh);
  writeStored(storageKey, { version, createdAt: now, ids: fresh });
  return fresh;
}

export function resetStableOrder(key: string): void {
  const storageKey = STORAGE_PREFIX + key;
  memory.delete(storageKey);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // localStorage unavailable; memory fallback already cleared.
    }
  }
}

function readStored(storageKey: string): StoredOrder | null {
  const raw = readRaw(storageKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredOrder>;
    if (
      typeof parsed.version === 'number' &&
      typeof parsed.createdAt === 'number' &&
      Array.isArray(parsed.ids) &&
      parsed.ids.every((id) => typeof id === 'string')
    ) {
      return {
        version: parsed.version,
        createdAt: parsed.createdAt,
        ids: parsed.ids,
      };
    }
  } catch {
    // corrupt cache; regenerate below
  }

  return null;
}

function writeStored(storageKey: string, order: StoredOrder): void {
  const raw = JSON.stringify(order);
  memory.set(storageKey, raw);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(storageKey, raw);
    } catch {
      // quota/private mode; memory fallback remains for this session
    }
  }
}

function readRaw(storageKey: string): string | null {
  if (typeof window !== 'undefined') {
    try {
      const value = window.localStorage.getItem(storageKey);
      if (value !== null) return value;
    } catch {
      // fall through to memory
    }
  }
  return memory.get(storageKey) ?? null;
}

function shuffleInPlace<T>(items: T[]): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
}

function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) return 0;

  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] % maxExclusive;
  }

  return Math.floor(Math.random() * maxExclusive);
}
