import type { ContentItem, Category } from './types';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Matches a keyword bounded by non-letter/digit characters (or string
// edges), Unicode-aware so accented words (é, è…) are handled correctly —
// unlike JS's built-in \b, which only understands ASCII word characters.
function keywordRegex(keyword: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(keyword)}(?![\\p{L}\\p{N}])`, 'iu');
}

export function matchCategories(
  item: Pick<ContentItem, 'title' | 'tags' | 'description'>,
  categories: Category[]
): string[] {
  const haystack = [item.title, ...(item.tags ?? []), item.description ?? ''].join(' ');
  return categories
    .filter((cat) => cat.keywords.some((kw) => keywordRegex(kw).test(haystack)))
    .map((cat) => cat.id);
}

export function annotateItems(items: ContentItem[], categories: Category[]): ContentItem[] {
  return items.map((item) => ({
    ...item,
    categories: matchCategories(item, categories),
  }));
}
