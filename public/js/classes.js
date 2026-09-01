document.querySelectorAll('[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!window.confirm(form.dataset.confirm)) {
      event.preventDefault();
    }
  });
});

const appHeader = document.querySelector('.app-header');
const menuButton = document.querySelector('.menu-toggle');

if (appHeader && menuButton) {
  menuButton.addEventListener('click', () => {
    const menuIsOpen = appHeader.classList.toggle('menu-open');
    menuButton.setAttribute('aria-expanded', String(menuIsOpen));
  });
}

const path = window.location.pathname;
let currentSection = 'home';

if (path.startsWith('/students/import')) {
  currentSection = 'import';
} else if (path.startsWith('/students')) {
  currentSection = 'students';
} else if (path.startsWith('/classes')) {
  currentSection = 'classes';
} else if (path.startsWith('/sessions')) {
  currentSection = 'sessions';
}

document.querySelector(`[data-section="${currentSection}"]`)?.setAttribute('aria-current', 'page');

document.querySelectorAll('[data-filterable-list]').forEach((filterableList) => {
  const searchInput = filterableList.querySelector('[data-list-search]');
  const rows = [...filterableList.querySelectorAll('[data-list-row]')];
  const results = filterableList.querySelector('[data-list-results]');
  const noResults = filterableList.querySelector('[data-list-no-results]');

  if (!searchInput || rows.length === 0) return;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLocaleLowerCase('fr');
    let visibleCount = 0;

    rows.forEach((row) => {
      const matches = row.dataset.search.includes(query);
      row.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    if (results) results.hidden = visibleCount === 0;
    if (noResults) noResults.hidden = visibleCount > 0;
  });
});
