import type { ContentItem, Source } from '../types';

export async function fetchReddit(source: Source): Promise<ContentItem[]> {
  const params = new URLSearchParams({ limit: source.params?.limit ?? '25' });
  const res = await fetch(`${source.url}?${params}`, {
    headers: {
      'User-Agent': 'Veille/1.0 (personal tech dashboard)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Reddit ${source.url} → HTTP ${res.status}`);

  const data = (await res.json()) as {
    data: {
      children: Array<{
        data: {
          id: string;
          title: string;
          url: string;
          stickied: boolean;
          created_utc: number;
          link_flair_text: string | null;
        };
      }>;
    };
  };
  const posts = data?.data?.children ?? [];

  return posts
    .filter((p) => !p.data.stickied && p.data.url)
    .map((p) => ({
      id: `${source.id}-${p.data.id}`,
      title: p.data.title,
      url: p.data.url.startsWith('/r/')
        ? `https://reddit.com${p.data.url}`
        : p.data.url,
      sourceId: source.id,
      sourceName: source.name,
      publishedAt: new Date(p.data.created_utc * 1000).toISOString(),
      categories: [],
      type: 'article',
      tags: p.data.link_flair_text ? [p.data.link_flair_text] : [],
    }));
}
