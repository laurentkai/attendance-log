window.AttendanceLogI18n.ready.then(() => {
document.querySelectorAll('[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!window.confirm(form.dataset.confirm)) {
      event.preventDefault();
    }
  });
});

document.querySelectorAll('form[data-submit-once]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (event.defaultPrevented) return;
    const submitButton = form.querySelector('button[type="submit"]');
    if (!submitButton) return;
    submitButton.disabled = true;
    submitButton.textContent = window.AttendanceLogI18n.t('action.sending');
  });
});

document.querySelectorAll('[data-filterable-list]').forEach((filterableList) => {
  const searchInput = filterableList.querySelector('[data-list-search]');
  const rows = [...filterableList.querySelectorAll('[data-list-row]')];
  const results = filterableList.querySelector('[data-list-results]');
  const noResults = filterableList.querySelector('[data-list-no-results]');
  const sortInput = filterableList.querySelector('[data-list-sort]');
  const count = filterableList.querySelector('[data-list-count]');
  const translate = window.AttendanceLogI18n.t;
  let page = 0;
  const pageSize = 50;
  const locale = document.documentElement.lang || 'en';
  const searchText = new Map(rows.map((row) => [row, row.dataset.search.toLocaleLowerCase(locale)]));
  const names = new Map(rows.map((row) => [row, row.querySelector('.compact-title')?.textContent || row.dataset.search]));
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  let alphabetical;
  let previousVisible = [];

  if (!searchInput || rows.length === 0) return;

  if (noResults) {
    const help = document.createElement('span');
    help.className = 'd-block small mt-1';
    help.textContent = translate('workspace.filter_help');
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn-outline-secondary mt-2';
    clear.textContent = translate('action.clear');
    clear.addEventListener('click', () => { searchInput.value = ''; page = 0; update(); searchInput.focus(); });
    noResults.append(help, clear);
  }

  const pagination = document.createElement('div');
  pagination.className = 'collection-pagination';
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'btn btn-light';
  previous.textContent = translate('workspace.previous');
  const pageLabel = document.createElement('span');
  pageLabel.className = 'collection-count';
  pageLabel.setAttribute('role', 'status');
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn btn-light';
  next.textContent = translate('workspace.next');
  pagination.append(previous, pageLabel, next);
  filterableList.append(pagination);

  function update() {
    const query = searchInput.value.trim().toLocaleLowerCase(document.documentElement.lang || 'en');
    const order = sortInput?.value || 'original';
    if (order === 'name' && !alphabetical) alphabetical = [...rows].sort((a, b) => collator.compare(names.get(a), names.get(b)));
    const ordered = order === 'name' ? alphabetical : rows;
    const matches = ordered.filter((row) => searchText.get(row).includes(query));
    page = Math.min(page, Math.max(0, Math.ceil(matches.length / pageSize) - 1));
    const visibleRows = matches.slice(page * pageSize, (page + 1) * pageSize);
    const visible = new Set(visibleRows);
    ordered.forEach((row) => { const hidden = !visible.has(row); if (row.hidden !== hidden) row.hidden = hidden; });
    // Hidden rows need no ordering. Move at most one visible page, and only
    // when its membership or order changes; filtering never rebuilds the list.
    if (results && (visibleRows.length !== previousVisible.length || visibleRows.some((row, index) => row !== previousVisible[index]))) {
      results.append(...visibleRows);
      previousVisible = visibleRows;
    }
    if (results) results.hidden = matches.length === 0;
    if (noResults) noResults.hidden = matches.length > 0;
    if (count) count.textContent = translate('workspace.result_count', { count: matches.length });
    pagination.hidden = matches.length <= pageSize;
    previous.disabled = page === 0;
    next.disabled = (page + 1) * pageSize >= matches.length;
    pageLabel.textContent = translate('workspace.page_count', { from: page * pageSize + 1, to: Math.min((page + 1) * pageSize, matches.length), count: matches.length });
  }
  searchInput.addEventListener('input', () => { page = 0; update(); });
  sortInput?.addEventListener('change', () => { page = 0; update(); });
  previous.addEventListener('click', () => { page -= 1; update(); searchInput.focus(); });
  next.addEventListener('click', () => { page += 1; update(); searchInput.focus(); });
  update();
});

document.querySelector('[data-settings-search]')?.addEventListener('input', (event) => {
  const query = event.target.value.trim().toLocaleLowerCase(document.documentElement.lang);
  const overview = document.querySelector('.settings-overview-link');
  if (overview) overview.hidden = Boolean(query);
  let count = 0;
  document.querySelectorAll('[data-settings-group]').forEach((group) => {
    let visible = 0;
    group.querySelectorAll('a').forEach((link) => {
      link.hidden = !link.textContent.toLocaleLowerCase(document.documentElement.lang).includes(query);
      if (!link.hidden) { visible += 1; count += 1; }
    });
    group.hidden = visible === 0;
  });
  const empty = document.querySelector('[data-settings-empty]');
  if (empty) empty.hidden = count > 0;
});

// Native POST forms keep explicit saves. Do not interfere with intercepted
// attendance/provider flows, named submit buttons, or browser validation.
document.addEventListener('submit', (event) => {
  const form = event.target;
  const button = event.submitter;
  if (event.defaultPrevented || !form.matches('form.app-form[method="post"]') || form.hasAttribute('data-submit-once') || !button || button.name) return;
  button.dataset.saveLabel = button.textContent;
  button.textContent = window.AttendanceLogI18n.t('workspace.saving');
  form.setAttribute('aria-busy', 'true');
});
window.addEventListener('pageshow', () => {
  document.querySelectorAll('[data-save-label]').forEach((button) => {
    button.textContent = button.dataset.saveLabel;
    delete button.dataset.saveLabel;
    button.form?.removeAttribute('aria-busy');
  });
});
}).catch(() => {});
