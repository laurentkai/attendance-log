(() => {
  const portaledMenus = new Map();

  function getToggle(event) {
    return event.target instanceof Element
      ? event.target.closest('[data-user-actions-toggle]')
      : null;
  }

  function portalMenu(toggle) {
    if (!toggle || portaledMenus.has(toggle)) return;
    const menu = toggle.parentElement?.querySelector(':scope > .user-actions-menu');
    if (!menu) return;

    portaledMenus.set(toggle, {
      menu,
      parent: menu.parentNode,
      nextSibling: menu.nextSibling,
    });
    document.body.append(menu);
  }

  function restoreMenu(toggle) {
    const portal = portaledMenus.get(toggle);
    if (!portal) return;
    const { menu, parent, nextSibling } = portal;
    if (nextSibling?.parentNode === parent) {
      parent.insertBefore(menu, nextSibling);
    } else {
      parent.append(menu);
    }
    portaledMenus.delete(toggle);
  }

  document.addEventListener('show.bs.dropdown', (event) => {
    portalMenu(getToggle(event));
  });

  document.addEventListener('hidden.bs.dropdown', (event) => {
    restoreMenu(getToggle(event));
  });

  window.addEventListener('pagehide', () => {
    [...portaledMenus.keys()].forEach(restoreMenu);
  });
})();
