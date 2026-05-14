export interface ContentItem {
  id: string;
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  publishedAt: string; // ISO 8601
  categories: string[]; // matched category ids
  type: 'article' | 'video' | 'podcast';
}

export interface Source {
  id: string;
  name: string;
  url: string;
  type: 'rss' | 'devto' | 'reddit' | 'youtube';
  params?: Record<string, string>;
  defaultCategories: string[];
  environment?: 'tech' | 'humanites';
}

export interface Category {
  id: string;
  name: string;
  keywords: string[];
}
