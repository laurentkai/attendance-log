const PDFDocument = require('pdfkit');
const { createStudentQrPng } = require('./student-qr');
const { PERSONAL_QR_WARNING } = require('./student-qr-content');
const { getLabelBoxMm, getLabelsPerSheet } = require('./avery-profiles');

const POINTS_PER_MM = 72 / 25.4;
const MINIMUM_QR_MM = 24;

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

function renderBadgeTitle(document, title, x, y, width, height, maximumFontSize) {
  if (!title || width < mmToPoints(8) || height < mmToPoints(3.5)) return null;
  const layout = fitBadgeTitle(document, title, width, height, maximumFontSize);
  document.font('Helvetica-Bold').fontSize(layout.fontSize).fillColor('#172033');
  document.text(
    layout.singleLine ? truncateSingleLine(document, title, width) : title,
    x,
    y,
    {
      ellipsis: !layout.singleLine,
      height,
      lineBreak: !layout.singleLine,
      lineGap: 0.5,
      width,
    },
  );
  return layout;
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
  return (profile.labelHeightMm >= 52 && profile.labelWidthMm >= 80)
    || (profile.labelHeightMm >= 68 && profile.labelWidthMm >= 60);
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
  const titleGapMm = 0.8;
  const spareVerticalMm = boxMm.height - (2 * verticalPaddingMm) - qrSizeMm - reservedBottomMm;
  const fullTitleHeightMm = hasTitle && spareVerticalMm >= 5.8
    ? Math.min(9.5, spareVerticalMm - titleGapMm)
    : 0;
  const titlePlacement = !hasTitle ? 'none' : fullTitleHeightMm > 0 ? 'full' : 'side';
  const qrXmm = titlePlacement === 'side'
    ? contentLeftMm
    : contentLeftMm + ((contentWidthMm - qrSizeMm) / 2);
  const qrYmm = boxMm.y + verticalPaddingMm
    + (titlePlacement === 'full' ? fullTitleHeightMm + titleGapMm : 0);
  const sideTitleXmm = qrXmm + qrSizeMm + titleGapMm;
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
    titlePlacement,
    titleX: mmToPoints(titlePlacement === 'full' ? contentLeftMm : sideTitleXmm),
    titleY: mmToPoints(boxMm.y + verticalPaddingMm),
    titleWidth: mmToPoints(titlePlacement === 'full'
      ? contentWidthMm
      : Math.max(0, contentRightMm - sideTitleXmm)),
    titleHeight: mmToPoints(titlePlacement === 'full'
      ? fullTitleHeightMm
      : Math.min(10, qrSizeMm)),
    nameHeight: mmToPoints(nameHeightMm),
    activityHeight: mmToPoints(activityHeightMm),
    warningHeight: mmToPoints(warningHeightMm),
    contentGap: mmToPoints(0.8),
  };
}

function renderRotatedCode(document, code, box, metrics) {
  const centerX = box.x + metrics.horizontalPadding + (metrics.codeStripWidth / 2);
  const centerY = box.y + (box.height / 2);
  const availableLength = box.height - (2 * metrics.verticalPadding);
  const fontSize = clamp(metrics.codeStripWidth * 0.63, 7, 10);

  document.save();
  document.translate(centerX, centerY);
  document.rotate(-90);
  document
    .font('Helvetica-Bold')
    .fontSize(fontSize)
    .fillColor('#334155')
    .text(String(code), -availableLength / 2, -fontSize * 0.58, {
      align: 'center', lineBreak: false, width: availableLength,
    });
  document.restore();
}

function renderWideText(document, participant, activityName, title, metrics) {
  const { box } = metrics;
  const textX = metrics.qrX + metrics.qrSize + metrics.qrTextGap;
  const textWidth = Math.max(1, box.x + box.width - metrics.horizontalPadding - textX);
  const titleGap = title ? mmToPoints(0.8) : 0;
  const textTop = box.y + metrics.verticalPadding;
  const availableHeight = box.height - (2 * metrics.verticalPadding);
  const maximumPrimaryFontSize = clamp(box.height * 0.16, 10, 14);
  const maximumTitleHeight = title ? Math.min(mmToPoints(9.5), availableHeight * 0.42) : 0;
  const titleLayout = title
    ? renderBadgeTitle(
      document,
      title,
      textX,
      textTop,
      textWidth,
      maximumTitleHeight,
      maximumPrimaryFontSize,
    )
    : null;
  const renderedTitleHeight = titleLayout?.height || 0;
  const identityTop = textTop + renderedTitleHeight + (titleLayout ? titleGap : 0);
  const textHeight = availableHeight - renderedTitleHeight - (titleLayout ? titleGap : 0);
  const name = `${participant.first_name} ${participant.last_name}`.trim();
  const activityHeight = activityName ? 9 : 0;
  const blockGap = activityName ? mmToPoints(1.1) : 0;
  const nameHeight = textHeight - activityHeight - blockGap;

  document.font('Helvetica-Bold');
  const nameLayout = fitParticipantName(
    document, name, textWidth, nameHeight, maximumPrimaryFontSize,
  );
  const totalHeight = nameLayout.height + blockGap + activityHeight;
  const textY = identityTop + Math.max(0, (textHeight - totalHeight) / 2);
  document
    .fontSize(nameLayout.fontSize)
    .fillColor('#172033')
    .text(name, textX, textY, {
      ellipsis: true,
      height: nameHeight,
      lineGap: 0.5,
      lineBreak: !nameLayout.singleLine,
      width: textWidth,
    });

  if (activityName) {
    document.font('Helvetica').fontSize(clamp(box.height * 0.065, 6, 8));
    document
      .fillColor('#526276')
      .text(truncateSingleLine(document, activityName, textWidth), textX,
        textY + nameLayout.height + blockGap, {
          height: activityHeight, lineBreak: false, width: textWidth,
        });
  }
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

function renderBalancedContent(document, participant, activityName, logo, includeWarning, title, metrics) {
  const { box } = metrics;
  const name = `${participant.first_name} ${participant.last_name}`.trim();
  const maximumPrimaryFontSize = clamp(box.width * 0.055, 11, 15);
  renderBadgeTitle(
    document,
    title,
    metrics.titleX,
    metrics.titleY,
    metrics.titleWidth,
    metrics.titleHeight,
    maximumPrimaryFontSize,
  );
  const topRightX = metrics.qrX + metrics.qrSize + metrics.contentGap;
  const topRightWidth = box.x + box.width - metrics.horizontalPadding - topRightX;
  if (metrics.titlePlacement === 'side') {
    const logoY = metrics.titleY + metrics.titleHeight + metrics.contentGap;
    renderContainedLogo(
      document,
      logo,
      metrics.titleX,
      logoY,
      metrics.titleWidth,
      Math.max(0, metrics.qrY + metrics.qrSize - logoY),
    );
  } else {
    renderContainedLogo(
      document,
      logo,
      topRightX,
      metrics.qrY,
      topRightWidth,
      Math.min(metrics.qrSize, mmToPoints(12)),
    );
  }

  let bottomY = box.y + box.height - metrics.verticalPadding;
  if (includeWarning) {
    const warningY = bottomY - metrics.warningHeight;
    document
      .font('Helvetica')
      .fontSize(6)
      .fillColor('#7c2d12')
      .text(PERSONAL_QR_WARNING, metrics.contentX, warningY, {
        align: 'left',
        ellipsis: false,
        height: metrics.warningHeight,
        lineGap: 0.2,
        width: metrics.contentWidth,
      });
    bottomY = warningY - metrics.contentGap;
  }

  if (activityName) {
    const activityY = bottomY - metrics.activityHeight;
    document.font('Helvetica').fontSize(7).fillColor('#526276');
    document.text(
      truncateSingleLine(document, activityName, metrics.contentWidth),
      metrics.contentX,
      activityY,
      { height: metrics.activityHeight, lineBreak: false, width: metrics.contentWidth },
    );
    bottomY = activityY - metrics.contentGap;
  }

  const nameY = Math.max(metrics.qrY + metrics.qrSize + metrics.contentGap, bottomY - metrics.nameHeight);
  const nameHeight = Math.max(1, bottomY - nameY);
  document.font('Helvetica-Bold');
  const nameLayout = fitParticipantName(
    document,
    name,
    metrics.contentWidth,
    nameHeight,
    maximumPrimaryFontSize,
    8,
  );
  document
    .fontSize(nameLayout.fontSize)
    .fillColor('#172033')
    .text(name, metrics.contentX, nameY, {
      align: 'center',
      ellipsis: true,
      height: nameHeight,
      lineGap: 0.5,
      lineBreak: !nameLayout.singleLine,
      width: metrics.contentWidth,
    });
}

async function renderParticipantLabel(
  document,
  profile,
  position,
  participant,
  { activityName = '', logo = null, includeWarning = false, title = '' } = {},
) {
  const boxMm = getLabelBoxMm(profile, position);
  const metrics = getContentMetrics(boxMm, {
    includeWarning,
    hasActivity: Boolean(activityName),
    hasTitle: Boolean(title),
  });
  const { box } = metrics;
  const qrPng = await createStudentQrPng(participant.qr_token);

  document.save();
  document.rect(box.x, box.y, box.width, box.height).clip();
  renderRotatedCode(document, participant.student_code, box, metrics);
  document.image(qrPng, metrics.qrX, metrics.qrY, {
    height: metrics.qrSize,
    width: metrics.qrSize,
  });
  if (metrics.family === 'balanced') {
    renderBalancedContent(document, participant, activityName, logo, includeWarning, title, metrics);
  } else {
    renderWideText(document, participant, activityName, title, metrics);
  }
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

  const document = createPdfDocument(profile, `QR participants — Avery ${profile.reference}`);
  const complete = collectPdf(document);
  let participantIndex = 0;
  let pageIndex = 0;

  while (participantIndex < participants.length) {
    document.addPage();
    const startPosition = pageIndex === 0 ? firstPosition - 1 : 0;
    for (let position = startPosition; position < capacity && participantIndex < participants.length; position += 1) {
      await renderParticipantLabel(document, profile, position, participants[participantIndex], {
        activityName, includeWarning, title, logo,
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
  createParticipantQrSheetPdf,
  getContentMetrics,
  getLayoutFamily,
  mmToPoints,
};
