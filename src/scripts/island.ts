interface ContentItem {
  id: string;
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  publishedAt: string;
  categories: string[];
  type: 'article' | 'video' | 'podcast';
}

interface Category {
  id: string;
  name: string;
  keywords: string[];
}

interface Source {
  id: string;
  name: string;
  defaultCategories: string[];
}

const KEYS = {
  theme: 'veille:theme',
  contentType: 'veille:contentType',
  hiddenSources: 'veille:hiddenSources',
  userCategories: 'veille:userCategories',
  userSources: 'veille:userSources',
};

const allItems: ContentItem[] = JSON.parse(
  document.getElementById('veille-data')!.textContent ?? '[]'
);
const baseSources: Source[] = JSON.parse(
  document.getElementById('veille-sources')!.textContent ?? '[]'
);
const baseCategories: Category[] = JSON.parse(
  document.getElementById('veille-categories')!.textContent ?? '[]'
);

function loadState() {
  return {
    activeTheme: localStorage.getItem(KEYS.theme) ?? '',
    activeType: localStorage.getItem(KEYS.contentType) ?? 'all',
    hiddenSources: JSON.parse(localStorage.getItem(KEYS.hiddenSources) ?? '[]') as string[],
    userCategories: JSON.parse(localStorage.getItem(KEYS.userCategories) ?? '[]') as Category[],
  };
}

function matchCategories(title: string, categories: Category[]): string[] {
  const lower = title.toLowerCase();
  return categories
    .filter((cat) => cat.keywords.some((kw) => lower.includes(kw.toLowerCase())))
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

function renderCard(item: ContentItem): string {
  const icon = ICONS[item.type] ?? '📄';
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
    </div>
  </article>`;
}

const TYPE_LABELS: Record<string, string> = {
  article: 'Articles',
  video: 'Vidéos',
  podcast: 'Podcasts',
};

const TYPE_ORDER = ['video', 'podcast', 'article'] as const;

function renderSection(type: string, items: ContentItem[]): string {
  if (items.length === 0) return '';
  const label = TYPE_LABELS[type] ?? type;
  const icon = ICONS[type] ?? '📄';
  return `<section class="mb-10">
    <h2 class="text-base font-semibold text-zinc-300 mb-4 flex items-center gap-2">
      <span>${icon}</span> ${label}
      <span class="text-xs font-normal text-zinc-500">${items.length}</span>
    </h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      ${items.map(renderCard).join('')}
    </div>
  </section>`;
}

function applyFilters() {
  const { activeTheme, activeType, hiddenSources, userCategories } = loadState();
  const allCategories = [...baseCategories, ...userCategories];

  const preFiltered = allItems
    .filter((item) => !hiddenSources.includes(item.sourceId))
    .filter((item) => {
      if (!activeTheme) return true;
      const cats = matchCategories(item.title, allCategories);
      return cats.includes(activeTheme) || item.categories.includes(activeTheme);
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
      grid.innerHTML = TYPE_ORDER.map((t) => renderSection(t, byType[t] ?? [])).join('');
    } else {
      grid.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">${visible.map(renderCard).join('')}</div>`;
    }
  }

  const countEl = document.getElementById('article-count');
  if (countEl) countEl.textContent = String(visible.length);
}

// --- Theme selector ---
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement | null;

function restoreUserCategories() {
  const userCats: Category[] = JSON.parse(localStorage.getItem(KEYS.userCategories) ?? '[]');
  userCats.forEach((cat) => {
    if (!document.querySelector(`#theme-select option[value="${cat.id}"]`)) {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      themeSelect?.appendChild(opt);
    }
  });
}

if (themeSelect) {
  restoreUserCategories();
  themeSelect.value = localStorage.getItem(KEYS.theme) ?? '';
  themeSelect.addEventListener('change', () => {
    localStorage.setItem(KEYS.theme, themeSelect.value);
    applyFilters();
  });
}

// --- Source checkboxes ---
function restoreHiddenSources() {
  const hidden: string[] = JSON.parse(localStorage.getItem(KEYS.hiddenSources) ?? '[]');
  document.querySelectorAll<HTMLInputElement>('.source-toggle').forEach((cb) => {
    if (hidden.includes(cb.dataset.sourceId ?? '')) cb.checked = false;
  });
}

restoreHiddenSources();

document.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;

  if (target.id === 'toggle-all-sources') {
    document.querySelectorAll<HTMLInputElement>('.source-toggle').forEach((cb) => {
      cb.checked = target.checked;
    });
    const allIds = [...baseSources, ...JSON.parse(localStorage.getItem(KEYS.userSources) ?? '[]')]
      .map((s: Source) => s.id);
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

  const id = `user-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const userSources: Source[] = JSON.parse(localStorage.getItem(KEYS.userSources) ?? '[]');
  if (!userSources.find((s) => s.id === id)) {
    userSources.push({ id, name, defaultCategories });
    localStorage.setItem(KEYS.userSources, JSON.stringify(userSources));

    const panel = document.getElementById('source-filter-panel');
    if (panel) {
      const label = document.createElement('label');
      label.className = 'flex items-center gap-2 text-sm py-1 cursor-pointer';
      label.innerHTML = `<input type="checkbox" class="source-toggle accent-indigo-400" data-source-id="${id}" checked /> <span>${name}</span>`;
      panel.appendChild(label);
    }
  }

  form.reset();
  (document.getElementById('add-source-modal') as HTMLDialogElement)?.close();
});

// --- Content type tabs ---
document.querySelectorAll<HTMLElement>('.content-type-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    localStorage.setItem(KEYS.contentType, btn.dataset.type ?? 'all');
    applyFilters();
  });
});

// --- Initial render ---
applyFilters();
