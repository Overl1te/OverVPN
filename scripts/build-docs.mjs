import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const docsSrc = join(root, 'docs');
const outDir = join(root, 'docs-dist');
const base = process.argv.includes('--dev')
  ? '/'
  : (process.env.DOCS_BASE ?? '/OverVPN/');

const sidebar = [
  {
    title: 'Начало работы',
    items: [
      { id: 'guide-introduction', label: 'Введение', href: 'guide/introduction.html' },
      { id: 'guide-installation', label: 'Установка', href: 'guide/installation.html' },
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
    items: [
      { id: 'guide-docker', label: 'Ручной запуск (Docker)', href: 'guide/docker.html' },
    ],
  },
  {
    title: 'Справочник',
    items: [
      { id: 'reference-cli', label: 'CLI overvpn', href: 'reference/cli.html' },
      { id: 'reference-env', label: 'Переменные окружения', href: 'reference/env.html' },
      { id: 'reference-protocols', label: 'Протоколы', href: 'reference/protocols.html' },
    ],
  },
  {
    title: 'Прочее',
    items: [
      { id: 'faq', label: 'FAQ', href: 'faq.html' },
    ],
  },
];

const pages = [
  { id: 'index', title: 'Документация', out: 'index.html', content: 'pages/index.html', home: true },
  { id: 'guide-introduction', title: 'Введение', out: 'guide/introduction.html', content: 'pages/guide/introduction.html' },
  { id: 'guide-installation', title: 'Установка', out: 'guide/installation.html', content: 'pages/guide/installation.html' },
  { id: 'guide-management', title: 'Управление сервером', out: 'guide/management.html', content: 'pages/guide/management.html' },
  { id: 'guide-panel', title: 'Работа в панели', out: 'guide/panel.html', content: 'pages/guide/panel.html' },
  { id: 'guide-subscriptions', title: 'Подписки клиентов', out: 'guide/subscriptions.html', content: 'pages/guide/subscriptions.html' },
  { id: 'guide-docker', title: 'Ручной запуск (Docker)', out: 'guide/docker.html', content: 'pages/guide/docker.html' },
  { id: 'guide-security', title: 'Безопасность', out: 'guide/security.html', content: 'pages/guide/security.html' },
  { id: 'guide-limitations', title: 'Ограничения', out: 'guide/limitations.html', content: 'pages/guide/limitations.html' },
  { id: 'reference-cli', title: 'CLI overvpn', out: 'reference/cli.html', content: 'pages/reference/cli.html' },
  { id: 'reference-env', title: 'Переменные окружения', out: 'reference/env.html', content: 'pages/reference/env.html' },
  { id: 'reference-protocols', title: 'Протоколы', out: 'reference/protocols.html', content: 'pages/reference/protocols.html' },
  { id: 'faq', title: 'FAQ', out: 'faq.html', content: 'pages/faq.html' },
];

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

function applyBase(text) {
  return text.replaceAll('{{BASE}}', base);
}

function build() {
  const template = readFileSync(join(docsSrc, 'template.html'), 'utf8');

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  cpSync(join(docsSrc, 'assets'), join(outDir, 'assets'), { recursive: true });
  cpSync(join(docsSrc, 'static'), join(outDir, 'static'), { recursive: true });

  for (const page of pages) {
    const content = applyBase(readFileSync(join(docsSrc, page.content), 'utf8'));
    const html = applyBase(template)
      .replaceAll('{{TITLE}}', page.title)
      .replaceAll('{{PAGE_ID}}', page.id)
      .replaceAll('{{BODY_CLASS}}', page.home ? 'page-home' : 'page-doc')
      .replaceAll('{{CONTENT}}', content)
      .replaceAll('{{SIDEBAR}}', page.home ? '' : renderSidebar(page.id))
      .replaceAll('{{LAYOUT_CLASS}}', page.home ? 'layout-home' : 'layout-doc');

    const target = join(outDir, page.out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, html, 'utf8');
  }

  console.log(`Built ${pages.length} pages → ${outDir}`);
  console.log(`Base path: ${base}`);
}

build();
