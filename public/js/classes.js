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
