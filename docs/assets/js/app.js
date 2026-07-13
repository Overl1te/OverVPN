const storageKey = 'overvpn-docs-theme';
const root = document.documentElement;
const body = document.body;

const menuToggle = document.querySelector('.menu-toggle');
const themeToggle = document.querySelector('.theme-toggle');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const searchTrigger = document.getElementById('search-trigger');
const searchModal = document.getElementById('search-modal');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchKbd = document.getElementById('search-kbd');
const toc = document.getElementById('toc');
const tocNav = document.getElementById('toc-nav');
const content = document.querySelector('.content-inner');

let pagefindModule = null;
let pagefindReady = false;
let searchActiveIndex = -1;
let searchResultItems = [];
let searchRequestId = 0;

function applyTheme(theme) {
  root.setAttribute('data-theme', theme);
  localStorage.setItem(storageKey, theme);
}

function initTheme() {
  const saved = localStorage.getItem(storageKey);
  if (saved === 'light' || saved === 'dark') {
    applyTheme(saved);
    return;
  }
  applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function initSearchKbd() {
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  if (searchKbd) {
    searchKbd.textContent = isMac ? '⌘ K' : 'Ctrl K';
  }
}

function setSidebarOpen(open) {
  body.classList.toggle('sidebar-open', open);
  menuToggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (sidebarOverlay) {
    sidebarOverlay.hidden = !open;
  }
}

function initSidebar() {
  menuToggle?.addEventListener('click', () => {
    setSidebarOpen(!body.classList.contains('sidebar-open'));
  });

  sidebarOverlay?.addEventListener('click', () => setSidebarOpen(false));

  document.querySelectorAll('.sidebar a').forEach((link) => {
    link.addEventListener('click', () => setSidebarOpen(false));
  });
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\u0400-\u04FF\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function initHeadingAnchors() {
  if (!content) return;

  const used = new Set();
  content.querySelectorAll('h2, h3').forEach((heading) => {
    if (!heading.id) {
      let base = slugify(heading.textContent || 'section');
      let id = base;
      let n = 2;
      while (used.has(id)) {
        id = `${base}-${n}`;
        n += 1;
      }
      heading.id = id;
      used.add(id);
    }

    if (heading.querySelector('.heading-anchor')) return;

    const anchor = document.createElement('a');
    anchor.className = 'heading-anchor';
    anchor.href = `#${heading.id}`;
    anchor.setAttribute('aria-label', 'Ссылка на раздел');
    anchor.innerHTML = '#';
    heading.appendChild(anchor);
  });
}

function initToc() {
  if (!content || !toc || !tocNav || body.classList.contains('page-home')) return;

  const headings = content.querySelectorAll('h2, h3');
  if (headings.length < 2) return;

  toc.hidden = false;
  const links = [];

  headings.forEach((heading) => {
    const level = heading.tagName === 'H2' ? 2 : 3;
    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent?.replace(/#$/, '').trim() || '';
    link.className = `toc-link toc-level-${level}`;
    link.dataset.target = heading.id;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', `#${heading.id}`);
    });
    tocNav.appendChild(link);
    links.push({ link, heading });
  });

  if (links.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length === 0) return;
      const id = visible[0].target.id;
      links.forEach(({ link }) => {
        link.classList.toggle('active', link.dataset.target === id);
      });
    },
    { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
  );

  links.forEach(({ heading }) => observer.observe(heading));
}

function splitCopyUnits(text) {
  const lines = text.split('\n');
  const units = [];
  let buffer = [];

  for (const line of lines) {
    buffer.push(line);
    if (line.trimEnd().endsWith('\\')) {
      continue;
    }
    units.push(buffer.join('\n'));
    buffer = [];
  }

  if (buffer.length) {
    units.push(buffer.join('\n'));
  }

  return units.filter((unit) => unit.trim().length > 0);
}

function parseCommandLine(unit) {
  const trimmed = unit.trim();
  if (!trimmed) {
    return { command: '', comment: '' };
  }

  if (trimmed.startsWith('#')) {
    return { command: '', comment: trimmed.replace(/^#\s?/, '') };
  }

  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < unit.length; i += 1) {
    const char = unit[i];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (char === '#' && !inSingle && !inDouble) {
      const command = unit.slice(0, i).trimEnd();
      const comment = unit.slice(i + 1).trim();
      if (command) {
        return { command, comment };
      }
    }
  }

  return { command: unit.trimEnd(), comment: '' };
}

function getCopyText(unit) {
  const lines = unit.split('\n');
  const commands = lines.map((line) => parseCommandLine(line).command).filter(Boolean);
  return commands.join('\n').trim();
}

function parseCommandUnit(unit) {
  const command = getCopyText(unit);
  let comment = '';

  for (let i = unit.split('\n').length - 1; i >= 0; i -= 1) {
    const parsed = parseCommandLine(unit.split('\n')[i]);
    if (parsed.comment) {
      comment = parsed.comment;
      break;
    }
  }

  if (!command && !comment) {
    const parsed = parseCommandLine(unit);
    return parsed;
  }

  return { command, comment };
}

function createLineCopyButton(getText) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy-btn copy-btn-line';
  btn.setAttribute('aria-label', 'Копировать строку');
  btn.innerHTML = `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>
  `;

  btn.addEventListener('click', async () => {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add('copied');
      btn.setAttribute('aria-label', 'Скопировано');
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.setAttribute('aria-label', 'Копировать строку');
      }, 1500);
    } catch {
      btn.setAttribute('aria-label', 'Ошибка копирования');
    }
  });

  return btn;
}

function initCopyButtons() {
  if (!content) return;

  content.querySelectorAll('pre').forEach((pre) => {
    if (pre.closest('.code-block')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    pre.parentNode?.insertBefore(wrapper, pre);

    const code = pre.querySelector('code');
    const langMatch = code?.className.match(/language-([\w-]+)/);
    const lang = langMatch?.[1] || pre.dataset.lang;
    const rawText = code?.textContent || pre.textContent || '';
    const units = splitCopyUnits(rawText);

    if (lang && code && !langMatch) {
      code.classList.add(`language-${lang}`);
    }

    if (lang) {
      const toolbar = document.createElement('div');
      toolbar.className = 'code-toolbar';

      const badge = document.createElement('span');
      badge.className = 'code-lang';
      badge.textContent = lang;
      toolbar.appendChild(badge);
      wrapper.appendChild(toolbar);
    }

    const linesContainer = document.createElement('div');
    linesContainer.className = 'code-lines';

    units.forEach((unit) => {
      const row = document.createElement('div');
      const parsed = parseCommandUnit(unit);
      const copyText = parsed.command;
      const isCommentOnly = !copyText && parsed.comment;

      row.className = isCommentOnly ? 'code-line code-line-note' : 'code-line';

      if (copyText) {
        const textEl = document.createElement('code');
        textEl.className = 'code-line-text';
        textEl.textContent = copyText;
        row.appendChild(textEl);
      }

      if (parsed.comment) {
        const commentEl = document.createElement('span');
        commentEl.className = 'code-line-comment';
        commentEl.textContent = parsed.comment;
        row.appendChild(commentEl);
      }

      if (copyText) {
        row.appendChild(createLineCopyButton(() => copyText));
      }

      linesContainer.appendChild(row);
    });

    wrapper.appendChild(linesContainer);
    pre.remove();
  });
}

async function ensurePagefind() {
  if (pagefindReady && pagefindModule) return pagefindModule;

  const base = window.DOCS_BASE || '/';
  const moduleUrl = `${base}pagefind/pagefind.js`;
  pagefindModule = await import(moduleUrl);
  await pagefindModule.options({ basePath: `${base}pagefind/` });
  pagefindModule.init();
  pagefindReady = true;
  return pagefindModule;
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function resolveUrl(url) {
  if (!url) return '#';
  if (/^https?:\/\//.test(url)) return url;
  const base = window.DOCS_BASE || '/';
  if (url.startsWith(base)) return url;
  if (url.startsWith('/')) return `${base.replace(/\/$/, '')}${url}`;
  return `${base}${url.replace(/^\//, '')}`;
}

function renderSearchEmpty(message) {
  searchResults.innerHTML = `<p class="search-empty">${message}</p>`;
  searchResultItems = [];
  searchActiveIndex = -1;
}

function renderSearchResults(items) {
  if (items.length === 0) {
    renderSearchEmpty('Ничего не найдено');
    return;
  }

  searchResults.innerHTML = items
    .map(
      (item, i) => `
      <a class="search-result${i === searchActiveIndex ? ' active' : ''}"
         href="${item.url}"
         role="option"
         aria-selected="${i === searchActiveIndex}"
         data-index="${i}">
        <span class="search-result-title">${escapeHtml(item.title)}</span>
        ${item.excerpt ? `<span class="search-result-excerpt">${item.excerpt}</span>` : ''}
      </a>
    `,
    )
    .join('');

  searchResultItems = items;
  searchResults.querySelectorAll('.search-result').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      searchActiveIndex = Number(el.dataset.index);
      updateSearchActive();
    });
  });
}

function updateSearchActive() {
  searchResults.querySelectorAll('.search-result').forEach((el, i) => {
    const active = i === searchActiveIndex;
    el.classList.toggle('active', active);
    el.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) el.scrollIntoView({ block: 'nearest' });
  });
}

async function runSearch(query) {
  const requestId = ++searchRequestId;

  if (!query.trim()) {
    renderSearchEmpty('Начните вводить запрос…');
    return;
  }

  searchResults.innerHTML = '<p class="search-loading">Поиск…</p>';

  try {
    const pf = await ensurePagefind();
    const response = await pf.debouncedSearch(query.trim(), {}, 200);
    if (requestId !== searchRequestId) return;
    if (!response) return;

    const flat = [];
    const loaded = await Promise.all(response.results.slice(0, 12).map((r) => r.data()));

    if (requestId !== searchRequestId) return;

    for (const data of loaded) {
      const title = data.meta?.title || stripHtml(data.excerpt) || data.url;
      flat.push({
        title,
        excerpt: data.excerpt || data.plain_excerpt || '',
        url: resolveUrl(data.url),
      });

      if (data.sub_results?.length) {
        for (const sub of data.sub_results.slice(0, 2)) {
          flat.push({
            title: sub.title || title,
            excerpt: sub.excerpt || sub.plain_excerpt || '',
            url: resolveUrl(sub.url || data.url),
          });
        }
      }
    }

    searchActiveIndex = flat.length > 0 ? 0 : -1;
    renderSearchResults(flat.slice(0, 15));
  } catch {
    if (requestId !== searchRequestId) return;
    renderSearchEmpty('Поиск недоступен. Пересоберите документацию.');
  }
}

function openSearch() {
  if (!searchModal) return;
  searchModal.hidden = false;
  body.classList.add('search-open');
  searchInput?.focus();
  ensurePagefind();
  runSearch(searchInput?.value || '');
}

function closeSearch() {
  if (!searchModal) return;
  searchModal.hidden = true;
  body.classList.remove('search-open');
  searchActiveIndex = -1;
  if (searchInput) searchInput.value = '';
  renderSearchEmpty('Начните вводить запрос…');
}

function initSearch() {
  renderSearchEmpty('Начните вводить запрос…');

  searchTrigger?.addEventListener('click', openSearch);

  searchModal?.querySelectorAll('[data-search-close]').forEach((el) => {
    el.addEventListener('click', closeSearch);
  });

  searchInput?.addEventListener('input', (e) => {
    runSearch(e.target.value);
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (searchResultItems.length === 0) return;
      searchActiveIndex = Math.min(searchActiveIndex + 1, searchResultItems.length - 1);
      updateSearchActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (searchResultItems.length === 0) return;
      searchActiveIndex = Math.max(searchActiveIndex - 1, 0);
      updateSearchActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchActiveIndex >= 0 && searchResultItems[searchActiveIndex]) {
        window.location.href = searchResultItems[searchActiveIndex].url;
      }
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (searchModal?.hidden) openSearch();
      else closeSearch();
    }
    if (e.key === 'Escape' && !searchModal?.hidden) {
      closeSearch();
    }
  });
}

function initContentMotion() {
  const shell = document.querySelector('.site-shell');
  if (shell) {
    requestAnimationFrame(() => shell.classList.add('is-visible'));
  }
}

themeToggle?.addEventListener('click', () => {
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
});

initTheme();
initSearchKbd();
initSidebar();
initHeadingAnchors();
initToc();
initCopyButtons();
initSearch();
initContentMotion();
