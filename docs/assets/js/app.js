(function () {
  const storageKey = 'overvpn-docs-theme';
  const root = document.documentElement;
  const menuToggle = document.querySelector('.menu-toggle');
  const themeToggle = document.querySelector('.theme-toggle');

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

  themeToggle?.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });

  menuToggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('sidebar-open');
    menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  document.querySelectorAll('.sidebar a').forEach((link) => {
    link.addEventListener('click', () => {
      document.body.classList.remove('sidebar-open');
      menuToggle?.setAttribute('aria-expanded', 'false');
    });
  });

  initTheme();
})();
