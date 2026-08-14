import type { ContentItem, Source } from '../types';

export async function fetchYouTube(source: Source): Promise<ContentItem[]> {
  const key = import.meta.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY not set');

  const params = new URLSearchParams({
    part: 'snippet',
    channelId: source.params?.channelId ?? '',
    maxResults: source.params?.maxResults ?? '15',
    order: 'date',
    type: 'video',
    key,
  });
  const res = await fetch(`${source.url}?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`YouTube → HTTP ${res.status}`);

  const data = (await res.json()) as {
    items: Array<{
      id: { videoId: string };
      snippet: { title: string; publishedAt: string; description?: string };
    }>;
  };

  return (data?.items ?? []).map((item) => ({
    id: `${source.id}-${item.id?.videoId}`,
    title: item.snippet.title,
    url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
    sourceId: source.id,
    sourceName: source.name,
    publishedAt: new Date(item.snippet.publishedAt).toISOString(),
    categories: [],
    type: 'video',
    description: item.snippet.description?.slice(0, 400),
  }));
}
