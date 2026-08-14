import type { ContentItem, Category } from './types';

export function matchCategories(
  item: Pick<ContentItem, 'title' | 'tags' | 'description'>,
  categories: Category[]
): string[] {
  const haystack = [item.title, ...(item.tags ?? []), item.description ?? '']
    .join(' ')
    .toLowerCase();
  return categories
    .filter((cat) => cat.keywords.some((kw) => haystack.includes(kw.toLowerCase())))
    .map((cat) => cat.id);
}

export function annotateItems(items: ContentItem[], categories: Category[]): ContentItem[] {
  return items.map((item) => ({
    ...item,
    categories: matchCategories(item, categories),
  }));
}
