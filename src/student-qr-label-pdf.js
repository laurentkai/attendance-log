const PDFDocument = require('pdfkit');
const { createStudentQrPng } = require('./student-qr');
const { PERSONAL_QR_WARNING } = require('./student-qr-content');
const { getLabelBoxMm, getLabelsPerSheet } = require('./avery-profiles');
const {
  MINIMUM_QR_MM,
  MINIMUM_TEXT_ELEMENT_HEIGHT_MM,
  profileSupportsDisclaimer,
  validatePrintDesign,
} = require('./print-design');

const POINTS_PER_MM = 72 / 25.4;

function mmToPoints(value) {
  return value * POINTS_PER_MM;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function createPdfDocument(profile, title) {
  return new PDFDocument({
    autoFirstPage: false,
    bufferPages: false,
    compress: true,
    margin: 0,
    size: [mmToPoints(profile.pageWidthMm), mmToPoints(profile.pageHeightMm)],
    info: { Title: title, Author: 'Attendance Log', Creator: 'Attendance Log' },
  });
}

function collectPdf(document) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });
}

function fitParticipantName(document, name, width, height, maximum, minimumSingleLine = 7.5) {
  for (let size = maximum; size >= minimumSingleLine; size -= 0.5) {
    document.fontSize(size);
    if (document.widthOfString(name) <= width) {
      return { fontSize: size, height: document.currentLineHeight(true), singleLine: true };
    }
  }

  const minimumWrappedSize = 6.5;
  for (let size = maximum; size >= minimumWrappedSize; size -= 0.5) {
    document.fontSize(size);
    const lineHeight = document.currentLineHeight(true);
    const measuredHeight = document.heightOfString(name, { width, lineGap: 0.5 });
    if (measuredHeight <= height && measuredHeight <= (lineHeight * 2) + 0.5) {
      return { fontSize: size, height: measuredHeight, singleLine: false };
    }
  }

  document.fontSize(minimumWrappedSize);
  return {
    fontSize: minimumWrappedSize,
    height: Math.min(height, (document.currentLineHeight(true) * 2) + 0.5),
    singleLine: false,
  };
}

function truncateSingleLine(document, text, width) {
  if (document.widthOfString(text) <= width) return text;
  const characters = Array.from(text);
  while (characters.length > 1 && document.widthOfString(`${characters.join('')}…`) > width) {
    characters.pop();
  }
  return `${characters.join('').trimEnd()}…`;
}

function fitBadgeTitle(document, title, width, height, maximumFontSize) {
  document.font('Helvetica-Bold');
  for (let fontSize = maximumFontSize; fontSize >= 10; fontSize -= 0.5) {
    document.fontSize(fontSize);
    const lineHeight = document.currentLineHeight(true);
    if (lineHeight <= height && document.widthOfString(title) <= width) {
      return { fontSize, height: lineHeight, singleLine: true };
    }
  }

  for (let fontSize = maximumFontSize; fontSize >= 8; fontSize -= 0.5) {
    document.fontSize(fontSize);
    const lineHeight = document.currentLineHeight(true);
    const measuredHeight = document.heightOfString(title, { lineGap: 0.5, width });
    if (measuredHeight <= height && measuredHeight <= (lineHeight * 2) + 0.5) {
      return { fontSize, height: measuredHeight, singleLine: false };
    }
  }

  document.fontSize(8);
  const lineHeight = document.currentLineHeight(true);
  return {
    fontSize: 8,
    height: Math.min(height, (lineHeight * 2) + 0.5),
    singleLine: height < (lineHeight * 2) + 0.5,
  };
}

function toPointBox(boxMm) {
  return {
    ...boxMm,
    x: mmToPoints(boxMm.x),
    y: mmToPoints(boxMm.y),
    width: mmToPoints(boxMm.width),
    height: mmToPoints(boxMm.height),
  };
}

function getLayoutFamily(boxMm) {
  return boxMm.height >= 52 ? 'balanced' : 'wide';
}

function canIncludeQrWarning(profile) {
  return profileSupportsDisclaimer(profile);
}

function getContentMetrics(boxMm, {
  includeWarning = false,
  hasActivity = false,
  hasTitle = false,
} = {}) {
  const box = toPointBox(boxMm);
  const family = getLayoutFamily(boxMm);
  const horizontalPaddingMm = clamp(boxMm.width * 0.022, 1.2, 2.2);
  const verticalPaddingMm = clamp(boxMm.height * 0.04, 1.4, 2.4);
  const codeStripWidthMm = clamp(boxMm.width * 0.058, 4.8, 5.8);
  const codeQrGapMm = clamp(boxMm.width * 0.004, 0.3, 0.45);
  const qrTextGapMm = clamp(boxMm.width * 0.009, 0.7, 0.9);

  if (family === 'wide') {
    const minimumTextWidthMm = clamp(boxMm.width * 0.29, 16, 31);
    const maximumQrMm = clamp(boxMm.width * 0.27, MINIMUM_QR_MM, 27);
    const qrSizeMm = Math.min(
      boxMm.height - (2 * verticalPaddingMm),
      maximumQrMm,
      boxMm.width - (2 * horizontalPaddingMm) - codeStripWidthMm
        - codeQrGapMm - qrTextGapMm - minimumTextWidthMm,
    );
    return {
      box,
      family,
      horizontalPadding: mmToPoints(horizontalPaddingMm),
      verticalPadding: mmToPoints(verticalPaddingMm),
      codeStripWidth: mmToPoints(codeStripWidthMm),
      codeQrGap: mmToPoints(codeQrGapMm),
      qrTextGap: mmToPoints(qrTextGapMm),
      qrSize: mmToPoints(qrSizeMm),
      qrX: mmToPoints(boxMm.x + horizontalPaddingMm + codeStripWidthMm + codeQrGapMm),
      qrY: mmToPoints(boxMm.y + ((boxMm.height - qrSizeMm) / 2)),
    };
  }

  const warningHeightMm = includeWarning ? (boxMm.width < 80 ? 11 : 9.5) : 0;
  const activityHeightMm = hasActivity ? 4 : 0;
  const nameHeightMm = 7;
  const verticalGapsMm = 1.1 + (hasActivity ? 0.7 : 0) + (includeWarning ? 0.9 : 0);
  const reservedBottomMm = warningHeightMm + activityHeightMm + nameHeightMm + verticalGapsMm;
  const qrSizeMm = clamp(
    Math.min(
      boxMm.width - (2 * horizontalPaddingMm) - codeStripWidthMm - codeQrGapMm,
      boxMm.height - (2 * verticalPaddingMm) - reservedBottomMm,
      27,
    ),
    MINIMUM_QR_MM,
    27,
  );
  const contentLeftMm = boxMm.x + horizontalPaddingMm + codeStripWidthMm + codeQrGapMm;
  const contentRightMm = boxMm.x + boxMm.width - horizontalPaddingMm;
  const contentWidthMm = contentRightMm - contentLeftMm;
  const headerGapMm = 1.2;
  const identityActivityGapMm = hasActivity ? 0.6 : 0;
  const contentBlockHeightMm = qrSizeMm + headerGapMm + nameHeightMm
    + identityActivityGapMm + activityHeightMm;
  const contentBlockOffsetMm = includeWarning
    ? 0
    : Math.max(
      0,
      (boxMm.height - (2 * verticalPaddingMm) - contentBlockHeightMm) / 2,
    );
  const qrXmm = contentLeftMm;
  const qrYmm = boxMm.y + verticalPaddingMm + contentBlockOffsetMm;
  return {
    box,
    family,
    horizontalPadding: mmToPoints(horizontalPaddingMm),
    verticalPadding: mmToPoints(verticalPaddingMm),
    codeStripWidth: mmToPoints(codeStripWidthMm),
    codeQrGap: mmToPoints(codeQrGapMm),
    qrTextGap: mmToPoints(qrTextGapMm),
    contentX: mmToPoints(contentLeftMm),
    contentWidth: mmToPoints(contentWidthMm),
    qrSize: mmToPoints(qrSizeMm),
    qrX: mmToPoints(qrXmm),
    qrY: mmToPoints(qrYmm),
    headerX: mmToPoints(contentLeftMm),
    headerY: mmToPoints(boxMm.y + verticalPaddingMm + contentBlockOffsetMm),
    headerWidth: mmToPoints(contentWidthMm),
    headerHeight: mmToPoints(qrSizeMm),
    headerGap: mmToPoints(headerGapMm),
    headerColumnGap: mmToPoints(0.9),
    identityActivityGap: mmToPoints(identityActivityGapMm),
    footerGap: mmToPoints(0.9),
    nameHeight: mmToPoints(nameHeightMm),
    activityHeight: mmToPoints(activityHeightMm),
    warningHeight: mmToPoints(warningHeightMm),
    contentGap: mmToPoints(0.8),
  };
}

function renderContainedLogo(document, logo, x, y, width, height) {
  if (!logo?.data || width < mmToPoints(10) || height < mmToPoints(5)) return false;
  try {
    document.image(logo.data, x, y, { fit: [width, height], align: 'center', valign: 'center' });
    return true;
  } catch (_error) {
    return false;
  }
}

function relativeMillimetres(value, origin = 0) {
  return (value - origin) / POINTS_PER_MM;
}

function elementBox(x, y, width, height, extra = {}) {
  return {
    x: relativeMillimetres(x),
    y: relativeMillimetres(y),
    width: relativeMillimetres(width),
    height: relativeMillimetres(height),
    enabled: true,
    ...extra,
  };
}

function createDefaultPrintDesign(profile, {
  participant = { first_name: 'Paul', last_name: 'BALDEWYNS' },
  activityName = 'Cours de navigation 2026-2027',
  includeWarning = canIncludeQrWarning(profile),
  title = 'Carte étudiant 2027',
} = {}) {
  const document = new PDFDocument({ autoFirstPage: false });
  const boxMm = { x: 0, y: 0, width: profile.labelWidthMm, height: profile.labelHeightMm };
  const metrics = getContentMetrics(boxMm, {
    includeWarning,
    hasActivity: Boolean(activityName),
    hasTitle: Boolean(title),
  });
  const { box } = metrics;
  const codeFontSize = clamp(metrics.codeStripWidth * 0.63, 7, 10);
  const code = elementBox(
    box.x + metrics.horizontalPadding,
    box.y + metrics.verticalPadding,
    metrics.codeStripWidth,
    box.height - (2 * metrics.verticalPadding),
    { fontSize: codeFontSize, rotation: -90 },
  );
  const qr = elementBox(metrics.qrX, metrics.qrY, metrics.qrSize, metrics.qrSize);
  const empty = elementBox(metrics.contentX || metrics.qrX, metrics.qrY, mmToPoints(10), mmToPoints(5));
  let titleElement = { ...empty, fontSize: 12, align: 'left' };
  let nameElement = { ...empty, fontSize: 12, align: 'center' };
  let activityElement = { ...empty, fontSize: 7, align: 'center' };
  let logoElement = { ...empty, enabled: false };
  let disclaimerElement = { ...empty, enabled: false, fontSize: 6, align: 'center' };

  if (metrics.family === 'wide') {
    const textX = metrics.qrX + metrics.qrSize + metrics.qrTextGap;
    const textWidth = Math.max(1, box.x + box.width - metrics.horizontalPadding - textX);
    const textTop = box.y + metrics.verticalPadding;
    const availableHeight = box.height - (2 * metrics.verticalPadding);
    const maximumPrimaryFontSize = clamp(box.height * 0.16, 10, 14);
    const maximumTitleHeight = title ? Math.min(mmToPoints(9.5), availableHeight * 0.42) : 0;
    const titleLayout = title
      ? fitBadgeTitle(document, title, textWidth, maximumTitleHeight, maximumPrimaryFontSize)
      : null;
    const titleGap = titleLayout ? mmToPoints(0.8) : 0;
    const activityHeight = activityName ? 9 : 0;
    const blockGap = activityName ? mmToPoints(1.1) : 0;
    const disabledActivityHeight = mmToPoints(MINIMUM_TEXT_ELEMENT_HEIGHT_MM);
    const nameHeight = availableHeight - (titleLayout?.height || 0) - titleGap
      - activityHeight - blockGap;
    document.font('Helvetica-Bold');
    const nameLayout = fitParticipantName(
      document,
      `${participant.first_name} ${participant.last_name}`.trim(),
      textWidth,
      nameHeight,
      maximumPrimaryFontSize,
    );
    const contentY = textTop;
    titleElement = elementBox(textX, contentY, textWidth, Math.max(titleLayout?.height || mmToPoints(4), 1), {
      enabled: Boolean(title), fontSize: titleLayout?.fontSize || maximumPrimaryFontSize, align: 'left',
    });
    const nameY = contentY + (titleLayout?.height || 0) + titleGap;
    nameElement = elementBox(textX, nameY, textWidth, Math.max(nameHeight, mmToPoints(2)), {
      fontSize: nameLayout.fontSize, align: 'left',
    });
    const activityBoxHeight = activityName ? activityHeight : disabledActivityHeight;
    const activityY = activityName
      ? nameY + nameHeight + blockGap
      : box.y + box.height - metrics.verticalPadding - activityBoxHeight;
    activityElement = elementBox(textX, activityY, textWidth, activityBoxHeight, {
      enabled: Boolean(activityName), fontSize: clamp(box.height * 0.065, 6, 8), align: 'left',
    });
    logoElement = elementBox(textX, textTop, Math.min(textWidth, mmToPoints(20)), mmToPoints(8), { enabled: false });
  } else {
    const contentRight = metrics.contentX + metrics.contentWidth;
    const headerColumn = {
      x: metrics.qrX + metrics.qrSize + metrics.headerColumnGap,
      y: metrics.qrY,
      right: contentRight,
      bottom: metrics.qrY + metrics.qrSize,
    };
    headerColumn.width = headerColumn.right - headerColumn.x;
    const maximumPrimaryFontSize = clamp(box.width * 0.055, 11, 15);
    const maximumTitleHeight = Math.min(metrics.headerHeight * 0.42, mmToPoints(10));
    const titleLayout = title
      ? fitBadgeTitle(document, title, headerColumn.width, maximumTitleHeight, maximumPrimaryFontSize)
      : null;
    titleElement = elementBox(headerColumn.x, headerColumn.y, headerColumn.width, Math.max(titleLayout?.height || mmToPoints(5), 1), {
      enabled: Boolean(title), fontSize: titleLayout?.fontSize || maximumPrimaryFontSize, align: 'left',
    });
    const logoTop = titleLayout
      ? headerColumn.y + titleLayout.height + metrics.headerColumnGap
      : headerColumn.y;
    const logoWidth = Math.min(
      headerColumn.width,
      clamp(headerColumn.width * 0.86, mmToPoints(16), mmToPoints(26)),
    );
    const logoHeight = Math.min(
      headerColumn.bottom - logoTop,
      clamp(metrics.headerHeight * 0.62, mmToPoints(12), mmToPoints(18)),
    );
    logoElement = elementBox(headerColumn.x, logoTop, logoWidth, logoHeight);
    const identityGap = clamp(box.height * 0.045, mmToPoints(2.2), mmToPoints(3.2));
    const identityY = Math.max(metrics.qrY + metrics.qrSize, logoTop + logoHeight) + identityGap;
    const contentBottom = box.y + box.height - metrics.verticalPadding;
    document.font('Helvetica').fontSize(6);
    const warningHeight = includeWarning
      ? Math.min(metrics.warningHeight, document.heightOfString(PERSONAL_QR_WARNING, {
        lineGap: 0.2, width: metrics.contentWidth,
      }))
      : 0;
    const footerY = contentBottom - warningHeight;
    document.font('Helvetica').fontSize(7);
    const activityHeight = activityName
      ? Math.min(metrics.activityHeight, document.currentLineHeight(true))
      : 0;
    const availableNameHeight = Math.max(1, Math.min(
      metrics.nameHeight,
      (includeWarning ? footerY - metrics.footerGap : contentBottom) - identityY
        - (activityHeight ? metrics.identityActivityGap + activityHeight : 0),
    ));
    document.font('Helvetica-Bold');
    const nameLayout = fitParticipantName(
      document,
      `${participant.first_name} ${participant.last_name}`.trim(),
      metrics.contentWidth,
      availableNameHeight,
      maximumPrimaryFontSize,
      8,
    );
    nameElement = elementBox(metrics.contentX, identityY, metrics.contentWidth, availableNameHeight, {
      fontSize: nameLayout.fontSize, align: 'center',
    });
    activityElement = elementBox(
      metrics.contentX,
      identityY + availableNameHeight + metrics.identityActivityGap,
      metrics.contentWidth,
      Math.max(activityHeight, mmToPoints(2)),
      { enabled: Boolean(activityName), fontSize: 7, align: 'center' },
    );
    disclaimerElement = elementBox(
      metrics.contentX,
      includeWarning ? footerY : contentBottom - mmToPoints(5),
      metrics.contentWidth,
      Math.max(warningHeight, mmToPoints(5)),
      {
      enabled: includeWarning, fontSize: 6, align: 'center',
      },
    );
  }
  document.end();
  return validatePrintDesign(profile, {
    version: 1,
    elements: {
      qr, code, title: titleElement, name: nameElement, activity: activityElement,
      logo: logoElement, disclaimer: disclaimerElement,
    },
  });
}

function absoluteElementBox(box, element) {
  return {
    x: box.x + mmToPoints(element.x),
    y: box.y + mmToPoints(element.y),
    width: mmToPoints(element.width),
    height: mmToPoints(element.height),
  };
}

function renderDesignedCode(document, value, box, element) {
  if (!element.enabled) return;
  const area = absoluteElementBox(box, element);
  const centerX = area.x + (area.width / 2);
  const centerY = area.y + (area.height / 2);
  const textWidth = Math.abs(element.rotation) === 90 ? area.height : area.width;
  document.save().translate(centerX, centerY).rotate(element.rotation);
  document.font('Helvetica-Bold').fontSize(element.fontSize).fillColor('#334155').text(
    String(value), -textWidth / 2, -element.fontSize * 0.58,
    { align: 'center', lineBreak: false, width: textWidth },
  );
  document.restore();
}

function renderDesignedText(document, text, box, element, { bold = false, lineGap = 0.5, title = false } = {}) {
  if (!element.enabled || !text) return;
  const area = absoluteElementBox(box, element);
  document.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(element.fontSize);
  const fitted = title
    ? fitBadgeTitle(document, text, area.width, area.height, element.fontSize)
    : bold ? fitParticipantName(document, text, area.width, area.height, element.fontSize, Math.min(8, element.fontSize))
    : null;
  const singleLine = fitted ? fitted.singleLine : document.heightOfString(text, { width: area.width }) <= document.currentLineHeight(true);
  document.fontSize(fitted?.fontSize || element.fontSize).text(
    singleLine ? truncateSingleLine(document, text, area.width) : text,
    area.x,
    area.y,
    {
      align: element.align,
      ellipsis: !singleLine,
      height: area.height,
      lineBreak: !singleLine,
      lineGap,
      width: area.width,
    },
  );
}

async function renderDesignedParticipantLabel(document, box, participant, options, design) {
  const { elements } = design;
  const qrPng = await createStudentQrPng(participant.qr_token);
  renderDesignedCode(document, participant.student_code, box, elements.code);
  if (elements.qr.enabled) {
    const qr = absoluteElementBox(box, elements.qr);
    document.image(qrPng, qr.x, qr.y, { width: qr.width, height: qr.height });
  }
  document.fillColor('#172033');
  renderDesignedText(document, options.title, box, elements.title, { bold: true, title: true });
  renderDesignedText(
    document,
    `${participant.first_name} ${participant.last_name}`.trim(),
    box,
    elements.name,
    { bold: true },
  );
  document.fillColor('#526276');
  renderDesignedText(document, options.activityName, box, elements.activity);
  if (elements.logo.enabled && options.logo?.data) {
    const logo = absoluteElementBox(box, elements.logo);
    renderContainedLogo(document, options.logo, logo.x, logo.y, logo.width, logo.height);
  }
  if (options.includeWarning && elements.disclaimer.enabled) {
    document.fillColor('#7c2d12');
    renderDesignedText(document, PERSONAL_QR_WARNING, box, elements.disclaimer, { lineGap: 0.2 });
  }
}

async function renderParticipantLabel(
  document,
  profile,
  position,
  participant,
  { activityName = '', logo = null, includeWarning = false, title = '', design = null } = {},
) {
  const boxMm = getLabelBoxMm(profile, position);
  const box = toPointBox(boxMm);
  const effectiveDesign = design || createDefaultPrintDesign(profile, {
    activityName, includeWarning, title,
  });

  document.save();
  document.rect(box.x, box.y, box.width, box.height).clip();
  await renderDesignedParticipantLabel(
    document,
    box,
    participant,
    { activityName, logo, includeWarning, title },
    effectiveDesign,
  );
  document.restore();
}

async function createParticipantQrSheetPdf({
  profile,
  participants,
  firstPosition = 1,
  activityName = '',
  logo = null,
  includeWarning = false,
  title = '',
  design = null,
}) {
  const capacity = getLabelsPerSheet(profile);
  if (!Number.isInteger(firstPosition) || firstPosition < 1 || firstPosition > capacity) {
    throw new RangeError('First label position is invalid');
  }
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new RangeError('At least one participant is required');
  }
  if (includeWarning && !canIncludeQrWarning(profile)) {
    throw new RangeError('The personal QR warning does not fit this Avery profile');
  }
  const validatedDesign = design
    ? validatePrintDesign(profile, design)
    : createDefaultPrintDesign(profile, { activityName, includeWarning, title });

  const document = createPdfDocument(profile, `QR participants — Avery ${profile.reference}`);
  const complete = collectPdf(document);
  let participantIndex = 0;
  let pageIndex = 0;

  while (participantIndex < participants.length) {
    document.addPage();
    const startPosition = pageIndex === 0 ? firstPosition - 1 : 0;
    for (let position = startPosition; position < capacity && participantIndex < participants.length; position += 1) {
      await renderParticipantLabel(document, profile, position, participants[participantIndex], {
        activityName, includeWarning, title, logo, design: validatedDesign,
      });
      participantIndex += 1;
    }
    pageIndex += 1;
  }

  document.end();
  return complete;
}

function renderCornerMarks(document, box) {
  const length = mmToPoints(2.5);
  const corners = [
    [box.x, box.y, 1, 1],
    [box.x + box.width, box.y, -1, 1],
    [box.x, box.y + box.height, 1, -1],
    [box.x + box.width, box.y + box.height, -1, -1],
  ];
  corners.forEach(([x, y, xDirection, yDirection]) => {
    document.moveTo(x, y).lineTo(x + (length * xDirection), y);
    document.moveTo(x, y).lineTo(x, y + (length * yDirection));
  });
  document.stroke();
}

async function createCalibrationSheetPdf(profile) {
  const document = createPdfDocument(profile, `Feuille de test — Avery ${profile.reference}`);
  const complete = collectPdf(document);
  document.addPage();

  document
    .font('Helvetica-Bold')
    .fontSize(6)
    .fillColor('#526276')
    .text(
      `Avery ${profile.reference} · Imprimer à 100 % / Taille réelle · Désactiver « Ajuster à la page »`,
      mmToPoints(3),
      mmToPoints(1.2),
      { align: 'center', width: mmToPoints(profile.pageWidthMm - 6), lineBreak: false },
    );

  for (let position = 0; position < getLabelsPerSheet(profile); position += 1) {
    const box = toPointBox(getLabelBoxMm(profile, position));
    document.save();
    document
      .lineWidth(0.35)
      .dash(2, { space: 2 })
      .strokeColor('#94a3b8')
      .rect(box.x, box.y, box.width, box.height)
      .stroke()
      .undash()
      .lineWidth(0.5)
      .strokeColor('#64748b');
    renderCornerMarks(document, box);
    document
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#334155')
      .text(String(position + 1), box.x, box.y + (box.height / 2) - 7, {
        align: 'center', lineBreak: false, width: box.width,
      });
    document
      .font('Helvetica')
      .fontSize(6)
      .fillColor('#64748b')
      .text(`Avery ${profile.reference}`, box.x + 4, box.y + 4, { lineBreak: false });
    document.restore();
  }

  document.end();
  return complete;
}

module.exports = {
  MINIMUM_QR_MM,
  PERSONAL_QR_WARNING,
  canIncludeQrWarning,
  createCalibrationSheetPdf,
  createDefaultPrintDesign,
  createParticipantQrSheetPdf,
  getContentMetrics,
  getLayoutFamily,
  mmToPoints,
};
