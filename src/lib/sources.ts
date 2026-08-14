import type { ContentItem, Source } from './types';
import { fetchRss } from './fetchers/rss';
import { fetchDevto } from './fetchers/devto';
import { fetchReddit } from './fetchers/reddit';
import { fetchYouTube } from './fetchers/youtube';

type Fetcher = (source: Source) => Promise<ContentItem[]>;

const FETCHERS: Record<Source['type'], Fetcher> = {
  rss: fetchRss,
  devto: fetchDevto,
  reddit: fetchReddit,
  youtube: fetchYouTube,
};

export async function fetchAllSources(sources: Source[]): Promise<ContentItem[]> {
  const results = await Promise.allSettled(
    sources.map((source) => FETCHERS[source.type](source))
  );

  const items: ContentItem[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      console.error(`[Veilleuse] Source "${sources[i].name}" failed:`, result.reason);
    }
  }
  return items;
}
