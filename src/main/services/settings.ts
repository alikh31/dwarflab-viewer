import { app } from 'electron';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Minimal JSON-file settings store.
 *
 * Persists to `<userData>/settings.json` (a flat object).
 * Loaded lazily on first read, cached in memory thereafter.
 * Writes are atomic: tmp file + rename.
 *
 * Used initially for `astro.location = { lon, lat }`, but accepts any
 * JSON-serialisable value at any key. No schema, no migrations — keep it
 * tiny.
 */

type Settings = Record<string, unknown>;

let cache: Settings | null = null;
let loadPromise: Promise<Settings> | null = null;
let writePromise: Promise<void> = Promise.resolve();

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function loadFromDisk(): Promise<Settings> {
  try {
    const raw = await readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Settings;
    }
    return {};
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return {};
    // Corrupt or unreadable — start fresh rather than crash
    console.warn('[settings] failed to read settings.json, starting empty:', err.message);
    return {};
  }
}

async function ensureLoaded(): Promise<Settings> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = loadFromDisk().then((data) => {
      cache = data;
      return data;
    });
  }
  return loadPromise;
}

async function persist(): Promise<void> {
  if (!cache) return;
  const file = settingsPath();
  const tmp = `${file}.${process.pid}.tmp`;
  const data = JSON.stringify(cache, null, 2);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, file);
}

export async function getSettings(): Promise<Settings> {
  const data = await ensureLoaded();
  return { ...data };
}

export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const data = await ensureLoaded();
  const v = data[key];
  return v === undefined ? undefined : (v as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const data = await ensureLoaded();
  if (value === undefined) {
    delete data[key];
  } else {
    data[key] = value;
  }
  // Serialise writes so concurrent sets don't race
  writePromise = writePromise.then(() => persist()).catch((err) => {
    console.warn('[settings] failed to persist:', err);
  });
  await writePromise;
}
