const pollInterval = 2500;
const stateLabels = {
  scheduled: 'Séance planifiée',
  open: 'Séance ouverte',
  closed: 'Séance clôturée',
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
  const errorMessage = quickAttendance.querySelector('[data-quick-error]');
  const readonlyMessage = quickAttendance.querySelector('[data-quick-readonly]');
  const undoButton = quickAttendance.querySelector('[data-quick-undo]');
  const qrStartButton = quickAttendance.querySelector('[data-qr-start]');
  const qrStopButton = quickAttendance.querySelector('[data-qr-stop]');
  const qrView = quickAttendance.querySelector('[data-qr-view]');
  const qrVideo = quickAttendance.querySelector('[data-qr-video]');
  const qrFeedback = quickAttendance.querySelector('[data-qr-feedback]');
  const qrSoundButton = quickAttendance.querySelector('[data-qr-sound]');
  let undoCandidate = null;
  let qrScanner = null;
  let audioContext = null;
  let soundEnabled = true;
  let scannerActive = false;
  let scannerUnavailable = false;
  let scanProcessing = false;
  let lastScan = { payload: '', at: 0 };

  const setError = (message = '') => {
    if (!errorMessage) return;
    errorMessage.textContent = message;
    errorMessage.hidden = !message;
  };

  const updateUndoButton = () => {
    if (undoButton) undoButton.disabled = !undoCandidate;
  };

  const setQrFeedback = (message = '', type = '') => {
    if (!qrFeedback) return;
    qrFeedback.classList.remove('message-success', 'message-warning', 'message-error');
    if (type) qrFeedback.classList.add(`message-${type}`);
    qrFeedback.textContent = message;
    qrFeedback.hidden = !message;
  };

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

  const playScanSound = async (type) => {
    if (!soundEnabled) return;
    try {
      const context = await prepareAudio();
      if (!context) return;
      const sounds = {
        success: [
          { frequency: 660, offset: 0, duration: 0.07 },
          { frequency: 880, offset: 0.08, duration: 0.08 },
        ],
        duplicate: [{ frequency: 480, offset: 0, duration: 0.1 }],
        error: [{ frequency: 240, offset: 0, duration: 0.14 }],
      };
      const startTime = context.currentTime;
      sounds[type].forEach(({ frequency, offset, duration }) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const toneStart = startTime + offset;
        oscillator.type = type === 'duplicate' ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, toneStart);
        gain.gain.setValueAtTime(0.0001, toneStart);
        gain.gain.exponentialRampToValueAtTime(0.045, toneStart + 0.01);
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

  const updateSoundButton = () => {
    if (!qrSoundButton) return;
    qrSoundButton.textContent = soundEnabled ? 'Son activé' : 'Son désactivé';
    qrSoundButton.setAttribute('aria-pressed', String(soundEnabled));
  };

  const updateQuickCount = (present, total) => {
    quickAttendance.querySelector('[data-present-count]').textContent = present;
    quickAttendance.querySelector('[data-total-count]').textContent = total;
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

  const stopScanner = () => {
    qrScanner?.stop();
    scannerActive = false;
    if (qrView) qrView.hidden = true;
    if (qrStopButton) qrStopButton.hidden = true;
    if (qrStartButton) {
      qrStartButton.hidden = false;
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
      scannerUnavailable = true;
      stopScanner();
      if (qrSoundButton) qrSoundButton.disabled = true;
      if (completeState) completeState.hidden = true;
      readonlyMessage?.removeAttribute('hidden');
      return false;
    }
    return true;
  };

  searchInput.addEventListener('input', filterQuickRows);

  quickAttendance.querySelectorAll('[data-quick-present-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      const row = form.closest('[data-quick-student]');
      button.disabled = true;
      setError();
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { accept: 'application/json' },
        });
        if (redirectOnUnauthorized(response)) return;
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'La présence n’a pas pu être mise à jour.');

        applyPresentResult(payload, row);
        await refreshQuickAttendance();
      } catch (error) {
        setError(error.message || 'La présence n’a pas pu être mise à jour. Réessayez.');
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
    scanProcessing = true;
    let scanSoundHandled = false;
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
        playScanSound('error');
        scanSoundHandled = true;
        await refreshQuickAttendance();
        return;
      }

      applyPresentResult(payload);
      setQrFeedback(payload.message, payload.changed ? 'success' : 'warning');
      playScanSound(payload.changed ? 'success' : 'duplicate');
      scanSoundHandled = true;
      await refreshQuickAttendance();
    } catch (_error) {
      setQrFeedback('Le QR n’a pas pu être traité. Réessayez.', 'error');
      if (!scanSoundHandled) playScanSound('error');
    } finally {
      scanProcessing = false;
    }
  };

  qrStartButton?.addEventListener('click', async () => {
    if (scannerUnavailable || scannerActive) return;
    qrStartButton.disabled = true;
    setQrFeedback('Activation de la caméra…', 'warning');

    try {
      await prepareAudio();
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera unsupported');
      }
      const { default: QrScanner } = await import('/vendor/qr-scanner/qr-scanner.min.js');
      if (!(await QrScanner.hasCamera())) {
        throw new Error('Camera not found');
      }
      if (!qrScanner) {
        qrScanner = new QrScanner(qrVideo, handleQrResult, {
          preferredCamera: 'environment',
          maxScansPerSecond: 8,
          returnDetailedScanResult: true,
        });
      }
      await qrScanner.start();
      scannerActive = true;
      qrView.hidden = false;
      qrStartButton.hidden = true;
      qrStopButton.hidden = false;
      setQrFeedback('Présentez un QR devant la caméra.', 'success');
    } catch (error) {
      const reason = `${error?.name || ''} ${error?.message || error}`;
      if (/NotAllowed|Permission|denied/i.test(reason)) {
        scannerUnavailable = true;
        stopScanner();
        setQrFeedback('Accès à la caméra refusé. Utilisez la recherche manuelle.', 'error');
      } else if (/not found|NotFound|DevicesNotFound/i.test(reason)) {
        scannerUnavailable = true;
        stopScanner();
        setQrFeedback('Aucune caméra disponible. Utilisez la recherche manuelle.', 'error');
      } else if (/unsupported/i.test(reason)) {
        scannerUnavailable = true;
        stopScanner();
        setQrFeedback('Scanner indisponible sur ce navigateur. Utilisez la recherche manuelle.', 'error');
      } else {
        scannerUnavailable = false;
        stopScanner();
        setQrFeedback('Le scanner n’a pas pu démarrer. Réessayez ou utilisez la recherche manuelle.', 'error');
      }
    }
  });

  qrStopButton?.addEventListener('click', () => {
    stopScanner();
    setQrFeedback();
  });

  qrSoundButton?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    updateSoundButton();
    if (soundEnabled) prepareAudio();
  });

  window.addEventListener('pagehide', () => qrScanner?.stop());

  filterQuickRows();
  startPolling(refreshQuickAttendance);
}
