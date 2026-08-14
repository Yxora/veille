export interface ContentItem {
  id: string;
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  publishedAt: string; // ISO 8601
  categories: string[]; // matched category ids
  type: 'article' | 'video' | 'podcast';
  tags?: string[]; // raw tags/categories from the source feed, used for matching alongside the title
  description?: string; // feed summary/description, also used for keyword matching
}

export interface Environment {
  id: string;
  name: string;
}

export interface Source {
  id: string;
  name: string;
  url: string;
  type: 'rss' | 'devto' | 'reddit' | 'youtube';
  params?: Record<string, string>;
  environment?: string; // Environment id
}

export interface Category {
  id: string;
  name: string;
  keywords: string[];
  environment?: string; // Environment id
}
