const pollInterval = 2500;
const sessionTerm = document.body.dataset.termSession || 'Élément';
const stateLabels = {
  scheduled: 'État : planifié',
  open: 'État : ouvert',
  closed: 'État : clôturé',
};
const attendanceLabels = {
  pending: 'En attente',
  present: 'Présent',
  absent: 'Absent',
};

function redirectOnUnauthorized(response) {
  if (response.status !== 401) return false;
  window.location.assign('/login');
  return true;
}

function authenticationError() {
  const error = new Error('Authentication required');
  error.authenticationRequired = true;
  return error;
}

function updateStatusBadge(element, status, label) {
  if (!element) return;
  element.classList.remove(
    'status-scheduled',
    'status-open',
    'status-closed',
    'status-pending',
    'status-present',
    'status-absent',
  );
  element.classList.add(`status-${status}`);
  element.textContent = label;
}

async function fetchSessionStatus(sessionId) {
  const response = await fetch(`/sessions/${sessionId}/status`, {
    headers: { accept: 'application/json' },
  });
  if (redirectOnUnauthorized(response)) throw authenticationError();
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Unable to refresh session status');
  }
  return response.json();
}

function startPolling(refresh) {
  let timerId;
  const poll = async () => {
    let shouldContinue = true;
    try {
      shouldContinue = await refresh();
    } catch (error) {
      shouldContinue = !error.authenticationRequired;
    }
    if (shouldContinue) timerId = window.setTimeout(poll, pollInterval);
  };
  timerId = window.setTimeout(poll, pollInterval);
  return () => window.clearTimeout(timerId);
}

const attendanceSearch = document.querySelector('[data-attendance-search]');
const attendanceRows = [...document.querySelectorAll('[data-student-id]')];

function filterAttendanceRows() {
  if (!attendanceSearch) return;
  const query = attendanceSearch.value.trim().toLocaleLowerCase('fr');
  let visibleCount = 0;
  attendanceRows.forEach((row) => {
    const matches = row.dataset.inRoster !== 'false' && row.dataset.search.includes(query);
    row.hidden = !matches;
    if (matches) visibleCount += 1;
  });
  const noResults = document.querySelector('[data-attendance-no-results]');
  if (noResults) noResults.hidden = visibleCount > 0;
}

attendanceSearch?.addEventListener('input', filterAttendanceRows);

const liveSession = document.querySelector('[data-live-session]');
let refreshLiveSession;
if (liveSession) {
  refreshLiveSession = async () => {
    const status = await fetchSessionStatus(liveSession.dataset.sessionId);
    liveSession.querySelector('[data-present-count]').textContent = status.present;
    liveSession.querySelector('[data-total-count]').textContent = status.total;
    updateStatusBadge(
      liveSession.querySelector('[data-session-state]'),
      status.state,
      stateLabels[status.state],
    );

    const roster = new Map(status.roster.map((entry) => [entry.studentId, entry.status]));
    attendanceRows.forEach((row) => {
      const attendanceStatus = roster.get(row.dataset.studentId);
      row.dataset.inRoster = String(Boolean(attendanceStatus));
      if (attendanceStatus) {
        updateStatusBadge(
          row.querySelector('[data-attendance-status]'),
          attendanceStatus,
          attendanceLabels[attendanceStatus],
        );
      }
    });
    filterAttendanceRows();

    if (status.state === 'closed') {
      document.querySelectorAll('[data-attendance-actions]').forEach((actions) => {
        actions.hidden = true;
      });
      document.querySelector('[data-session-edit]')?.setAttribute('hidden', '');
      document.querySelector('[data-session-close]')?.setAttribute('hidden', '');
      document.querySelector('[data-quick-attendance-link]')?.setAttribute('hidden', '');
      document.querySelector('[data-session-open]')?.removeAttribute('hidden');
      document.querySelector('[data-live-readonly]')?.removeAttribute('hidden');
      return false;
    }
    return true;
  };
  startPolling(refreshLiveSession);
}

document.querySelectorAll('[data-attendance-form]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = new URLSearchParams(new FormData(form, event.submitter));
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (redirectOnUnauthorized(response)) return;
      if (!response.ok) throw new Error('Unable to update attendance');
      document.querySelector('[data-live-error]')?.setAttribute('hidden', '');
      await refreshLiveSession?.();
    } catch (_error) {
      document.querySelector('[data-live-error]')?.removeAttribute('hidden');
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  });
});

document.querySelectorAll('[data-live-session-card]').forEach((card) => {
  startPolling(async () => {
    const status = await fetchSessionStatus(card.dataset.sessionId);
    card.querySelector('[data-present-count]')?.replaceChildren(String(status.present));
    card.querySelector('[data-total-count]')?.replaceChildren(String(status.total));
    updateStatusBadge(card.querySelector('[data-session-state]'), status.state, stateLabels[status.state]);

    if (status.state === 'closed') {
      const dashboard = card.closest('[data-live-dashboard]');
      if (dashboard) {
        const sessionList = card.closest('[data-live-session-list]');
        card.remove();
        if (!dashboard.querySelector('[data-live-session-card]')) {
          sessionList?.setAttribute('hidden', '');
          dashboard.querySelector('[data-live-empty-state]')?.removeAttribute('hidden');
        }
      } else {
        card.querySelector('[data-session-edit]')?.setAttribute('hidden', '');
        card.querySelector('[data-session-edit-disabled]')?.removeAttribute('hidden');
      }
      return false;
    }
    return true;
  });
});

const quickAttendance = document.querySelector('[data-quick-attendance]');

if (quickAttendance) {
  const sessionId = quickAttendance.dataset.sessionId;
  const searchInput = quickAttendance.querySelector('[data-quick-search]');
  const rows = [...quickAttendance.querySelectorAll('[data-quick-student]')];
  const results = quickAttendance.querySelector('[data-quick-results]');
  const noResults = quickAttendance.querySelector('[data-quick-no-results]');
  const completeState = quickAttendance.querySelector('[data-quick-complete]');
  const feedbackMessage = quickAttendance.querySelector('[data-quick-feedback]');
  const readonlyMessage = quickAttendance.querySelector('[data-quick-readonly]');
  const undoButton = quickAttendance.querySelector('[data-quick-undo]');
  const searchClearButton = quickAttendance.querySelector('[data-quick-search-clear]');
  const modeButtons = [...quickAttendance.querySelectorAll('[data-quick-mode]')];
  const modePanels = [...quickAttendance.querySelectorAll('[data-quick-mode-panel]')];
  const feedbackAnchors = [...quickAttendance.querySelectorAll('[data-quick-feedback-anchor]')];
  const qrStartButton = quickAttendance.querySelector('[data-qr-start]');
  const qrView = quickAttendance.querySelector('[data-qr-view]');
  const qrVideo = quickAttendance.querySelector('[data-qr-video]');
  const qrGuide = quickAttendance.querySelector('[data-qr-guide]');
  const qrPlaceholder = quickAttendance.querySelector('[data-qr-placeholder]');
  const qrSoundButton = quickAttendance.querySelector('[data-qr-sound]');
  const qrCameraSwitchButton = quickAttendance.querySelector('[data-qr-camera-switch]');
  const qrScanResult = quickAttendance.querySelector('[data-qr-scan-result]');
  let undoCandidate = null;
  let qrScanner = null;
  let qrScannerClass = null;
  let audioContext = null;
  let soundEnabled = true;
  let scannerActive = false;
  let scannerStarting = false;
  let cameraSwitching = false;
  let scannerUnavailable = false;
  let scannerUnavailableMessage = '';
  let scanProcessing = false;
  let lastScan = { payload: '', at: 0 };
  let scannerGeneration = 0;
  let availableCameras = [];
  let selectedCamera = 'environment';
  let qrResultHideTimer = null;
  let qrResultResetTimer = null;
  let currentMode = 'manual';

  const setFeedback = (message = '', type = '') => {
    if (!feedbackMessage) return;
    feedbackMessage.classList.remove('message-success', 'message-warning', 'message-error');
    if (type) feedbackMessage.classList.add(`message-${type}`);
    feedbackMessage.textContent = message || '\u00a0';
  };

  const setError = (message = '') => setFeedback(message, message ? 'error' : '');

  const updateUndoButton = () => {
    if (undoButton) undoButton.disabled = !undoCandidate;
  };

  const setQrFeedback = setFeedback;

  const waitForNextFrame = () => new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(resolve);
      return;
    }
    window.setTimeout(resolve, 0);
  });

  const prepareAudio = async () => {
    if (!soundEnabled) return null;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      if (!audioContext) audioContext = new AudioContext();
      if (audioContext.state === 'suspended') await audioContext.resume();
      return audioContext.state === 'running' ? audioContext : null;
    } catch (_error) {
      return null;
    }
  };

  const playQrFeedbackTone = async (type) => {
    if (!soundEnabled) return;
    try {
      const context = await prepareAudio();
      if (!context) return;
      const tones = {
        success: [
          { frequency: 740, offset: 0, duration: 0.09, volume: 0.16 },
          { frequency: 1040, offset: 0.1, duration: 0.11, volume: 0.16 },
        ],
        failure: [
          { frequency: 420, offset: 0, duration: 0.1, volume: 0.1 },
          { frequency: 260, offset: 0.11, duration: 0.14, volume: 0.1 },
        ],
      };
      const startTime = context.currentTime;
      tones[type].forEach(({ frequency, offset, duration, volume }) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const toneStart = startTime + offset;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, toneStart);
        gain.gain.setValueAtTime(0.0001, toneStart);
        gain.gain.exponentialRampToValueAtTime(volume, toneStart + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(toneStart);
        oscillator.stop(toneStart + duration);
      });
    } catch (_error) {
      // Audio feedback must never interrupt attendance scanning.
    }
  };

  const clearQrScanResult = () => {
    window.clearTimeout(qrResultHideTimer);
    window.clearTimeout(qrResultResetTimer);
    qrScanResult?.classList.remove('is-visible', 'is-success', 'is-failure');
  };

  const showQrScanResult = (type) => {
    if (!qrScanResult) return;
    window.clearTimeout(qrResultHideTimer);
    window.clearTimeout(qrResultResetTimer);
    qrScanResult.classList.remove('is-success', 'is-failure');
    qrScanResult.classList.add(`is-${type}`, 'is-visible');
    qrResultHideTimer = window.setTimeout(() => {
      qrScanResult.classList.remove('is-visible');
      qrResultResetTimer = window.setTimeout(() => {
        qrScanResult.classList.remove('is-success', 'is-failure');
      }, 180);
    }, 720);
  };

  const triggerQrScanFeedback = (type, generation) => {
    if (
      currentMode !== 'qr'
      || !scannerActive
      || generation !== scannerGeneration
    ) {
      return false;
    }
    showQrScanResult(type);
    playQrFeedbackTone(type);
    try {
      navigator.vibrate?.(type === 'success' ? 80 : [60, 40, 60, 40, 60]);
    } catch (_error) {
      // Haptic feedback is optional and must never interrupt attendance scanning.
    }
    return true;
  };

  const activeCameraId = () => qrVideo?.srcObject
    ?.getVideoTracks?.()[0]
    ?.getSettings?.().deviceId || '';

  const cameraMatchingFacingMode = (cameras, facingMode) => {
    const labelPattern = facingMode === 'environment'
      ? /back|rear|environment|world|arrière/i
      : /front|user|face|avant/i;
    return cameras.find((camera) => labelPattern.test(camera.label || ''));
  };

  const updateCameraSwitchButton = () => {
    if (!qrCameraSwitchButton) return;
    qrCameraSwitchButton.hidden = availableCameras.length < 2;
    qrCameraSwitchButton.disabled = !scannerActive
      || scannerStarting
      || cameraSwitching
      || scanProcessing;
  };

  const refreshAvailableCameras = async (generation) => {
    if (!qrScannerClass) return;
    try {
      const cameras = await qrScannerClass.listCameras(false);
      if (generation !== scannerGeneration || currentMode !== 'qr') return;
      const seen = new Set();
      availableCameras = cameras.filter((camera) => {
        if (!camera.id || seen.has(camera.id)) return false;
        seen.add(camera.id);
        return true;
      });
      const currentCameraId = activeCameraId();
      if (currentCameraId && availableCameras.some((camera) => camera.id === currentCameraId)) {
        selectedCamera = currentCameraId;
      } else if (selectedCamera === 'environment' || selectedCamera === 'user') {
        selectedCamera = cameraMatchingFacingMode(availableCameras, selectedCamera)?.id
          || selectedCamera;
      }
    } catch (_error) {
      availableCameras = [];
    }
    updateCameraSwitchButton();
  };

  const updateSoundButton = () => {
    if (!qrSoundButton) return;
    qrSoundButton.textContent = soundEnabled ? 'Son activé' : 'Son désactivé';
    qrSoundButton.setAttribute('aria-pressed', String(soundEnabled));
  };

  const updateQuickCount = (present, total) => {
    quickAttendance.querySelector('[data-present-count]').textContent = present;
    quickAttendance.querySelector('[data-total-count]').textContent = total;
  };

  const updateSearchClearButton = () => {
    if (searchClearButton) searchClearButton.hidden = searchInput.value.length === 0;
  };

  const filterQuickRows = () => {
    const query = searchInput.value.trim().toLocaleLowerCase('fr');
    let eligibleCount = 0;
    let visibleCount = 0;

    rows.forEach((row) => {
      const eligible = row.dataset.eligible !== 'false';
      const matches = eligible && row.dataset.search.includes(query);
      row.hidden = !matches;
      if (eligible) eligibleCount += 1;
      if (matches) visibleCount += 1;
    });

    if (results) results.hidden = visibleCount === 0;
    if (noResults) noResults.hidden = eligibleCount === 0 || visibleCount > 0;
    if (completeState) completeState.hidden = eligibleCount > 0;
    updateSearchClearButton();
  };

  const focusSearch = () => {
    try {
      searchInput.focus({ preventScroll: true });
    } catch (_error) {
      searchInput.focus();
    }
  };

  const clearManualSearch = ({ focus = false } = {}) => {
    searchInput.value = '';
    filterQuickRows();
    if (focus) focusSearch();
  };

  const applyPresentResult = (payload, row = null) => {
    if (!payload.changed) return;

    undoCandidate = {
      studentId: payload.studentId,
      previousStatus: payload.previousStatus,
      version: payload.version,
    };
    updateUndoButton();
    const studentRow = row || rows.find(
      (candidateRow) => candidateRow.dataset.studentId === payload.studentId,
    );
    if (studentRow) studentRow.dataset.eligible = 'false';
    filterQuickRows();
    const presentCount = Number(quickAttendance.querySelector('[data-present-count]').textContent);
    const totalCount = Number(quickAttendance.querySelector('[data-total-count]').textContent);
    updateQuickCount(presentCount + 1, totalCount);
  };

  const stopScanner = ({ offerRestart = false, placeholder = 'Caméra arrêtée.' } = {}) => {
    scannerGeneration += 1;
    qrScanner?.stop().catch(() => {});
    scannerActive = false;
    updateCameraSwitchButton();
    qrView?.classList.add('is-inactive');
    if (qrGuide) qrGuide.hidden = true;
    if (qrPlaceholder) {
      qrPlaceholder.textContent = placeholder;
      qrPlaceholder.hidden = false;
    }
    if (qrStartButton) {
      qrStartButton.hidden = !offerRestart;
      qrStartButton.disabled = scannerUnavailable;
    }
  };

  const refreshQuickAttendance = async () => {
    const status = await fetchSessionStatus(sessionId);
    updateQuickCount(status.present, status.total);
    updateStatusBadge(
      quickAttendance.querySelector('[data-session-state]'),
      status.state,
      stateLabels[status.state],
    );

    const roster = new Map(status.roster.map((entry) => [entry.studentId, entry.status]));
    rows.forEach((row) => {
      const attendanceStatus = roster.get(row.dataset.studentId);
      row.dataset.eligible = String(
        status.state === 'open' && Boolean(attendanceStatus) && attendanceStatus !== 'present',
      );
    });
    filterQuickRows();

    if (status.state === 'closed') {
      undoCandidate = null;
      updateUndoButton();
      searchInput.disabled = true;
      if (searchClearButton) searchClearButton.disabled = true;
      modeButtons.forEach((button) => { button.disabled = true; });
      scannerUnavailable = true;
      stopScanner({ placeholder: `${sessionTerm} clôturée.` });
      if (qrSoundButton) qrSoundButton.disabled = true;
      if (completeState) completeState.hidden = true;
      setFeedback();
      readonlyMessage?.removeAttribute('hidden');
      return false;
    }
    return true;
  };

  searchInput.addEventListener('input', filterQuickRows);
  searchClearButton?.addEventListener('click', () => clearManualSearch({ focus: true }));

  quickAttendance.querySelectorAll('[data-quick-present-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      const row = form.closest('[data-quick-student]');
      const studentName = row.querySelector('.compact-title').textContent.trim();
      button.disabled = true;
      setError();
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { accept: 'application/json' },
        });
        if (redirectOnUnauthorized(response)) return;
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'La mise à jour est impossible pour le moment.');

        applyPresentResult(payload, row);
        setFeedback(
          payload.changed ? `${studentName} — présent` : `${studentName} est déjà présent`,
          payload.changed ? 'success' : 'warning',
        );
        clearManualSearch({ focus: true });
        await refreshQuickAttendance().catch(() => {});
      } catch (error) {
        setError(error.message || 'La mise à jour est impossible pour le moment. Réessayez.');
        focusSearch();
      } finally {
        button.disabled = false;
      }
    });
  });

  undoButton.addEventListener('click', async () => {
    if (!undoCandidate) return;
    const candidate = undoCandidate;
    undoButton.disabled = true;
    setError();
    try {
      const body = new URLSearchParams({
        previous_status: candidate.previousStatus,
        expected_version: candidate.version,
      });
      const response = await fetch(
        `/sessions/${sessionId}/quick-attendance/${candidate.studentId}/undo`,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body,
        },
      );
      if (redirectOnUnauthorized(response)) return;
      const payload = await response.json();
      undoCandidate = null;
      updateUndoButton();
      if (!response.ok) {
        setError(payload.error || 'Cette action ne peut plus être annulée.');
        await refreshQuickAttendance();
        return;
      }

      const row = rows.find((studentRow) => studentRow.dataset.studentId === candidate.studentId);
      if (row) row.dataset.eligible = 'true';
      filterQuickRows();
      const presentCount = Number(quickAttendance.querySelector('[data-present-count]').textContent);
      const totalCount = Number(quickAttendance.querySelector('[data-total-count]').textContent);
      updateQuickCount(Math.max(0, presentCount - 1), totalCount);
      setFeedback('Dernière action annulée.', 'success');
      await refreshQuickAttendance();
    } catch (_error) {
      undoCandidate = candidate;
      updateUndoButton();
      setError('L’annulation a échoué. Réessayez.');
    }
  });

  const handleQrResult = async (result) => {
    const payloadValue = result?.data;
    const now = Date.now();
    if (
      scanProcessing
      || typeof payloadValue !== 'string'
      || (lastScan.payload === payloadValue && now - lastScan.at < 2500)
    ) {
      return;
    }

    lastScan = { payload: payloadValue, at: now };
    const resultGeneration = scannerGeneration;
    scanProcessing = true;
    updateCameraSwitchButton();
    let scanFeedbackHandled = false;
    setQrFeedback('QR détecté, vérification…', 'warning');
    try {
      const response = await fetch(`/sessions/${sessionId}/quick-attendance/qr`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ payload: payloadValue }),
      });
      if (redirectOnUnauthorized(response)) return;
      const payload = await response.json();
      if (!response.ok) {
        setQrFeedback(payload.message || 'QR non reconnu.', 'error');
        scanFeedbackHandled = triggerQrScanFeedback('failure', resultGeneration);
        await refreshQuickAttendance();
        return;
      }

      applyPresentResult(payload);
      setQrFeedback(payload.message, payload.changed ? 'success' : 'warning');
      scanFeedbackHandled = triggerQrScanFeedback(
        payload.changed ? 'success' : 'failure',
        resultGeneration,
      );
      await refreshQuickAttendance();
    } catch (_error) {
      setQrFeedback('Le QR n’a pas pu être traité. Réessayez.', 'error');
      if (
        !scanFeedbackHandled
        && triggerQrScanFeedback('failure', resultGeneration)
      ) {
        scanFeedbackHandled = true;
      }
    } finally {
      scanProcessing = false;
      updateCameraSwitchButton();
    }
  };

  const startScanner = async () => {
    if (scannerUnavailable) {
      setQrFeedback(scannerUnavailableMessage || 'Scanner indisponible. Passez en mode Manuel.', 'error');
      return;
    }
    if (scannerActive || scannerStarting || cameraSwitching || currentMode !== 'qr') return;
    const startGeneration = scannerGeneration;
    scannerStarting = true;
    updateCameraSwitchButton();
    if (qrStartButton) {
      qrStartButton.disabled = true;
      qrStartButton.hidden = true;
    }
    if (qrPlaceholder) {
      qrPlaceholder.textContent = 'Activation de la caméra…';
      qrPlaceholder.hidden = false;
    }
    setQrFeedback('Activation de la caméra…', 'warning');

    try {
      await prepareAudio();
      if (currentMode !== 'qr') return;
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera unsupported');
      }
      const { default: QrScanner } = await import('/vendor/qr-scanner/qr-scanner.min.js');
      qrScannerClass = QrScanner;
      if (currentMode !== 'qr') return;
      if (!(await QrScanner.hasCamera())) {
        throw new Error('Camera not found');
      }
      if (currentMode !== 'qr') return;
      if (!qrScanner) {
        qrScanner = new QrScanner(qrVideo, handleQrResult, {
          preferredCamera: selectedCamera,
          maxScansPerSecond: 8,
          returnDetailedScanResult: true,
        });
      }
      await qrScanner.start();
      if (currentMode !== 'qr' || startGeneration !== scannerGeneration) {
        stopScanner();
        return;
      }
      scannerActive = true;
      qrView?.classList.remove('is-inactive');
      if (qrGuide) qrGuide.hidden = false;
      if (qrPlaceholder) qrPlaceholder.hidden = true;
      if (qrStartButton) qrStartButton.hidden = true;
      await refreshAvailableCameras(startGeneration);
      setQrFeedback('Présentez un QR devant la caméra.', 'success');
    } catch (error) {
      const reason = `${error?.name || ''} ${error?.message || error}`;
      if (/NotAllowed|Permission|denied/i.test(reason)) {
        scannerUnavailable = true;
        scannerUnavailableMessage = 'Accès à la caméra refusé. Passez en mode Manuel.';
        stopScanner({ placeholder: 'Accès à la caméra refusé.' });
        setQrFeedback(scannerUnavailableMessage, 'error');
      } else if (/not found|NotFound|DevicesNotFound/i.test(reason)) {
        scannerUnavailable = true;
        scannerUnavailableMessage = 'Aucune caméra disponible. Passez en mode Manuel.';
        stopScanner({ placeholder: 'Aucune caméra disponible.' });
        setQrFeedback(scannerUnavailableMessage, 'error');
      } else if (/unsupported/i.test(reason)) {
        scannerUnavailable = true;
        scannerUnavailableMessage = 'Scanner indisponible sur ce navigateur. Passez en mode Manuel.';
        stopScanner({ placeholder: 'Scanner indisponible.' });
        setQrFeedback(scannerUnavailableMessage, 'error');
      } else {
        scannerUnavailable = false;
        scannerUnavailableMessage = '';
        stopScanner({ offerRestart: true, placeholder: 'La caméra n’a pas démarré.' });
        setQrFeedback('Le scanner n’a pas pu démarrer. Réessayez ou passez en mode Manuel.', 'error');
      }
    } finally {
      scannerStarting = false;
      updateCameraSwitchButton();
      if (qrStartButton && !scannerUnavailable) qrStartButton.disabled = false;
    }
  };

  const switchCamera = async () => {
    if (
      !qrScanner
      || !scannerActive
      || scannerStarting
      || cameraSwitching
      || scanProcessing
      || availableCameras.length < 2
      || currentMode !== 'qr'
    ) {
      return;
    }

    const currentCameraId = activeCameraId() || selectedCamera;
    const currentIndex = availableCameras.findIndex((camera) => camera.id === currentCameraId);
    const nextCamera = availableCameras[(currentIndex + 1 + availableCameras.length) % availableCameras.length];
    const previousCamera = selectedCamera;
    const switchGeneration = ++scannerGeneration;
    cameraSwitching = true;
    scannerActive = false;
    lastScan = { payload: '', at: 0 };
    updateCameraSwitchButton();
    setQrFeedback('Changement de caméra…', 'warning');

    try {
      selectedCamera = nextCamera.id;
      await qrScanner.setCamera(selectedCamera);
      if (currentMode !== 'qr' || switchGeneration !== scannerGeneration) {
        await qrScanner.stop().catch(() => {});
        return;
      }
      scannerActive = true;
      qrView?.classList.remove('is-inactive');
      if (qrGuide) qrGuide.hidden = false;
      if (qrPlaceholder) qrPlaceholder.hidden = true;
      await refreshAvailableCameras(switchGeneration);
      setQrFeedback('Présentez un QR devant la caméra.', 'success');
    } catch (_error) {
      if (currentMode !== 'qr' || switchGeneration !== scannerGeneration) return;
      selectedCamera = previousCamera;
      try {
        await qrScanner.stop();
        await qrScanner.setCamera(selectedCamera);
        await qrScanner.start();
        if (currentMode !== 'qr' || switchGeneration !== scannerGeneration) {
          await qrScanner.stop().catch(() => {});
          return;
        }
        scannerActive = true;
        qrView?.classList.remove('is-inactive');
        if (qrGuide) qrGuide.hidden = false;
        if (qrPlaceholder) qrPlaceholder.hidden = true;
        await refreshAvailableCameras(switchGeneration);
      } catch (_restartError) {
        scannerActive = false;
        if (qrGuide) qrGuide.hidden = true;
        if (qrPlaceholder) {
          qrPlaceholder.textContent = 'La caméra n’a pas redémarré.';
          qrPlaceholder.hidden = false;
        }
        if (qrStartButton) qrStartButton.hidden = false;
      }
      setQrFeedback('Impossible de changer de caméra. Réessayez.', 'error');
    } finally {
      cameraSwitching = false;
      updateCameraSwitchButton();
      if (currentMode === 'qr' && !scannerActive && switchGeneration !== scannerGeneration) {
        startScanner();
      }
    }
  };

  const setMode = async (mode, { focus = true } = {}) => {
    if (!['manual', 'qr'].includes(mode)) return;
    currentMode = mode;

    if (mode === 'manual') {
      clearQrScanResult();
      stopScanner();
    }

    modeButtons.forEach((button) => {
      const selected = button.dataset.quickMode === mode;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('active', selected);
    });
    modePanels.forEach((panel) => {
      panel.hidden = panel.dataset.quickModePanel !== mode;
    });
    const feedbackAnchor = feedbackAnchors.find(
      (anchor) => anchor.dataset.quickFeedbackAnchor === mode,
    );
    if (feedbackAnchor && feedbackMessage) feedbackAnchor.after(feedbackMessage);
    setFeedback();

    if (mode === 'manual') {
      if (focus) focusSearch();
      return;
    }

    await waitForNextFrame();
    if (currentMode !== 'qr') return;
    await startScanner();
  };

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.quickMode === 'qr') prepareAudio();
      return setMode(button.dataset.quickMode);
    });
  });

  qrStartButton?.addEventListener('click', startScanner);
  qrCameraSwitchButton?.addEventListener('click', switchCamera);

  qrSoundButton?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    updateSoundButton();
    if (soundEnabled) prepareAudio();
  });

  window.addEventListener('pagehide', () => {
    currentMode = '';
    scannerGeneration += 1;
    scannerActive = false;
    clearQrScanResult();
    qrScanner?.destroy();
  });

  filterQuickRows();
  setMode('manual', { focus: false });
  startPolling(refreshQuickAttendance);
}
