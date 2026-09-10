(() => {
  const editor = document.querySelector('[data-print-design-editor]');
  const profileSelect = document.querySelector('[data-print-design-profile]');
  if (profileSelect) profileSelect.addEventListener('change', () => profileSelect.form.submit());
  if (!editor) return;

  const stage = editor.querySelector('[data-design-stage]');
  const widthMm = Number(editor.dataset.profileWidth);
  const heightMm = Number(editor.dataset.profileHeight);
  const errorBox = editor.querySelector('[data-design-error]');
  const gridToggle = editor.querySelector('[data-grid-toggle]');
  const snapToggle = editor.querySelector('[data-grid-snap]');
  const alignment = globalThis.PrintDesignAlignment;
  const xGuide = editor.querySelector('[data-design-guide="x"]');
  const yGuide = editor.querySelector('[data-design-guide="y"]');
  const design = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(editor.dataset.design), (character) => character.charCodeAt(0))));
  let selectedName = null;
  let gesture = null;

  const limits = (name) => ({
    minWidth: name === 'qr' ? 24 : name === 'logo' ? 10 : name === 'code' ? 3 : 2,
    minHeight: name === 'qr' ? 24 : name === 'logo' ? 5 : name === 'code' ? 10 : 2,
  });
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const round = (value) => Math.round(value * 1000) / 1000;

  function elementNode(name) { return editor.querySelector(`[data-design-element="${name}"]`); }
  function controlsNode(name) { return editor.querySelector(`[data-controls-for="${name}"]`); }
  function refreshElement(name) {
    const element = design.elements[name];
    const node = elementNode(name);
    node.style.setProperty('--x', element.x);
    node.style.setProperty('--y', element.y);
    node.style.setProperty('--w', element.width);
    node.style.setProperty('--h', element.height);
    node.style.setProperty('--font', element.fontSize || 10);
    node.style.fontSize = `${(element.fontSize || 10) * (25.4 / 72) * (stage.clientWidth / widthMm)}px`;
    node.style.setProperty('--rotation', `${element.rotation || 0}deg`);
    node.style.textAlign = element.align || 'center';
    node.dataset.disabled = element.enabled ? 'false' : 'true';
    const controls = controlsNode(name);
    controls.querySelectorAll('[data-control]').forEach((control) => {
      const property = control.dataset.control;
      if (property === 'enabled') control.checked = element.enabled;
      else control.value = element[property];
    });
  }
  function setSelected(name) {
    selectedName = name;
    editor.querySelectorAll('[data-design-element]').forEach((node) => node.classList.toggle('is-selected', node.dataset.designElement === name));
    editor.querySelectorAll('[data-controls-for]').forEach((node) => { node.hidden = node.dataset.controlsFor !== name; });
    editor.querySelector('[data-no-design-selection]').hidden = Boolean(name);
  }
  function normalize(name, next) {
    if (!['x', 'y', 'width', 'height'].every((property) => Number.isFinite(Number(next[property])))) return false;
    const minimum = limits(name);
    next.width = clamp(Number(next.width), minimum.minWidth, widthMm);
    next.height = clamp(Number(next.height), minimum.minHeight, heightMm);
    if (name === 'qr') {
      const size = clamp(Math.max(next.width, next.height), 24, Math.min(widthMm, heightMm));
      next.width = size; next.height = size;
    }
    if (Object.hasOwn(next, 'fontSize')) {
      const minimumFont = name === 'disclaimer' ? 5 : 6;
      const maximumFont = ['title', 'name'].includes(name) ? 24 : 14;
      next.fontSize = round(clamp(Number(next.fontSize), minimumFont, maximumFont));
    }
    next.x = clamp(Number(next.x), 0, widthMm - next.width);
    next.y = clamp(Number(next.y), 0, heightMm - next.height);
    ['x', 'y', 'width', 'height'].forEach((property) => { next[property] = round(next[property]); });
    return true;
  }
  function overlaps(left, right) {
    return left.x < right.x + right.width && left.x + left.width > right.x
      && left.y < right.y + right.height && left.y + left.height > right.y;
  }
  function hasQrCollision(name, candidate) {
    const qr = name === 'qr' ? candidate : design.elements.qr;
    return Object.entries(design.elements).some(([otherName, element]) => {
      if (otherName === name || otherName === 'qr') return false;
      const other = otherName === name ? candidate : element;
      return other.enabled && overlaps(qr, other);
    }) || (name !== 'qr' && candidate.enabled && overlaps(qr, candidate));
  }
  function clearGuides() {
    xGuide.hidden = true;
    yGuide.hidden = true;
  }
  function showGuides(guides) {
    if (guides.x === null) xGuide.hidden = true;
    else {
      xGuide.style.left = `${(guides.x / widthMm) * 100}%`;
      xGuide.hidden = false;
    }
    if (guides.y === null) yGuide.hidden = true;
    else {
      yGuide.style.top = `${(guides.y / heightMm) * 100}%`;
      yGuide.hidden = false;
    }
  }
  function applyGridSnap(rectangle, resize) {
    if (!snapToggle.checked) return rectangle;
    const snapped = { ...rectangle };
    if (resize) {
      snapped.width = alignment.snapMillimetres(snapped.width, true);
      snapped.height = alignment.snapMillimetres(snapped.height, true);
    } else {
      snapped.x = alignment.snapMillimetres(snapped.x, true);
      snapped.y = alignment.snapMillimetres(snapped.y, true);
    }
    return snapped;
  }
  function alignedGesture(name, candidate, resize, bounds) {
    if (!normalize(name, candidate)) return null;
    const unaligned = { ...candidate };
    const pixelsPerMm = Math.min(bounds.width / widthMm, bounds.height / heightMm);
    const result = alignment.alignRectangle(
      candidate,
      alignment.alignmentTargets(design, name, widthMm, heightMm),
      6 / pixelsPerMm,
      { resize, preserveSquare: name === 'qr' },
    );
    const finalRectangle = applyGridSnap(result.rectangle, resize);
    if (!normalize(name, finalRectangle) || hasQrCollision(name, finalRectangle)) {
      clearGuides();
      const fallback = applyGridSnap(unaligned, resize);
      if (!normalize(name, fallback) || hasQrCollision(name, fallback)) return null;
      return fallback;
    }
    const xAnchors = [finalRectangle.x, finalRectangle.x + (finalRectangle.width / 2), finalRectangle.x + finalRectangle.width];
    const yAnchors = [finalRectangle.y, finalRectangle.y + (finalRectangle.height / 2), finalRectangle.y + finalRectangle.height];
    showGuides({
      x: result.guides.x !== null && xAnchors.some((value) => Math.abs(value - result.guides.x) < 0.002)
        ? result.guides.x : null,
      y: result.guides.y !== null && yAnchors.some((value) => Math.abs(value - result.guides.y) < 0.002)
        ? result.guides.y : null,
    });
    return finalRectangle;
  }
  function refreshStageScale() {
    const pixelsPerMillimetreX = stage.clientWidth / widthMm;
    const pixelsPerMillimetreY = stage.clientHeight / heightMm;
    stage.style.setProperty('--grid-x', `${pixelsPerMillimetreX}px`);
    stage.style.setProperty('--grid-y', `${pixelsPerMillimetreY}px`);
    stage.style.setProperty('--grid-major-x', `${pixelsPerMillimetreX * 5}px`);
    stage.style.setProperty('--grid-major-y', `${pixelsPerMillimetreY * 5}px`);
    Object.keys(design.elements).forEach(refreshElement);
  }

  editor.querySelectorAll('[data-design-element]').forEach((node) => {
    node.addEventListener('click', () => setSelected(node.dataset.designElement));
    node.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const name = node.dataset.designElement;
      setSelected(name);
      gesture = {
        name, resize: event.target.classList.contains('print-design-resize'), startX: event.clientX,
        startY: event.clientY, initial: { ...design.elements[name] }, pointerId: event.pointerId,
      };
      node.setPointerCapture(event.pointerId);
      stage.classList.add('is-dragging');
      event.preventDefault();
    });
    node.addEventListener('pointermove', (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const bounds = stage.getBoundingClientRect();
      const dx = ((event.clientX - gesture.startX) / bounds.width) * widthMm;
      const dy = ((event.clientY - gesture.startY) / bounds.height) * heightMm;
      const next = { ...gesture.initial };
      if (gesture.resize) { next.width += dx; next.height += dy; } else { next.x += dx; next.y += dy; }
      const aligned = alignedGesture(gesture.name, next, gesture.resize, bounds);
      if (!aligned) return;
      design.elements[gesture.name] = aligned;
      refreshElement(gesture.name);
    });
    const endGesture = (event) => {
      if (gesture?.pointerId !== event.pointerId) return;
      gesture = null;
      stage.classList.remove('is-dragging');
      clearGuides();
    };
    node.addEventListener('pointerup', endGesture);
    node.addEventListener('pointercancel', endGesture);
  });
  gridToggle.addEventListener('change', () => stage.classList.toggle('show-grid', gridToggle.checked));

  editor.querySelectorAll('[data-controls-for]').forEach((controls) => {
    controls.addEventListener('input', (event) => {
      if (!selectedName || !event.target.matches('[data-control]')) return;
      const property = event.target.dataset.control;
      const next = { ...design.elements[selectedName] };
      next[property] = property === 'enabled' ? event.target.checked
        : ['align'].includes(property) ? event.target.value : Number(event.target.value);
      if (!normalize(selectedName, next)) return;
      design.elements[selectedName] = next;
      refreshElement(selectedName);
    });
  });
  editor.querySelector('[data-example-preview]').addEventListener('click', () => { setSelected('title'); stage.focus({ preventScroll: false }); });
  editor.querySelector('[data-print-design-form]').addEventListener('submit', (event) => {
    try {
      const qr = design.elements.qr;
      const collision = Object.entries(design.elements).some(([name, element]) => name !== 'qr' && element.enabled && overlaps(qr, element));
      if (collision) throw new Error('Aucun élément ne peut recouvrir le QR.');
      editor.querySelector('[data-design-json]').value = JSON.stringify(design);
      errorBox.hidden = true;
    } catch (error) {
      event.preventDefault(); errorBox.textContent = error.message || 'Le modèle ne peut pas être préparé.'; errorBox.hidden = false;
    }
  });
  refreshStageScale();
  new ResizeObserver(refreshStageScale).observe(stage);
})();
