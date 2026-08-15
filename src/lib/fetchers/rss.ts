import { XMLParser } from 'fast-xml-parser';
import type { ContentItem, Source } from '../types';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['entry', 'item'].includes(name),
});

function extractUrl(linkField: unknown): string {
  if (typeof linkField === 'string') return linkField;
  if (Array.isArray(linkField)) {
    const alternate = linkField.find(
      (l: unknown) =>
        typeof l === 'object' &&
        l !== null &&
        (!(l as Record<string, unknown>)['@_rel'] ||
          (l as Record<string, unknown>)['@_rel'] === 'alternate')
    );
    return (alternate as Record<string, unknown> | undefined)?.['@_href'] as string ?? '';
  }
  if (typeof linkField === 'object' && linkField !== null) {
    return ((linkField as Record<string, unknown>)['@_href'] as string) ?? '';
  }
  return '';
}

function parseDate(raw: string | undefined): string {
  if (!raw) return new Date(0).toISOString();
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
}

// djb2 hash of the full string, so two items whose first 40 slugified chars
// happen to match (e.g. URLs sharing a long "/rubrique/2026/08/15/" prefix)
// still get distinct ids instead of colliding on the same truncated slug.
function hashSuffix(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function buildId(sourceId: string, url: string, title: string): string {
  const basis = url || title;
  return `${sourceId}-${slugify(basis)}-${hashSuffix(basis)}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

// Some feeds double-encode entities (e.g. "&amp;#233;" in the raw XML), which
// leaves a literal "&#233;" in the text after the XML parser's single decode
// pass. Run a second decode to catch those.
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

const MAX_DESCRIPTION_LENGTH = 400;

function extractText(field: unknown): string {
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null) {
    return String((field as Record<string, unknown>)['#text'] ?? '');
  }
  return '';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractDescription(raw: unknown): string {
  const text = decodeEntities(stripHtml(extractText(raw)));
  return text.length > MAX_DESCRIPTION_LENGTH ? text.slice(0, MAX_DESCRIPTION_LENGTH) : text;
}

function extractCategories(catField: unknown): string[] {
  if (catField == null) return [];
  const arr = Array.isArray(catField) ? catField : [catField];
  return arr
    .map((c) => {
      if (typeof c === 'string') return c;
      if (typeof c === 'object' && c !== null) {
        const obj = c as Record<string, unknown>;
        return String(obj['@_term'] ?? obj['#text'] ?? '');
      }
      return '';
    })
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function fetchRss(source: Source): Promise<ContentItem[]> {
  const res = await fetch(source.url, {
    headers: { 'User-Agent': 'Veilleuse/1.0 tech-dashboard' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`RSS ${source.url} → HTTP ${res.status}`);

  const xml = await res.text();
  const root = parser.parse(xml);

  // Atom feed
  const feed = root?.feed;
  if (feed) {
    const entries: unknown[] = feed.entry ?? [];
    return entries.map((e) => {
      const entry = e as Record<string, unknown>;
      const url = extractUrl(entry.link);
      const rawTitle = entry.title;
      const title =
        typeof rawTitle === 'object' && rawTitle !== null
          ? String((rawTitle as Record<string, unknown>)['#text'] ?? '')
          : String(rawTitle ?? '(no title)');
      return {
        id: buildId(source.id, url, title),
        title: decodeEntities(title.trim()),
        url,
        sourceId: source.id,
        sourceName: source.name,
        publishedAt: parseDate(
          (entry.published ?? entry.updated) as string | undefined
        ),
        categories: [],
        type: source.params?.contentType === 'podcast' ? 'podcast' : 'article',
        tags: extractCategories(entry.category),
        description: extractDescription(entry.summary ?? entry.content),
      } satisfies ContentItem;
    });
  }

  // RSS 2.0 feed
  const channel = root?.rss?.channel;
  if (channel) {
    const items: unknown[] = channel.item ?? [];
    return items.map((i) => {
      const item = i as Record<string, unknown>;
      const rawLink = item.link;
      const rawGuid = item.guid;
      const url =
        extractUrl(rawLink) ||
        (typeof rawGuid === 'object' && rawGuid !== null
          ? String((rawGuid as Record<string, unknown>)['#text'] ?? '')
          : String(rawGuid ?? ''));
      const rawTitle = item.title;
      const title =
        typeof rawTitle === 'object' && rawTitle !== null
          ? String((rawTitle as Record<string, unknown>)['#text'] ?? '')
          : String(rawTitle ?? '(no title)');
      return {
        id: buildId(source.id, url, title),
        title: decodeEntities(title.trim()),
        url,
        sourceId: source.id,
        sourceName: source.name,
        publishedAt: parseDate(
          (item.pubDate ?? item['dc:date']) as string | undefined
        ),
        categories: [],
        type: source.params?.contentType === 'podcast' ? 'podcast' : 'article',
        tags: extractCategories(item.category),
        description: extractDescription(item.description),
      } satisfies ContentItem;
    });
  }

  return [];
}
