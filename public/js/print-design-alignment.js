(function exposePrintDesignAlignment(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrintDesignAlignment = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  function snapMillimetres(value, enabled) {
    return enabled ? Math.round(value) : value;
  }

  function unique(values) {
    return [...new Set(values.map((value) => Math.round(value * 1000) / 1000))];
  }

  function alignmentTargets(design, activeName, widthMm, heightMm) {
    const x = [0, widthMm / 2, widthMm];
    const y = [0, heightMm / 2, heightMm];
    Object.entries(design.elements).forEach(([name, element]) => {
      if (name === activeName || !element.enabled) return;
      x.push(element.x, element.x + (element.width / 2), element.x + element.width);
      y.push(element.y, element.y + (element.height / 2), element.y + element.height);
    });
    return { x: unique(x), y: unique(y) };
  }

  function nearestAlignment(candidates, targets, toleranceMm) {
    let match = null;
    candidates.forEach((candidate) => targets.forEach((target) => {
      const delta = target - candidate.value;
      if (Math.abs(delta) <= toleranceMm && (!match || Math.abs(delta) < Math.abs(match.delta))) {
        match = { ...candidate, delta, target };
      }
    }));
    return match;
  }

  function alignMove(rectangle, targets, toleranceMm) {
    const xMatch = nearestAlignment([
      { value: rectangle.x },
      { value: rectangle.x + (rectangle.width / 2) },
      { value: rectangle.x + rectangle.width },
    ], targets.x, toleranceMm);
    const yMatch = nearestAlignment([
      { value: rectangle.y },
      { value: rectangle.y + (rectangle.height / 2) },
      { value: rectangle.y + rectangle.height },
    ], targets.y, toleranceMm);
    return {
      rectangle: {
        ...rectangle,
        x: rectangle.x + (xMatch?.delta || 0),
        y: rectangle.y + (yMatch?.delta || 0),
      },
      guides: { x: xMatch?.target ?? null, y: yMatch?.target ?? null },
    };
  }

  function resizeCandidates(rectangle, axis) {
    const start = axis === 'x' ? rectangle.x : rectangle.y;
    const size = axis === 'x' ? rectangle.width : rectangle.height;
    return [
      { value: start + size, sizeForTarget: (target) => target - start },
      { value: start + (size / 2), sizeForTarget: (target) => 2 * (target - start) },
    ];
  }

  function alignResize(rectangle, targets, toleranceMm, preserveSquare = false) {
    const xMatch = nearestAlignment(resizeCandidates(rectangle, 'x'), targets.x, toleranceMm);
    const yMatch = nearestAlignment(resizeCandidates(rectangle, 'y'), targets.y, toleranceMm);
    if (preserveSquare) {
      const matches = [
        xMatch && { ...xMatch, axis: 'x' },
        yMatch && { ...yMatch, axis: 'y' },
      ].filter(Boolean).sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta));
      if (!matches.length) return { rectangle, guides: { x: null, y: null } };
      const match = matches[0];
      const size = match.sizeForTarget(match.target);
      return {
        rectangle: { ...rectangle, width: size, height: size },
        guides: { x: match.axis === 'x' ? match.target : null, y: match.axis === 'y' ? match.target : null },
      };
    }
    return {
      rectangle: {
        ...rectangle,
        width: xMatch ? xMatch.sizeForTarget(xMatch.target) : rectangle.width,
        height: yMatch ? yMatch.sizeForTarget(yMatch.target) : rectangle.height,
      },
      guides: { x: xMatch?.target ?? null, y: yMatch?.target ?? null },
    };
  }

  function alignRectangle(rectangle, targets, toleranceMm, { resize = false, preserveSquare = false } = {}) {
    return resize
      ? alignResize(rectangle, targets, toleranceMm, preserveSquare)
      : alignMove(rectangle, targets, toleranceMm);
  }

  return Object.freeze({ alignRectangle, alignmentTargets, snapMillimetres });
}));
