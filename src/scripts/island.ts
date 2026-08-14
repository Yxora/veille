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

interface Category {
  id: string;
  name: string;
  keywords: string[];
}

interface Source {
  id: string;
  name: string;
  url?: string;
  type?: 'rss' | 'devto' | 'reddit' | 'youtube';
  defaultCategories: string[];
  environment?: 'tech' | 'humanites';
}

const KEYS = {
  theme: 'veille:theme',
  contentType: 'veille:contentType',
  hiddenSources: 'veille:hiddenSources',
  userCategories: 'veille:userCategories',
  userSources: 'veille:userSources',
  environment: 'veille:environment',
  gistId: 'veille:gistId',
  githubToken: 'veille:githubToken',
  deletedSources: 'veille:deletedSources',
  deletedCategories: 'veille:deletedCategories',
  savedItems: 'veille:savedItems',
  maxAgeMonths: 'veille:maxAgeMonths',
};

const SAVED_THEME_ID = '__saved__';

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

type GistData = { sources: Source[]; categories: Category[] };

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

    const next = mutate({ sources: current.sources ?? [], categories: current.categories ?? [] });

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
    console.error('[Veille] updateGistContent error:', err);
    alert("Échec de l'écriture dans le Gist — vérifie le Gist ID et le token dans les réglages (⚙️ Sync GitHub).");
    return;
  }

  try {
    await triggerRebuild(token);
  } catch (err) {
    console.error('[Veille] triggerRebuild error:', err);
    alert(
      `Enregistré dans le Gist, mais le rebuild automatique a échoué (${(err as Error).message}). ` +
      'Relance-le manuellement depuis l’onglet Actions du dépôt GitHub, ou attends le prochain cycle planifié.'
    );
  }
}

async function syncToGist(payload: { sources?: Source[]; categories?: Category[] }) {
  await updateGistContent((current) => ({
    sources: payload.sources ? [...current.sources, ...payload.sources] : current.sources,
    categories: payload.categories ? [...current.categories, ...payload.categories] : current.categories,
  }));
}

async function removeFromGist(payload: { sourceId?: string; categoryId?: string }) {
  await updateGistContent((current) => ({
    sources: payload.sourceId ? current.sources.filter((s) => s.id !== payload.sourceId) : current.sources,
    categories: payload.categoryId
      ? current.categories.filter((c) => c.id !== payload.categoryId)
      : current.categories,
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

function getActiveEnvironment(): 'tech' | 'humanites' {
  return (localStorage.getItem(KEYS.environment) as 'tech' | 'humanites') ?? 'tech';
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
  return [...baseCategories, ...userCats.filter((c) => !baseIds.has(c.id))].filter((c) => !deleted.has(c.id));
}

function getEnvironmentSources(env: 'tech' | 'humanites'): Source[] {
  return getAllSources().filter((s) => (s.environment ?? 'tech') === env);
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

  if (localStorage.getItem(KEYS.theme) === id) localStorage.setItem(KEYS.theme, '');

  addToIdList(KEYS.deletedCategories, id);
  updateEnvironmentUI(getActiveEnvironment());
  removeFromGist({ categoryId: id });
}

function getEnvironmentCategoryIds(env: 'tech' | 'humanites'): Set<string> {
  const ids = new Set<string>();
  for (const s of getEnvironmentSources(env)) {
    for (const catId of s.defaultCategories) ids.add(catId);
  }
  return ids;
}

function loadState() {
  return {
    activeTheme: localStorage.getItem(KEYS.theme) ?? '',
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

function matchCategories(
  item: Pick<ContentItem, 'title' | 'tags' | 'description'>,
  categories: Category[]
): string[] {
  const haystack = [item.title, ...(item.tags ?? []), item.description ?? ''].join(' ');
  return categories
    .filter((cat) => cat.keywords.some((kw) => keywordRegex(kw).test(haystack)))
    .map((cat) => cat.id);
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

function renderCard(item: ContentItem, savedIds: Set<string>): string {
  const icon = ICONS[item.type] ?? '📄';
  const saved = savedIds.has(item.id);
  return `<article
    class="bg-zinc-800 rounded-xl p-4 flex flex-col gap-2 hover:ring-1 hover:ring-indigo-400 transition"
    data-source="${item.sourceId}"
    data-categories="${item.categories.join(',')}"
    data-published="${item.publishedAt}"
  >
    <div class="flex items-start gap-2">
      <span class="text-base shrink-0 mt-0.5">${icon}</span>
      <a href="${item.url}" target="_blank" rel="noopener noreferrer"
         class="text-zinc-100 text-sm font-medium leading-snug hover:text-indigo-400 transition line-clamp-3">
        ${item.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
      </a>
    </div>
    <div class="flex items-center gap-2 mt-auto text-xs text-zinc-400">
      <span class="bg-zinc-700 px-2 py-0.5 rounded-full shrink-0">${item.sourceName}</span>
      <span>${relativeDate(item.publishedAt)}</span>
      <button
        type="button"
        class="save-toggle ml-auto text-sm leading-none transition cursor-pointer ${saved ? 'text-indigo-400' : 'text-zinc-600 hover:text-zinc-300'}"
        data-save-id="${item.id}"
        title="${saved ? 'Retirer des favoris' : 'Sauvegarder'}"
      >🔖</button>
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
  const { activeTheme, activeType, hiddenSources, activeEnvironment, maxAgeMonths } = loadState();
  const allCategories = getAllCategories();
  const searchQuery = searchInput?.value.trim().toLowerCase() ?? '';

  const envSourceIds = new Set(getEnvironmentSources(activeEnvironment).map((s) => s.id));

  const savedItems = getSavedItems();
  const savedIds = new Set(savedItems.map((i) => i.id));
  const liveIds = new Set(allItems.map((i) => i.id));
  // Saved items that have rolled off the source feed (and so aren't in
  // allItems anymore) still need to show up when browsing saved content.
  const baseList =
    activeTheme === SAVED_THEME_ID
      ? [...allItems, ...savedItems.filter((i) => !liveIds.has(i.id))]
      : allItems;

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
      if (!activeTheme) return true;
      if (activeTheme === SAVED_THEME_ID) return savedIds.has(item.id);
      const cats = matchCategories(item, allCategories);
      return cats.includes(activeTheme) || item.categories.includes(activeTheme);
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

// --- Theme selector ---
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement | null;

// --- Environment switcher ---
function updateEnvironmentUI(env: 'tech' | 'humanites') {
  // Update button styles
  document.querySelectorAll<HTMLElement>('.env-btn').forEach((btn) => {
    const active = btn.dataset.env === env;
    btn.setAttribute('aria-pressed', String(active));
    btn.classList.toggle('bg-indigo-500', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('bg-zinc-800', !active);
    btn.classList.toggle('text-zinc-400', !active);
  });

  const envLabel = document.getElementById('env-label');
  if (envLabel) {
    envLabel.textContent = env === 'tech' ? 'tech dashboard' : 'humanités dashboard';
  }

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

  // Repopulate ThemeSelector — only categories relevant to this env
  if (themeSelect) {
    const currentTheme = localStorage.getItem(KEYS.theme) ?? '';
    const envCatIds = getEnvironmentCategoryIds(env);
    const allCats = getAllCategories();

    themeSelect.innerHTML = '<option value="">— Tout voir —</option>';
    const savedOpt = document.createElement('option');
    savedOpt.value = SAVED_THEME_ID;
    savedOpt.textContent = '🔖 Contenu sauvegardé';
    themeSelect.appendChild(savedOpt);
    allCats
      .filter((cat) => envCatIds.has(cat.id))
      .forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        themeSelect.appendChild(opt);
      });

    // Clear active theme if it doesn't belong to the new env
    if (currentTheme && currentTheme !== SAVED_THEME_ID && !envCatIds.has(currentTheme)) {
      localStorage.setItem(KEYS.theme, '');
      themeSelect.value = '';
    } else {
      themeSelect.value = currentTheme;
    }
  }

  applyFilters();
}

document.querySelectorAll<HTMLElement>('.env-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const env = (btn.dataset.env ?? 'tech') as 'tech' | 'humanites';
    localStorage.setItem(KEYS.environment, env);
    updateEnvironmentUI(env);
  });
});

if (themeSelect) {
  themeSelect.addEventListener('change', () => {
    localStorage.setItem(KEYS.theme, themeSelect.value);
    applyFilters();
  });
}

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

// --- Add Category modal ---
document.getElementById('open-add-category')?.addEventListener('click', () => {
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
  if (!name || keywords.length === 0) return;

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const userCats: Category[] = JSON.parse(localStorage.getItem(KEYS.userCategories) ?? '[]');
  if (!userCats.find((c) => c.id === id)) {
    userCats.push({ id, name, keywords });
    localStorage.setItem(KEYS.userCategories, JSON.stringify(userCats));
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = name;
    themeSelect?.appendChild(opt);

    // Also add checkbox to source modal category list
    const list = document.getElementById('source-categories-list');
    if (list) {
      const label = document.createElement('label');
      label.className = 'flex items-center gap-1.5 text-sm cursor-pointer';
      label.innerHTML = `<input type="checkbox" name="categories" value="${id}" class="accent-indigo-400" /> ${name}`;
      list.appendChild(label);
    }
  }

  form.reset();
  (document.getElementById('add-category-modal') as HTMLDialogElement)?.close();

  syncToGist({ categories: [{ id, name, keywords }] });
});

// --- Add Source modal ---
document.getElementById('open-add-source')?.addEventListener('click', () => {
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
  const defaultCategories = data.getAll('categories') as string[];
  const environment = (String(data.get('environment')) as 'tech' | 'humanites') || getActiveEnvironment();

  const id = `user-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const userSources: Source[] = JSON.parse(localStorage.getItem(KEYS.userSources) ?? '[]');
  let added: Source | null = null;
  if (!userSources.find((s) => s.id === id)) {
    added = { id, name, url, type: type as Source['type'], defaultCategories, environment };
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
      ? categories.map((c) => renderRow(c.id, c.name, 'data-delete-category')).join('')
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
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-delete-category]');
  if (!target) return;
  const id = target.dataset.deleteCategory!;
  if (confirm(`Supprimer le mot clé « ${target.dataset.name} » ?`)) {
    deleteCategory(id);
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
