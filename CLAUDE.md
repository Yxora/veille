# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Veille" — a personal tech-news dashboard built with Astro SSR, deployed on Vercel via GitHub. It fetches articles, videos, and podcasts from ~20 sources (RSS feeds, Dev.to API, Reddit JSON API, YouTube Data API v3), annotates them with categories via keyword matching, and renders a filterable dark-mode UI.

## Commands

```bash
npm run dev       # start local dev server at http://localhost:4321
npm run build     # build for production (outputs to dist/ and .vercel/)
npm run preview   # preview the production build locally
```

To enable YouTube sources locally, create `.env.local` (not committed):
```
YOUTUBE_API_KEY=your_key_here
```

## Architecture

### Data flow

1. `src/pages/index.astro` (SSR) calls `fetchAllSources(sources)` server-side on every request
2. `src/lib/sources.ts` dispatches each source to the right fetcher via a `FETCHERS` record keyed by `Source['type']`
3. Fetchers return `ContentItem[]`; failures are caught by `Promise.allSettled` and logged — one broken source never kills the page
4. `annotateItems()` from `src/lib/categories.ts` does case-insensitive keyword matching against `src/data/categories.json` to assign category IDs to each item
5. All data is serialized into three `<script type="application/json">` islands in the HTML
6. `src/scripts/island.ts` (vanilla TS, no framework) reads those islands and re-renders the grid based on localStorage state (active theme, hidden sources, user-added categories/sources)
7. Response includes `Cache-Control: s-maxage=300, stale-while-revalidate=600` so Vercel CDN caches the page for 5 minutes

### Key files

| Path | Purpose |
|------|---------|
| `src/data/sources.json` | Default source configs (id, name, url, type, params, defaultCategories) |
| `src/data/categories.json` | Default categories with keyword arrays for matching |
| `src/lib/types.ts` | `ContentItem`, `Source`, `Category` interfaces |
| `src/lib/sources.ts` | `fetchAllSources()` — dispatches to fetchers |
| `src/lib/fetchers/rss.ts` | RSS/Atom parser using `fast-xml-parser`; handles both RSS 2.0 and Atom |
| `src/lib/fetchers/devto.ts` | Dev.to public REST API |
| `src/lib/fetchers/reddit.ts` | Reddit JSON API (requires `User-Agent` header) |
| `src/lib/fetchers/youtube.ts` | YouTube Data API v3 `search.list`; reads `import.meta.env.YOUTUBE_API_KEY` |
| `src/lib/categories.ts` | Keyword-based category matching |
| `src/pages/index.astro` | Main SSR page |
| `src/scripts/island.ts` | Client-side filtering, localStorage state, modal handlers |

### Adding a new source

Edit `src/data/sources.json`. Each entry needs `id`, `name`, `url`, `type` (`rss`/`devto`/`reddit`/`youtube`), optional `params`, and `defaultCategories`. The source is automatically included in the next page render.

### Adding a new source type

1. Add the type literal to `Source['type']` in `src/lib/types.ts`
2. Create `src/lib/fetchers/<type>.ts` exporting an async function `(source: Source) => Promise<ContentItem[]>`
3. Register it in the `FETCHERS` record in `src/lib/sources.ts`

### User customisations (runtime)

Categories and sources added via the UI are stored in `localStorage` under `veille:userCategories` and `veille:userSources`. They are merged with the base config client-side — user-added sources are not server-fetched (they require a new entry in `sources.json` and a redeploy to be fetched server-side).

## Deployment

- Vercel auto-deploys on push to `main`
- Set `YOUTUBE_API_KEY` in Vercel → Project → Settings → Environment Variables
- `@astrojs/vercel` adapter is configured in `astro.config.mjs`

## Sources status

Known unavailable RSS feeds (skipped from `sources.json`):
- IFTTD podcast — no public RSS feed (Webflow site, Spotify/Apple only)
- Marmicode — no RSS feed (Angular SSR site)
