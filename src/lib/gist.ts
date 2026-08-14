import type { Source, Category, Environment } from './types';

export const GIST_FILENAME = 'veille-data.json';

export interface GistPayload {
  sources?: Source[];
  categories?: Category[];
  environments?: Environment[];
}

/**
 * Reads the shared sources/categories file from a GitHub Gist at build time.
 * Lets each fork point at its own Gist (via the GIST_ID secret) without touching code.
 */
export async function fetchGistData(): Promise<GistPayload> {
  const gistId = import.meta.env.GIST_ID;
  if (!gistId) return {};

  const token = import.meta.env.GIST_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers });
    if (!res.ok) throw new Error(`Gist ${gistId} → HTTP ${res.status}`);
    const gist = await res.json();
    const file = gist.files?.[GIST_FILENAME] ?? Object.values(gist.files ?? {})[0];
    if (!file?.content) return {};
    return JSON.parse(file.content) as GistPayload;
  } catch (err) {
    console.error('[Veilleuse] fetchGistData error:', err);
    return {};
  }
}
