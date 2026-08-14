# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Veille" — a personal tech-news dashboard built with Astro, deployed as a static site on GitHub Pages via GitHub Actions. It fetches articles, videos, and podcasts from sources (RSS feeds, Dev.to API, Reddit JSON API, YouTube Data API v3) at build time, annotates them with categories via keyword matching, and renders a filterable dark-mode UI.

`src/data/sources.json` and `src/data/categories.json` ship empty (`[]`) — this repo is meant to be forked as a neutral starting point, with each fork's actual sources/categories living in their own Gist (see "User customisations" below) and/or added through the UI.

## Commands

```bash
npm run dev       # start local dev server at http://localhost:4321
npm run build     # build for production (static output to dist/)
npm run preview   # preview the production build locally
```

To enable YouTube sources, and/or Gist-backed sources, locally, create `.env.local` (not committed):
```
YOUTUBE_API_KEY=your_key_here
GIST_ID=your_gist_id           # optional
GIST_TOKEN=your_pat            # optional, only needed for a private Gist
```

## Architecture

### Data flow

1. `src/pages/index.astro` calls `fetchAllSources(sources)` once, at **build time** (static output — there is no per-request server)
2. `src/lib/sources.ts` dispatches each source to the right fetcher via a `FETCHERS` record keyed by `Source['type']`
3. Fetchers return `ContentItem[]`; failures are caught by `Promise.allSettled` and logged — one broken source never kills the build
4. `annotateItems()` from `src/lib/categories.ts` does case-insensitive, word-bounded keyword matching (Unicode-aware — handles accents, unlike JS's ASCII-only `\b`) against `src/data/categories.json` to assign category IDs to each item — matched against the title, any `tags` the fetcher extracted from the feed (RSS `<category>`, Dev.to `tag_list`, Reddit flair), and the item's `description` (RSS `<description>`/`<summary>`, Dev.to/YouTube description, Reddit selftext — HTML-stripped and capped at 400 chars). A keyword like `ski` won't match inside "Skinner", but also won't match "skis" — add plural/variant forms as separate keywords if needed.
5. All data is serialized into three `<script type="application/json">` islands in the HTML
6. `src/scripts/island.ts` (vanilla TS, no framework) reads those islands and re-renders the grid based on localStorage state (active theme, hidden sources, user-added categories/sources)
7. Because content is now baked in at build time, freshness depends on how often the site rebuilds — see Deployment below

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
| `src/pages/index.astro` | Main page, rendered statically at build time |
| `src/scripts/island.ts` | Client-side filtering, localStorage state, modal handlers |

### Adding a new source

Edit `src/data/sources.json` (empty by default — see "Project" above), or add it through the UI / a synced Gist. Each entry needs `id`, `name`, `url`, `type` (`rss`/`devto`/`reddit`/`youtube`), optional `params`, and `defaultCategories`. The source is automatically included in the next page render.

### Adding a new source type

1. Add the type literal to `Source['type']` in `src/lib/types.ts`
2. Create `src/lib/fetchers/<type>.ts` exporting an async function `(source: Source) => Promise<ContentItem[]>`
3. Register it in the `FETCHERS` record in `src/lib/sources.ts`

### User customisations (runtime + Gist sync)

Categories and sources added via the UI are stored in `localStorage` under `veille:userCategories` and `veille:userSources`, and merged with the base config client-side immediately (so the UI reflects them right away).

Optionally, each fork can also sync those additions to a personal GitHub Gist so they get **actually fetched** (not just displayed as an empty entry) and persist across devices/rebuilds:

1. Create a Gist (public is fine) containing one file named `veille-data.json` with `{"sources":[],"categories":[]}`.
2. In the deployed site, open **⚙️ Sync GitHub** and paste the Gist ID and a GitHub personal access token (classic; scopes `gist` + `repo`). This is stored only in that browser's `localStorage` (`veille:gistId`, `veille:githubToken`) — never committed.
3. Set the same Gist ID as the `GIST_ID` repository secret (and `GIST_TOKEN` too if the Gist is private) so the **build** can also read it — see `src/lib/gist.ts`.

Flow: adding a source/category → saved to `localStorage` (instant UI) → PATCHed into the Gist → a `workflow_dispatch` call immediately re-triggers `.github/workflows/deploy.yml`, so the new source is actually fetched within the next build/deploy (roughly a minute or two), not just at the next scheduled run. `src/pages/index.astro` merges `sources.json`/`categories.json` with the Gist content at build time via `fetchGistData()`.

Deletion works the same way in reverse, from the **🗑 Gérer** modal (`ManageModal.astro`): removing a source/category calls `deleteSource()`/`deleteCategory()` in `island.ts`, which drops it from `localStorage`, records its id in `veille:deletedSources`/`veille:deletedCategories` (so it's hidden immediately even before the next build), and calls `removeFromGist()` to PATCH it out of the Gist and trigger a rebuild.

### Max age filter

`MaxAgeSelector.astro` lets the user cap displayed content by age (1/3/6/12 months, or unlimited), stored in `localStorage` as `veille:maxAgeMonths` and applied client-side in `applyFilters()` against `item.publishedAt`. Saved items (see below) are always exempt from this filter. This is a **display filter only** — it doesn't change what gets fetched at build time. Fetchers pull whatever their source naturally returns (e.g. an RSS feed's last ~20-50 entries), so picking "12 mois" won't retroactively surface older content that was never fetched; it only avoids hiding old items that happen to still be in the feed's window.

### Saved items

Each card has a 🔖 button (`renderCard()` in `island.ts`) that saves/unsaves an item into `localStorage` under `veille:savedItems` — **as a full `ContentItem` snapshot, not just an id**, since articles aren't persisted anywhere server-side and would otherwise vanish once they roll off the source feed's fetch window on a later rebuild. A synthetic `__saved__` entry is always injected into the Mots clés `<select>` (`updateEnvironmentUI()`); selecting it filters to saved items, unioning in any saved snapshots that are no longer in the live `allItems` list. Clicking 🔖 again on a saved item (from any view, including the saved view itself) removes it — there's no separate delete UI, unsaving *is* deleting.

This is what makes "one client, many people's own sources" possible: everyone forks the same code, but points their fork at their own Gist — no code changes needed per person.

## Deployment

- Static site (`output: 'static'` in `astro.config.mjs`), built and deployed via `.github/workflows/deploy.yml` to GitHub Pages
- The workflow runs on push to `main`, on push-triggered `workflow_dispatch` calls from the browser (see above), on a schedule (every 3 hours, as a fallback to refresh already-tracked feeds), and can be triggered manually
- Set `YOUTUBE_API_KEY` as a repository secret: GitHub repo → Settings → Secrets and variables → Actions
- Optionally set `GIST_ID` (and `GIST_TOKEN` for a private Gist) the same way, for the Gist-backed sources described above
- In repo Settings → Pages, set the source to "GitHub Actions"
- `site` and `base` in `astro.config.mjs` are set for the `marionLa/veille` project page (`https://marionla.github.io/veille`) — update both if the repo is renamed or moved to a user/org page or forked under a different name
