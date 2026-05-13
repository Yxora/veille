import type { ContentItem, Source } from '../types';

export async function fetchDevto(source: Source): Promise<ContentItem[]> {
  const params = new URLSearchParams({
    tag: source.params?.tag ?? 'java',
    per_page: source.params?.per_page ?? '20',
  });
  const res = await fetch(`${source.url}?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Dev.to → HTTP ${res.status}`);

  const articles = (await res.json()) as Array<{
    id: number;
    title: string;
    url: string;
    published_at: string;
  }>;

  return articles.map((a) => ({
    id: `${source.id}-${a.id}`,
    title: a.title,
    url: a.url,
    sourceId: source.id,
    sourceName: source.name,
    publishedAt: new Date(a.published_at).toISOString(),
    categories: [],
    type: 'article',
  }));
}
