import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const docsSrc = join(root, 'docs');
const outDir = join(root, 'docs-dist');
const base = process.argv.includes('--dev') ? '/' : (process.env.DOCS_BASE ?? '/OverVPN/');

const sidebar = [
  {
    title: 'Начало работы',
    items: [
      { id: 'guide-introduction', label: 'Введение', href: 'guide/introduction.html' },
      { id: 'guide-installation', label: 'Установка', href: 'guide/installation.html' },
      { id: 'guide-proxy-nodes', label: 'Прокси-ноды', href: 'guide/proxy-nodes.html' },
      { id: 'guide-management', label: 'Управление сервером', href: 'guide/management.html' },
    ],
  },
  {
    title: 'Эксплуатация',
    items: [
      { id: 'guide-panel', label: 'Работа в панели', href: 'guide/panel.html' },
      { id: 'guide-subscriptions', label: 'Подписки клиентов', href: 'guide/subscriptions.html' },
      { id: 'guide-security', label: 'Безопасность', href: 'guide/security.html' },
      { id: 'guide-limitations', label: 'Ограничения', href: 'guide/limitations.html' },
    ],
  },
  {
    title: 'Продвинутое',
    items: [{ id: 'guide-docker', label: 'Ручной запуск (Docker)', href: 'guide/docker.html' }],
  },
  {
    title: 'Справочник',
    items: [
      { id: 'reference-cli', label: 'CLI overvpn', href: 'reference/cli.html' },
      { id: 'reference-env', label: 'Переменные окружения', href: 'reference/env.html' },
      { id: 'reference-protocols', label: 'Протоколы', href: 'reference/protocols.html' },
      { id: 'reference-errors', label: 'Коды ошибок', href: 'errors/index.html' },
    ],
  },
  {
    title: 'Прочее',
    items: [{ id: 'faq', label: 'FAQ', href: 'faq.html' }],
  },
];

const flatNav = sidebar.flatMap((section) => section.items);

const pages = [
  {
    id: 'index',
    title: 'Документация',
    out: 'index.html',
    content: 'pages/index.html',
    home: true,
  },
  {
    id: 'guide-introduction',
    title: 'Введение',
    out: 'guide/introduction.html',
    content: 'pages/guide/introduction.html',
  },
  {
    id: 'guide-installation',
    title: 'Установка',
    out: 'guide/installation.html',
    content: 'pages/guide/installation.html',
  },
  {
    id: 'guide-proxy-nodes',
    title: 'Прокси-ноды',
    out: 'guide/proxy-nodes.html',
    content: 'pages/guide/proxy-nodes.html',
  },
  {
    id: 'guide-management',
    title: 'Управление сервером',
    out: 'guide/management.html',
    content: 'pages/guide/management.html',
  },
  {
    id: 'guide-panel',
    title: 'Работа в панели',
    out: 'guide/panel.html',
    content: 'pages/guide/panel.html',
  },
  {
    id: 'guide-subscriptions',
    title: 'Подписки клиентов',
    out: 'guide/subscriptions.html',
    content: 'pages/guide/subscriptions.html',
  },
  {
    id: 'guide-docker',
    title: 'Ручной запуск (Docker)',
    out: 'guide/docker.html',
    content: 'pages/guide/docker.html',
  },
  {
    id: 'guide-security',
    title: 'Безопасность',
    out: 'guide/security.html',
    content: 'pages/guide/security.html',
  },
  {
    id: 'guide-limitations',
    title: 'Ограничения',
    out: 'guide/limitations.html',
    content: 'pages/guide/limitations.html',
  },
  {
    id: 'reference-cli',
    title: 'CLI overvpn',
    out: 'reference/cli.html',
    content: 'pages/reference/cli.html',
  },
  {
    id: 'reference-env',
    title: 'Переменные окружения',
    out: 'reference/env.html',
    content: 'pages/reference/env.html',
  },
  {
    id: 'reference-protocols',
    title: 'Протоколы',
    out: 'reference/protocols.html',
    content: 'pages/reference/protocols.html',
  },
  {
    id: 'reference-errors',
    title: 'Коды ошибок',
    out: 'errors/index.html',
    generated: 'errors-index',
  },
  { id: 'faq', title: 'FAQ', out: 'faq.html', content: 'pages/faq.html' },
];

function getNavSection(pageId) {
  if (pageId === 'faq') return 'faq';
  if (pageId.startsWith('reference-') || pageId.startsWith('error-')) return 'reference';
  if (pageId.startsWith('guide-')) return 'guide';
  return null;
}

function renderHeaderNav(activeSection) {
  const items = [
    { id: 'guide', label: 'Руководство', href: 'guide/introduction.html' },
    { id: 'reference', label: 'Справочник', href: 'reference/cli.html' },
    { id: 'faq', label: 'FAQ', href: 'faq.html' },
    {
      id: 'github',
      label: 'GitHub',
      href: 'https://github.com/Overl1te/OverVPN',
      external: true,
    },
  ];

  return items
    .map((item) => {
      const active = item.id === activeSection ? ' class="active"' : '';
      const attrs = item.external ? ' target="_blank" rel="noopener"' : '';
      const href = item.external ? item.href : `${base}${item.href}`;
      return `<a href="${href}"${active}${attrs}>${item.label}</a>`;
    })
    .join('\n          ');
}

function renderSidebar(activeId) {
  return sidebar
    .map((section) => {
      const items = section.items
        .map((item) => {
          const active = item.id === activeId ? ' class="active"' : '';
          return `<li><a href="${base}${item.href}"${active}>${item.label}</a></li>`;
        })
        .join('\n          ');
      return `<section class="sidebar-section">
        <h2>${section.title}</h2>
        <ul>
          ${items}
        </ul>
      </section>`;
    })
    .join('\n      ');
}

function renderPrevNext(activeId) {
  if (!activeId || activeId === 'index') return '';

  const idx = flatNav.findIndex((item) => item.id === activeId);
  if (idx === -1) return '';

  const prev = idx > 0 ? flatNav[idx - 1] : null;
  const next = idx < flatNav.length - 1 ? flatNav[idx + 1] : null;
  if (!prev && !next) return '';

  let html = '<nav class="doc-pager" aria-label="Навигация по страницам">';
  if (prev) {
    html += `<a class="pager-prev" href="${base}${prev.href}"><span>Назад</span><strong>${prev.label}</strong></a>`;
  }
  if (next) {
    html += `<a class="pager-next" href="${base}${next.href}"><span>Далее</span><strong>${next.label}</strong></a>`;
  }
  html += '</nav>';
  return html;
}

function applyBase(text) {
  return text.replaceAll('{{BASE}}', base);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function loadErrorCatalog() {
  return JSON.parse(readFileSync(join(root, 'packages/shared/src/error-catalog.json'), 'utf8'));
}

function catalogEntries(catalog) {
  return Object.entries(catalog)
    .map(([code, entry]) => ({ code, ...entry }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function renderErrorsIndex(entries) {
  const rows = entries
    .map(
      (entry) => `<tr>
      <td><a href="${base}errors/${entry.id.toLowerCase()}.html"><code>${escapeHtml(entry.id)}</code></a></td>
      <td><code>${escapeHtml(entry.code)}</code></td>
      <td>${escapeHtml(entry.title.ru)}</td>
    </tr>`,
    )
    .join('\n    ');

  return `<h1>Коды ошибок</h1>
<p>
  Если панель показала тост с кодом вроде <code>OVN-4092</code> — откройте эту страницу
  или нажмите «Как исправить» в тосте. Каждая ошибка имеет стабильный ID, причину и шаги решения.
</p>
<div class="callout tip">
  <strong>Как пользоваться</strong>
  Скопируйте ID из панели, найдите его в таблице или через поиск по документации (Ctrl+K).
</div>
<table>
  <thead>
    <tr>
      <th>ID</th>
      <th>Код API</th>
      <th>Сообщение</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>`;
}

function renderErrorPage(entry) {
  return `<p class="error-kicker"><a href="${base}errors/index.html">Коды ошибок</a></p>
<h1><code class="error-id">${escapeHtml(entry.id)}</code></h1>
<p class="error-title">${escapeHtml(entry.title.ru)}</p>
<p class="error-meta"><span>Код API: <code>${escapeHtml(entry.code)}</code></span></p>
<h2>Что случилось</h2>
<p>${escapeHtml(entry.cause.ru)}</p>
<h2>Как исправить</h2>
<p>${escapeHtml(entry.fix.ru)}</p>
<h2>English</h2>
<p><strong>${escapeHtml(entry.title.en)}</strong></p>
<p>${escapeHtml(entry.cause.en)}</p>
<p>${escapeHtml(entry.fix.en)}</p>`;
}

function writePage(template, page, content) {
  const sidebarId = page.id.startsWith('error-') ? 'reference-errors' : page.id;
  const navSection = getNavSection(page.id);
  const html = applyBase(template)
    .replaceAll('{{TITLE}}', page.title)
    .replaceAll('{{PAGE_ID}}', page.id)
    .replaceAll('{{BODY_CLASS}}', page.home ? 'page-home' : 'page-doc')
    .replaceAll('{{CONTENT}}', content)
    .replaceAll('{{SIDEBAR}}', page.home ? '' : renderSidebar(sidebarId))
    .replaceAll('{{LAYOUT_CLASS}}', page.home ? 'layout-home' : 'layout-doc')
    .replaceAll('{{HEADER_NAV}}', renderHeaderNav(navSection))
    .replaceAll('{{PREV_NEXT}}', page.home ? '' : renderPrevNext(page.id));

  const target = join(outDir, page.out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html, 'utf8');
}

function build() {
  const template = readFileSync(join(docsSrc, 'template.html'), 'utf8');
  const catalog = loadErrorCatalog();
  const entries = catalogEntries(catalog);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  cpSync(join(docsSrc, 'assets'), join(outDir, 'assets'), { recursive: true });
  cpSync(join(docsSrc, 'static'), join(outDir, 'static'), { recursive: true });

  let count = 0;
  for (const page of pages) {
    const content =
      page.generated === 'errors-index'
        ? renderErrorsIndex(entries)
        : applyBase(readFileSync(join(docsSrc, page.content), 'utf8'));
    writePage(template, page, content);
    count += 1;
  }

  for (const entry of entries) {
    writePage(
      template,
      {
        id: `error-${entry.id.toLowerCase()}`,
        title: `${entry.id} — ${entry.title.ru}`,
        out: `errors/${entry.id.toLowerCase()}.html`,
        home: false,
      },
      renderErrorPage(entry),
    );
    count += 1;
  }

  console.log(`Built ${count} pages → ${outDir}`);
  console.log(`Base path: ${base}`);
}

build();
