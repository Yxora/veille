interface ContentItem {
  id: string;
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  publishedAt: string;
  categories: string[];
  type: 'article' | 'video' | 'podcast';
  tags?: string[];
  description?: string;
}

interface Environment {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  keywords: string[];
  environment?: string;
}

interface Source {
  id: string;
  name: string;
  url?: string;
  type?: 'rss' | 'devto' | 'reddit' | 'youtube';
  environment?: string;
}

const KEYS = {
  selectedKeywords: 'veille:selectedKeywords',
  savedFilterActive: 'veille:savedFilterActive',
  contentType: 'veille:contentType',
  hiddenSources: 'veille:hiddenSources',
  userCategories: 'veille:userCategories',
  userSources: 'veille:userSources',
  userEnvironments: 'veille:userEnvironments',
  environment: 'veille:environment',
  gistId: 'veille:gistId',
  githubToken: 'veille:githubToken',
  deletedSources: 'veille:deletedSources',
  deletedCategories: 'veille:deletedCategories',
  deletedEnvironments: 'veille:deletedEnvironments',
  savedItems: 'veille:savedItems',
  maxAgeMonths: 'veille:maxAgeMonths',
  categoryOverrides: 'veille:categoryOverrides',
};

function getCategoryOverrides(): Record<string, { name: string; keywords: string[] }> {
  return JSON.parse(localStorage.getItem(KEYS.categoryOverrides) ?? '{}');
}

// { [categoryId]: string[] } — a category present with an empty/full/partial
// keyword list lets the filter select anywhere from one keyword to a whole category.
function getSelectedKeywords(): Record<string, string[]> {
  return JSON.parse(localStorage.getItem(KEYS.selectedKeywords) ?? '{}');
}

function isSavedFilterActive(): boolean {
  return localStorage.getItem(KEYS.savedFilterActive) === 'true';
}

function getSavedItems(): ContentItem[] {
  return JSON.parse(localStorage.getItem(KEYS.savedItems) ?? '[]');
}

function toggleSaved(item: ContentItem) {
  const saved = getSavedItems();
  const idx = saved.findIndex((i) => i.id === item.id);
  if (idx !== -1) {
    saved.splice(idx, 1);
  } else {
    saved.push(item);
  }
  localStorage.setItem(KEYS.savedItems, JSON.stringify(saved));
}

function getIdList(key: string): string[] {
  return JSON.parse(localStorage.getItem(key) ?? '[]');
}

function addToIdList(key: string, id: string) {
  const ids = getIdList(key);
  if (!ids.includes(id)) {
    ids.push(id);
    localStorage.setItem(key, JSON.stringify(ids));
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const GIST_FILENAME = 'veille-data.json';
const DEPLOY_WORKFLOW = 'deploy.yml';

function getGistConfig() {
  return {
    gistId: localStorage.getItem(KEYS.gistId) ?? '',
    token: localStorage.getItem(KEYS.githubToken) ?? '',
  };
}

function getRepoInfo(): { owner: string; repo: string } | null {
  const host = location.hostname;
  if (!host.endsWith('.github.io')) return null;
  const owner = host.split('.')[0];
  if (!owner) return null;
  const firstSegment = location.pathname.split('/').filter(Boolean)[0];
  const repo = firstSegment || `${owner}.github.io`;
  return { owner, repo };
}

async function triggerRebuild(token: string): Promise<void> {
  const repoInfo = getRepoInfo();
  if (!repoInfo) throw new Error('Impossible de déterminer le dépôt (owner/repo) depuis l’URL du site.');

  const res = await fetch(
    `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/${DEPLOY_WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );
  if (!res.ok) {
    const hint = res.status === 404 || res.status === 403
      ? ' (vérifie que le token a le scope "repo")'
      : '';
    throw new Error(`workflow_dispatch → HTTP ${res.status}${hint}`);
  }
}

type GistData = { sources: Source[]; categories: Category[]; environments: Environment[] };

async function updateGistContent(mutate: (current: GistData) => GistData) {
  const { gistId, token } = getGistConfig();
  if (!gistId || !token) return;

  try {
    const getRes = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!getRes.ok) throw new Error(`GET gist → HTTP ${getRes.status}`);
    const gist = await getRes.json();
    const filename = Object.keys(gist.files ?? {})[0] ?? GIST_FILENAME;
    const current = gist.files?.[filename]?.content ? JSON.parse(gist.files[filename].content) : {};

    const next = mutate({
      sources: current.sources ?? [],
      categories: current.categories ?? [],
      environments: current.environments ?? [],
    });

    const patchRes = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: { [filename]: { content: JSON.stringify(next, null, 2) } } }),
    });
    if (!patchRes.ok) throw new Error(`PATCH gist → HTTP ${patchRes.status}`);
  } catch (err) {
    console.error('[Veilleuse] updateGistContent error:', err);
    alert("Échec de l'écriture dans le Gist — vérifie le Gist ID et le token dans les réglages (⚙️ Sync GitHub).");
    return;
  }

  try {
    await triggerRebuild(token);
  } catch (err) {
    console.error('[Veilleuse] triggerRebuild error:', err);
    alert(
      `Enregistré dans le Gist, mais le rebuild automatique a échoué (${(err as Error).message}). ` +
      'Relance-le manuellement depuis l’onglet Actions du dépôt GitHub, ou attends le prochain cycle planifié.'
    );
  }
}

async function syncToGist(payload: { sources?: Source[]; categories?: Category[]; environments?: Environment[] }) {
  await updateGistContent((current) => ({
    sources: payload.sources ? [...current.sources, ...payload.sources] : current.sources,
    categories: payload.categories ? [...current.categories, ...payload.categories] : current.categories,
    environments: payload.environments ? [...current.environments, ...payload.environments] : current.environments,
  }));
}

async function removeFromGist(payload: { sourceId?: string; categoryId?: string; environmentId?: string }) {
  await updateGistContent((current) => ({
    sources: payload.sourceId ? current.sources.filter((s) => s.id !== payload.sourceId) : current.sources,
    categories: payload.categoryId
      ? current.categories.filter((c) => c.id !== payload.categoryId)
      : current.categories,
    environments: payload.environmentId
      ? current.environments.filter((e) => e.id !== payload.environmentId)
      : current.environments,
  }));
}

async function updateCategoryInGist(id: string, name: string, keywords: string[]) {
  await updateGistContent((current) => ({
    sources: current.sources,
    categories: current.categories.map((c) => (c.id === id ? { ...c, name, keywords } : c)),
    environments: current.environments,
  }));
}

const allItems: ContentItem[] = JSON.parse(
  document.getElementById('veille-data')!.textContent ?? '[]'
);
const baseSources: Source[] = JSON.parse(
  document.getElementById('veille-sources')!.textContent ?? '[]'
);
const baseCategories: Category[] = JSON.parse(
  document.getElementById('veille-categories')!.textContent ?? '[]'
);
const baseEnvironments: Environment[] = JSON.parse(
  document.getElementById('veille-environments')!.textContent ?? '[]'
);

function getAllEnvironments(): Environment[] {
  const baseIds = new Set(baseEnvironments.map((e) => e.id));
  const userEnvs: Environment[] = JSON.parse(localStorage.getItem(KEYS.userEnvironments) ?? '[]');
  const deleted = new Set(getIdList(KEYS.deletedEnvironments));
  return [...baseEnvironments, ...userEnvs.filter((e) => !baseIds.has(e.id))].filter((e) => !deleted.has(e.id));
}

function getActiveEnvironment(): string {
  const stored = localStorage.getItem(KEYS.environment) ?? '';
  const envs = getAllEnvironments();
  if (envs.some((e) => e.id === stored)) return stored;
  return envs[0]?.id ?? '';
}

// Once a locally-added source/category has been synced to the Gist and the
// site rebuilt, it comes back through baseSources/baseCategories — drop the
// now-redundant localStorage copy so it doesn't get listed twice.
function pruneSyncedUserItems() {
  const baseSourceIds = new Set(baseSources.map((s) => s.id));
  const userSources: Source[] = JSON.parse(localStorage.getItem(KEYS.userSources) ?? '[]');
  const prunedSources = userSources.filter((s) => !baseSourceIds.has(s.id));
  if (prunedSources.length !== userSources.length) {
    localStorage.setItem(KEYS.userSources, JSON.stringify(prunedSources));
  }

  const baseCategoryIds = new Set(baseCategories.map((c) => c.id));
  const userCats: Category[] = JSON.parse(localStorage.getItem(KEYS.userCategories) ?? '[]');
  const prunedCats = userCats.filter((c) => !baseCategoryIds.has(c.id));
  if (prunedCats.length !== userCats.length) {
    localStorage.setItem(KEYS.userCategories, JSON.stringify(prunedCats));
  }

  const baseEnvIds = new Set(baseEnvironments.map((e) => e.id));
  const userEnvs: Environment[] = JSON.parse(localStorage.getItem(KEYS.userEnvironments) ?? '[]');
  const prunedEnvs = userEnvs.filter((e) => !baseEnvIds.has(e.id));
  if (prunedEnvs.length !== userEnvs.length) {
    localStorage.setItem(KEYS.userEnvironments, JSON.stringify(prunedEnvs));
  }

  // Once an edited category's keywords have made it back through a rebuild,
  // the local override is redundant — drop it.
  const overrides = getCategoryOverrides();
  const baseById = new Map(baseCategories.map((c) => [c.id, c]));
  let overridesChanged = false;
  for (const [id, override] of Object.entries(overrides)) {
    const base = baseById.get(id);
    if (base && base.name === override.name && base.keywords.join(' ') === override.keywords.join(' ')) {
      delete overrides[id];
      overridesChanged = true;
    }
  }
  if (overridesChanged) localStorage.setItem(KEYS.categoryOverrides, JSON.stringify(overrides));
}

function getAllSources(): Source[] {
  const baseIds = new Set(baseSources.map((s) => s.id));
  const userSources: Source[] = JSON.parse(localStorage.getItem(KEYS.userSources) ?? '[]');
  const deleted = new Set(getIdList(KEYS.deletedSources));
  return [...baseSources, ...userSources.filter((s) => !baseIds.has(s.id))].filter((s) => !deleted.has(s.id));
}

function getAllCategories(): Category[] {
  const baseIds = new Set(baseCategories.map((c) => c.id));
  const userCats: Category[] = JSON.parse(localStorage.getItem(KEYS.userCategories) ?? '[]');
  const deleted = new Set(getIdList(KEYS.deletedCategories));
  const overrides = getCategoryOverrides();
  return [...baseCategories, ...userCats.filter((c) => !baseIds.has(c.id))]
    .filter((c) => !deleted.has(c.id))
    .map((c) => (overrides[c.id] ? { ...c, ...overrides[c.id] } : c));
}

function getEnvironmentCategories(env: string): Category[] {
  return getAllCategories().filter((c) => (c.environment ?? env) === env);
}

function getEnvironmentSources(env: string): Source[] {
  return getAllSources().filter((s) => (s.environment ?? env) === env);
}

function addEnvironment(name: string) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const envs: Environment[] = JSON.parse(localStorage.getItem(KEYS.userEnvironments) ?? '[]');
  if (getAllEnvironments().some((e) => e.id === id)) return;

  const env: Environment = { id, name };
  envs.push(env);
  localStorage.setItem(KEYS.userEnvironments, JSON.stringify(envs));

  localStorage.setItem(KEYS.environment, id);
  updateEnvironmentUI(id);
  syncToGist({ environments: [env] });
}

function deleteEnvironment(id: string) {
  const sourcesToDelete = getAllSources().filter((s) => s.environment === id);
  const categoriesToDelete = getAllCategories().filter((c) => c.environment === id);
  const sourceIds = new Set(sourcesToDelete.map((s) => s.id));
  const categoryIds = new Set(categoriesToDelete.map((c) => c.id));

  const count = sourcesToDelete.length + categoriesToDelete.length;
  const label = getAllEnvironments().find((e) => e.id === id)?.name ?? id;
  const warning = count > 0
    ? ` Ça supprimera aussi ${sourcesToDelete.length} source(s) et ${categoriesToDelete.length} catégorie(s) qui lui appartiennent.`
    : '';
  if (!confirm(`Supprimer l'environnement « ${label} » ?${warning}`)) return;

  // Update local state for the cascade in one pass (rather than looping
  // deleteSource/deleteCategory, which would each trigger their own Gist
  // round-trip and rebuild).
  const userSources: Source[] = JSON.parse(localStorage.getItem(KEYS.userSources) ?? '[]');
  localStorage.setItem(KEYS.userSources, JSON.stringify(userSources.filter((s) => !sourceIds.has(s.id))));
  for (const s of sourceIds) addToIdList(KEYS.deletedSources, s);

  const userCats: Category[] = JSON.parse(localStorage.getItem(KEYS.userCategories) ?? '[]');
  localStorage.setItem(KEYS.userCategories, JSON.stringify(userCats.filter((c) => !categoryIds.has(c.id))));
  for (const c of categoryIds) addToIdList(KEYS.deletedCategories, c);

  const hidden: string[] = JSON.parse(localStorage.getItem(KEYS.hiddenSources) ?? '[]');
  localStorage.setItem(KEYS.hiddenSources, JSON.stringify(hidden.filter((h) => !sourceIds.has(h))));

  const selected = getSelectedKeywords();
  for (const c of categoryIds) delete selected[c];
  localStorage.setItem(KEYS.selectedKeywords, JSON.stringify(selected));

  const userEnvs: Environment[] = JSON.parse(localStorage.getItem(KEYS.userEnvironments) ?? '[]');
  localStorage.setItem(KEYS.userEnvironments, JSON.stringify(userEnvs.filter((e) => e.id !== id)));
  addToIdList(KEYS.deletedEnvironments, id);

  const remaining = getAllEnvironments().filter((e) => e.id !== id);
  const nextEnv = remaining[0]?.id ?? '';
  localStorage.setItem(KEYS.environment, nextEnv);
  updateEnvironmentUI(nextEnv);

  updateGistContent((current) => ({
    sources: current.sources.filter((s) => !sourceIds.has(s.id)),
    categories: current.categories.filter((c) => !categoryIds.has(c.id)),
    environments: current.environments.filter((e) => e.id !== id),
  }));
}

function deleteSource(id: string) {
  const userSources: Source[] = JSON.parse(localStorage.getItem(KEYS.userSources) ?? '[]');
  localStorage.setItem(KEYS.userSources, JSON.stringify(userSources.filter((s) => s.id !== id)));

  const hidden: string[] = JSON.parse(localStorage.getItem(KEYS.hiddenSources) ?? '[]');
  localStorage.setItem(KEYS.hiddenSources, JSON.stringify(hidden.filter((h) => h !== id)));

  addToIdList(KEYS.deletedSources, id);
  updateEnvironmentUI(getActiveEnvironment());
  removeFromGist({ sourceId: id });
}

function deleteCategory(id: string) {
  const userCats: Category[] = JSON.parse(localStorage.getItem(KEYS.userCategories) ?? '[]');
  localStorage.setItem(KEYS.userCategories, JSON.stringify(userCats.filter((c) => c.id !== id)));

  const selected = getSelectedKeywords();
  if (selected[id]) {
    delete selected[id];
    localStorage.setItem(KEYS.selectedKeywords, JSON.stringify(selected));
  }

  addToIdList(KEYS.deletedCategories, id);
  updateEnvironmentUI(getActiveEnvironment());
  removeFromGist({ categoryId: id });
}

function editCategoryKeywords(id: string, name: string, keywords: string[]) {
  const overrides = getCategoryOverrides();
  overrides[id] = { name, keywords };
  localStorage.setItem(KEYS.categoryOverrides, JSON.stringify(overrides));

  // If it's a purely local (not-yet-synced) user category, update it in place too.
  const userCats: Category[] = JSON.parse(localStorage.getItem(KEYS.userCategories) ?? '[]');
  const idx = userCats.findIndex((c) => c.id === id);
  if (idx !== -1) {
    userCats[idx] = { id, name, keywords };
    localStorage.setItem(KEYS.userCategories, JSON.stringify(userCats));
  }

  // Drop any selected keywords that no longer exist on this category.
  const selected = getSelectedKeywords();
  if (selected[id]) {
    const stillValid = selected[id].filter((kw) => keywords.includes(kw));
    if (stillValid.length > 0) selected[id] = stillValid;
    else delete selected[id];
    localStorage.setItem(KEYS.selectedKeywords, JSON.stringify(selected));
  }

  updateEnvironmentUI(getActiveEnvironment());
  updateCategoryInGist(id, name, keywords);
}

function loadState() {
  return {
    activeType: localStorage.getItem(KEYS.contentType) ?? 'all',
    hiddenSources: JSON.parse(localStorage.getItem(KEYS.hiddenSources) ?? '[]') as string[],
    activeEnvironment: getActiveEnvironment(),
    maxAgeMonths: Number(localStorage.getItem(KEYS.maxAgeMonths) ?? '0'),
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordRegex(keyword: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(keyword)}(?![\\p{L}\\p{N}])`, 'iu');
}

function itemMatchesAnyKeyword(
  item: Pick<ContentItem, 'title' | 'tags' | 'description'>,
  keywords: string[]
): boolean {
  const haystack = [item.title, ...(item.tags ?? []), item.description ?? ''].join(' ');
  return keywords.some((kw) => keywordRegex(kw).test(haystack));
}

const ICONS: Record<string, string> = { article: '📄', video: '🎬', podcast: '🎙️' };

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function bookmarkIcon(saved: boolean): string {
  const path = 'M6 3a2 2 0 0 0-2 2v16l8-5 8 5V5a2 2 0 0 0-2-2H6z';
  return saved
    ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="${path}"/></svg>`
    : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="${path}"/></svg>`;
}

function renderCard(item: ContentItem, savedIds: Set<string>): string {
  const icon = ICONS[item.type] ?? '📄';
  const saved = savedIds.has(item.id);
  const escapedTitle = item.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<article
    class="bg-zinc-800 rounded-xl p-4 flex flex-col gap-2 hover:ring-1 hover:ring-indigo-400 transition"
    data-source="${item.sourceId}"
    data-categories="${item.categories.join(',')}"
    data-published="${item.publishedAt}"
  >
    <div class="flex items-start gap-2">
      <span class="text-base shrink-0 mt-0.5">${icon}</span>
      <a href="${item.url}" target="_blank" rel="noopener noreferrer" title="${escapedTitle}"
         class="text-zinc-100 text-sm font-medium leading-snug hover:text-indigo-400 transition line-clamp-3">
        ${escapedTitle}
      </a>
    </div>
    <div class="flex items-center gap-2 mt-auto text-xs text-zinc-400">
      <span class="bg-zinc-700 px-2 py-0.5 rounded-full shrink-0">${item.sourceName}</span>
      <span>${relativeDate(item.publishedAt)}</span>
      <button
        type="button"
        class="save-toggle ml-auto leading-none transition cursor-pointer ${saved ? 'text-indigo-400' : 'text-zinc-600 hover:text-zinc-300'}"
        data-save-id="${item.id}"
        title="${saved ? 'Retirer des favoris' : 'Sauvegarder'}"
      >${bookmarkIcon(saved)}</button>
    </div>
  </article>`;
}

const TYPE_LABELS: Record<string, string> = {
  article: 'Articles',
  video: 'Vidéos',
  podcast: 'Podcasts',
};

const TYPE_ORDER = ['video', 'podcast', 'article'] as const;

function renderSection(type: string, items: ContentItem[], savedIds: Set<string>): string {
  if (items.length === 0) return '';
  const label = TYPE_LABELS[type] ?? type;
  const icon = ICONS[type] ?? '📄';
  return `<section class="mb-10">
    <h2 class="text-base font-semibold text-zinc-300 mb-4 flex items-center gap-2">
      <span>${icon}</span> ${label}
      <span class="text-xs font-normal text-zinc-500">${items.length}</span>
    </h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      ${items.map((item) => renderCard(item, savedIds)).join('')}
    </div>
  </section>`;
}

const searchInput = document.getElementById('search-input') as HTMLInputElement | null;

searchInput?.addEventListener('input', () => applyFilters());

document.getElementById('articles-grid')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.save-toggle');
  if (!btn) return;
  const id = btn.dataset.saveId!;
  const item = allItems.find((i) => i.id === id) ?? getSavedItems().find((i) => i.id === id);
  if (!item) return;
  toggleSaved(item);
  applyFilters();
});

function applyFilters() {
  const { activeType, hiddenSources, activeEnvironment, maxAgeMonths } = loadState();
  const searchQuery = searchInput?.value.trim().toLowerCase() ?? '';

  const envSourceIds = new Set(getEnvironmentSources(activeEnvironment).map((s) => s.id));

  const savedItems = getSavedItems();
  const savedIds = new Set(savedItems.map((i) => i.id));
  const liveIds = new Set(allItems.map((i) => i.id));
  const savedFilterActive = isSavedFilterActive();
  // Saved items that have rolled off the source feed (and so aren't in
  // allItems anymore) still need to show up when browsing saved content.
  const baseList = savedFilterActive
    ? [...allItems, ...savedItems.filter((i) => !liveIds.has(i.id))]
    : allItems;

  const selectedFlatKeywords = Object.values(getSelectedKeywords()).flat();

  let maxAgeCutoff: string | null = null;
  if (maxAgeMonths > 0) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - maxAgeMonths);
    maxAgeCutoff = cutoff.toISOString();
  }

  const preFiltered = baseList
    .filter((item) => envSourceIds.has(item.sourceId))
    .filter((item) => !hiddenSources.includes(item.sourceId))
    .filter((item) => {
      if (savedFilterActive) return savedIds.has(item.id);
      if (selectedFlatKeywords.length === 0) return true;
      return itemMatchesAnyKeyword(item, selectedFlatKeywords);
    })
    .filter((item) => {
      // Saved items are kept regardless of age — that's the point of saving them.
      if (!maxAgeCutoff || savedIds.has(item.id)) return true;
      return item.publishedAt >= maxAgeCutoff;
    })
    .filter((item) => {
      if (!searchQuery) return true;
      return item.title.toLowerCase().includes(searchQuery) || item.sourceName.toLowerCase().includes(searchQuery);
    });

  const grid = document.getElementById('articles-grid')!;
  const noResults = document.getElementById('no-results')!;

  // Update tab counts
  const byType: Record<string, ContentItem[]> = {};
  for (const item of preFiltered) {
    (byType[item.type] ??= []).push(item);
  }
  document.querySelectorAll<HTMLElement>('.tab-count').forEach((el) => {
    const t = el.dataset.type ?? '';
    el.textContent = t === 'all' ? String(preFiltered.length) : String(byType[t]?.length ?? 0);
  });

  // Update active tab style
  document.querySelectorAll<HTMLElement>('.content-type-tab').forEach((btn) => {
    const active = btn.dataset.type === activeType;
    btn.setAttribute('aria-selected', String(active));
    btn.classList.toggle('border-indigo-400', active);
    btn.classList.toggle('text-indigo-400', active);
    btn.classList.toggle('bg-zinc-800', active);
    btn.classList.toggle('text-zinc-400', !active);
  });

  const visible = activeType === 'all' ? preFiltered : preFiltered.filter((i) => i.type === activeType);

  if (visible.length === 0) {
    grid.innerHTML = '';
    noResults.classList.remove('hidden');
  } else {
    noResults.classList.add('hidden');
    if (activeType === 'all') {
      grid.innerHTML = TYPE_ORDER.map((t) => renderSection(t, byType[t] ?? [], savedIds)).join('');
    } else {
      grid.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">${visible.map((item) => renderCard(item, savedIds)).join('')}</div>`;
    }
  }

  const countEl = document.getElementById('article-count');
  if (countEl) countEl.textContent = String(visible.length);
}

// --- Keywords filter panel ---
function renderKeywordsPanel() {
  const panel = document.getElementById('keywords-filter-panel');
  if (!panel) return;

  const selected = getSelectedKeywords();
  const savedActive = isSavedFilterActive();

  const savedRow = `<label class="flex items-center gap-2 text-sm pb-2 border-b border-zinc-700 cursor-pointer">
    <input type="checkbox" id="saved-filter-toggle" class="accent-indigo-400" ${savedActive ? 'checked' : ''} />
    <span>🔖 Contenu sauvegardé</span>
  </label>`;

  const categoryBlocks = getEnvironmentCategories(getActiveEnvironment())
    .map((cat) => {
      const selectedForCat = new Set(selected[cat.id] ?? []);
      const keywordRows = cat.keywords
        .map(
          (kw) => `<label class="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
        <input type="checkbox" class="keyword-toggle accent-indigo-400" data-category-id="${cat.id}" data-keyword="${escapeHtml(kw)}" ${selectedForCat.has(kw) ? 'checked' : ''} />
        <span>${escapeHtml(kw)}</span>
      </label>`
        )
        .join('');
      return `<div class="flex flex-col gap-1">
        <label class="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <input type="checkbox" class="category-toggle accent-indigo-400" data-category-id="${cat.id}" />
          <span>${escapeHtml(cat.name)}</span>
        </label>
        <div class="pl-6 flex flex-col gap-0.5">${keywordRows}</div>
      </div>`;
    })
    .join('');

  panel.innerHTML = savedRow + categoryBlocks;

  // Reflect partial selection on each category's master checkbox.
  panel.querySelectorAll<HTMLInputElement>('.category-toggle').forEach((cb) => {
    const catId = cb.dataset.categoryId!;
    const cat = getAllCategories().find((c) => c.id === catId);
    if (!cat || cat.keywords.length === 0) return;
    const checkedCount = cat.keywords.filter((kw) => (selected[catId] ?? []).includes(kw)).length;
    cb.checked = checkedCount === cat.keywords.length;
    cb.indeterminate = checkedCount > 0 && checkedCount < cat.keywords.length;
  });
}

document.getElementById('keywords-filter-panel')?.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;

  if (target.id === 'saved-filter-toggle') {
    localStorage.setItem(KEYS.savedFilterActive, String(target.checked));
    applyFilters();
    return;
  }

  const selected = getSelectedKeywords();

  if (target.classList.contains('category-toggle')) {
    const catId = target.dataset.categoryId!;
    const cat = getAllCategories().find((c) => c.id === catId);
    if (!cat) return;
    if (target.checked) selected[catId] = [...cat.keywords];
    else delete selected[catId];
    localStorage.setItem(KEYS.selectedKeywords, JSON.stringify(selected));
    renderKeywordsPanel();
    applyFilters();
    return;
  }

  if (target.classList.contains('keyword-toggle')) {
    const catId = target.dataset.categoryId!;
    const kw = target.dataset.keyword!;
    const list = new Set(selected[catId] ?? []);
    if (target.checked) list.add(kw);
    else list.delete(kw);
    if (list.size > 0) selected[catId] = [...list];
    else delete selected[catId];
    localStorage.setItem(KEYS.selectedKeywords, JSON.stringify(selected));
    renderKeywordsPanel();
    applyFilters();
  }
});

// --- Environment switcher ---
function renderEnvironmentSwitcher(activeEnv: string) {
  const switcher = document.getElementById('env-switcher');
  if (!switcher) return;

  switcher.innerHTML = getAllEnvironments()
    .map((e) => {
      const active = e.id === activeEnv;
      const activeClasses = active ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-400';
      return `<span class="env-btn-wrap inline-flex items-center rounded-full ${activeClasses} transition">
        <button
          type="button"
          class="env-btn px-3 py-1 text-xs font-semibold rounded-full"
          data-env="${e.id}"
          aria-pressed="${active}"
        >${escapeHtml(e.name)}</button>
        <button
          type="button"
          class="env-delete-btn pr-2 text-xs opacity-60 hover:opacity-100"
          data-delete-env="${e.id}"
          title="Supprimer cet environnement"
        >✕</button>
      </span>`;
    })
    .join('');
}

function updateEnvironmentUI(env: string) {
  renderEnvironmentSwitcher(env);

  // Repopulate SourceFilter
  const panel = document.getElementById('source-filter-panel');
  if (panel) {
    const masterLabel = panel.querySelector('label:first-child')?.cloneNode(true) as HTMLElement | null;
    panel.innerHTML = '';
    if (masterLabel) {
      const masterCb = masterLabel.querySelector<HTMLInputElement>('#toggle-all-sources');
      if (masterCb) masterCb.checked = true;
      panel.appendChild(masterLabel);
    }

    const hidden: string[] = JSON.parse(localStorage.getItem(KEYS.hiddenSources) ?? '[]');
    getEnvironmentSources(env).forEach((s) => {
      const label = document.createElement('label');
      label.className = 'flex items-center gap-2 text-sm py-1 cursor-pointer';
      const checked = !hidden.includes(s.id);
      label.innerHTML = `<input type="checkbox" class="source-toggle accent-indigo-400" data-source-id="${s.id}" ${checked ? 'checked' : ''} /> <span>${s.name}</span>`;
      panel.appendChild(label);
    });
  }

  // Keyword-based categories apply regardless of environment, so the same
  // full list is shown no matter which env is active — but re-render anyway
  // since add/delete/edit can happen at any time.
  renderKeywordsPanel();

  applyFilters();
}

document.getElementById('env-switcher')?.addEventListener('click', (e) => {
  const deleteBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-delete-env]');
  if (deleteBtn) {
    deleteEnvironment(deleteBtn.dataset.deleteEnv!);
    return;
  }

  const envBtn = (e.target as HTMLElement).closest<HTMLElement>('.env-btn');
  if (envBtn) {
    const env = envBtn.dataset.env!;
    localStorage.setItem(KEYS.environment, env);
    updateEnvironmentUI(env);
  }
});

document.getElementById('add-env-btn')?.addEventListener('click', () => {
  const name = prompt('Nom du nouvel environnement :')?.trim();
  if (name) addEnvironment(name);
});

// --- Max age selector ---
const maxAgeSelect = document.getElementById('max-age-select') as HTMLSelectElement | null;
if (maxAgeSelect) {
  maxAgeSelect.value = localStorage.getItem(KEYS.maxAgeMonths) ?? '0';
  maxAgeSelect.addEventListener('change', () => {
    localStorage.setItem(KEYS.maxAgeMonths, maxAgeSelect.value);
    applyFilters();
  });
}

// --- Source checkboxes ---
document.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;

  if (target.id === 'toggle-all-sources') {
    document.querySelectorAll<HTMLInputElement>('.source-toggle').forEach((cb) => {
      cb.checked = target.checked;
    });
    const allIds = getEnvironmentSources(getActiveEnvironment()).map((s) => s.id);
    localStorage.setItem(KEYS.hiddenSources, target.checked ? '[]' : JSON.stringify(allIds));
    applyFilters();
    return;
  }

  if (target.classList.contains('source-toggle')) {
    const sourceId = target.dataset.sourceId ?? '';
    const hidden: string[] = JSON.parse(localStorage.getItem(KEYS.hiddenSources) ?? '[]');
    if (target.checked) {
      const idx = hidden.indexOf(sourceId);
      if (idx !== -1) hidden.splice(idx, 1);
    } else if (!hidden.includes(sourceId)) {
      hidden.push(sourceId);
    }
    localStorage.setItem(KEYS.hiddenSources, JSON.stringify(hidden));
    applyFilters();
  }
});

function populateEnvironmentSelect(selectId: string) {
  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!select) return;
  const active = getActiveEnvironment();
  select.innerHTML = getAllEnvironments()
    .map((e) => `<option value="${e.id}" ${e.id === active ? 'selected' : ''}>${escapeHtml(e.name)}</option>`)
    .join('');
}

// --- Add Category modal ---
document.getElementById('open-add-category')?.addEventListener('click', () => {
  populateEnvironmentSelect('category-environment-select');
  (document.getElementById('add-category-modal') as HTMLDialogElement)?.showModal();
});
document.getElementById('cancel-category')?.addEventListener('click', () => {
  (document.getElementById('add-category-modal') as HTMLDialogElement)?.close();
});
document.getElementById('add-category-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
  const keywords = (form.elements.namedItem('keywords') as HTMLTextAreaElement)
    .value.split(',').map((k) => k.trim()).filter(Boolean);
  const environment = String(new FormData(form).get('environment')) || getActiveEnvironment();
  if (!name || keywords.length === 0) return;

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const userCats: Category[] = JSON.parse(localStorage.getItem(KEYS.userCategories) ?? '[]');
  if (!userCats.find((c) => c.id === id)) {
    userCats.push({ id, name, keywords, environment });
    localStorage.setItem(KEYS.userCategories, JSON.stringify(userCats));
    renderKeywordsPanel();
  }

  form.reset();
  (document.getElementById('add-category-modal') as HTMLDialogElement)?.close();

  syncToGist({ categories: [{ id, name, keywords, environment }] });
});

// --- Add Source modal ---
document.getElementById('open-add-source')?.addEventListener('click', () => {
  populateEnvironmentSelect('source-environment-select');
  (document.getElementById('add-source-modal') as HTMLDialogElement)?.showModal();
});
document.getElementById('cancel-source')?.addEventListener('click', () => {
  (document.getElementById('add-source-modal') as HTMLDialogElement)?.close();
});
document.getElementById('add-source-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const data = new FormData(form);
  const name = String(data.get('name')).trim();
  const url = String(data.get('url')).trim();
  const type = String(data.get('type'));
  const environment = String(data.get('environment')) || getActiveEnvironment();

  const id = `user-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const userSources: Source[] = JSON.parse(localStorage.getItem(KEYS.userSources) ?? '[]');
  let added: Source | null = null;
  if (!userSources.find((s) => s.id === id)) {
    added = { id, name, url, type: type as Source['type'], environment };
    userSources.push(added);
    localStorage.setItem(KEYS.userSources, JSON.stringify(userSources));

    // Only add to panel if it belongs to the current env
    if (environment === getActiveEnvironment()) {
      const panel = document.getElementById('source-filter-panel');
      if (panel) {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-sm py-1 cursor-pointer';
        label.innerHTML = `<input type="checkbox" class="source-toggle accent-indigo-400" data-source-id="${id}" checked /> <span>${name}</span>`;
        panel.appendChild(label);
      }
    }
  }

  form.reset();
  (document.getElementById('add-source-modal') as HTMLDialogElement)?.close();

  if (added) syncToGist({ sources: [added] });
});

// --- GitHub Gist sync settings ---
document.getElementById('open-gist-sync')?.addEventListener('click', () => {
  const form = document.getElementById('gist-sync-form') as HTMLFormElement | null;
  if (form) {
    (form.elements.namedItem('gistId') as HTMLInputElement).value = localStorage.getItem(KEYS.gistId) ?? '';
    (form.elements.namedItem('token') as HTMLInputElement).value = localStorage.getItem(KEYS.githubToken) ?? '';
  }
  (document.getElementById('gist-sync-modal') as HTMLDialogElement)?.showModal();
});
document.getElementById('cancel-gist-sync')?.addEventListener('click', () => {
  (document.getElementById('gist-sync-modal') as HTMLDialogElement)?.close();
});
document.getElementById('gist-sync-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const gistId = (form.elements.namedItem('gistId') as HTMLInputElement).value.trim();
  const token = (form.elements.namedItem('token') as HTMLInputElement).value.trim();

  localStorage.setItem(KEYS.gistId, gistId);
  localStorage.setItem(KEYS.githubToken, token);

  (document.getElementById('gist-sync-modal') as HTMLDialogElement)?.close();
});

// --- Manage (delete) modal ---
function renderRow(id: string, name: string, deleteAttr: string): string {
  return `<div class="flex items-center justify-between text-sm py-1">
    <span>${escapeHtml(name)}</span>
    <button type="button" class="text-zinc-500 hover:text-red-400 transition px-1" ${deleteAttr}="${id}" data-name="${escapeHtml(name)}" title="Supprimer">✕</button>
  </div>`;
}

function renderCategoryRow(cat: Category): string {
  const keywordsStr = cat.keywords.join(', ');
  return `<div class="flex flex-col gap-1 py-2 border-b border-zinc-700/50 last:border-0">
    <div class="flex items-center justify-between">
      <span class="text-sm">${escapeHtml(cat.name)}</span>
      <button type="button" class="text-zinc-500 hover:text-red-400 transition px-1" data-delete-category="${cat.id}" data-name="${escapeHtml(cat.name)}" title="Supprimer">✕</button>
    </div>
    <div class="flex items-center gap-2">
      <input
        type="text"
        class="input text-xs py-1"
        data-keywords-input="${cat.id}"
        data-name="${escapeHtml(cat.name)}"
        value="${escapeHtml(keywordsStr)}"
      />
      <button
        type="button"
        class="text-zinc-500 hover:text-indigo-400 transition px-1 shrink-0"
        data-save-keywords="${cat.id}"
        title="Enregistrer les mots-clés"
      >💾</button>
    </div>
  </div>`;
}

function renderManageLists() {
  const sourcesList = document.getElementById('manage-sources-list');
  if (sourcesList) {
    const sources = getAllSources();
    sourcesList.innerHTML = sources.length
      ? sources.map((s) => renderRow(s.id, s.name, 'data-delete-source')).join('')
      : '<p class="text-xs text-zinc-500">Aucune source.</p>';
  }

  const categoriesList = document.getElementById('manage-categories-list');
  if (categoriesList) {
    const categories = getAllCategories();
    categoriesList.innerHTML = categories.length
      ? categories.map(renderCategoryRow).join('')
      : '<p class="text-xs text-zinc-500">Aucun mot clé.</p>';
  }
}

document.getElementById('open-manage')?.addEventListener('click', () => {
  renderManageLists();
  (document.getElementById('manage-modal') as HTMLDialogElement)?.showModal();
});
document.getElementById('close-manage')?.addEventListener('click', () => {
  (document.getElementById('manage-modal') as HTMLDialogElement)?.close();
});
document.getElementById('manage-sources-list')?.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-delete-source]');
  if (!target) return;
  const id = target.dataset.deleteSource!;
  if (confirm(`Supprimer la source « ${target.dataset.name} » ?`)) {
    deleteSource(id);
    renderManageLists();
  }
});
document.getElementById('manage-categories-list')?.addEventListener('click', (e) => {
  const deleteBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-delete-category]');
  if (deleteBtn) {
    const id = deleteBtn.dataset.deleteCategory!;
    if (confirm(`Supprimer le mot clé « ${deleteBtn.dataset.name} » ?`)) {
      deleteCategory(id);
      renderManageLists();
    }
    return;
  }

  const saveBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-save-keywords]');
  if (saveBtn) {
    const id = saveBtn.dataset.saveKeywords!;
    const input = document.querySelector<HTMLInputElement>(`[data-keywords-input="${id}"]`);
    if (!input) return;
    const keywords = input.value.split(',').map((k) => k.trim()).filter(Boolean);
    if (keywords.length === 0) return;
    editCategoryKeywords(id, input.dataset.name ?? id, keywords);
    renderManageLists();
  }
});

// --- Content type tabs ---
document.querySelectorAll<HTMLElement>('.content-type-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    localStorage.setItem(KEYS.contentType, btn.dataset.type ?? 'all');
    applyFilters();
  });
});

// --- Initial render ---
pruneSyncedUserItems();
updateEnvironmentUI(getActiveEnvironment());
