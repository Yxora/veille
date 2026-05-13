import type { ContentItem, Category } from './types';

export function matchCategories(title: string, categories: Category[]): string[] {
  const lower = title.toLowerCase();
  return categories
    .filter((cat) => cat.keywords.some((kw) => lower.includes(kw.toLowerCase())))
    .map((cat) => cat.id);
}

export function annotateItems(items: ContentItem[], categories: Category[]): ContentItem[] {
  return items.map((item) => ({
    ...item,
    categories: matchCategories(item.title, categories),
  }));
}
