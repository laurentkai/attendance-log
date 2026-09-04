(() => {
  const form = document.querySelector('[data-otp-resend-form]');
  if (!form) return;

  const button = form.querySelector('[data-otp-resend-button]');
  const label = form.querySelector('[data-otp-resend-label]');
  const status = form.querySelector('[data-otp-resend-status]');
  if (!button || !label || !status) return;

  const retryAfterSeconds = Math.max(0, Number.parseInt(form.dataset.retryAfterSeconds || '0', 10) || 0);
  let deadline = Date.now() + (retryAfterSeconds * 1000);
  let timer = null;
  let wasCoolingDown = retryAfterSeconds > 0;
  let submitting = false;

  function formatRemaining(seconds) {
    const minutesPart = String(Math.floor(seconds / 60)).padStart(2, '0');
    const secondsPart = String(seconds % 60).padStart(2, '0');
    return `${minutesPart}:${secondsPart}`;
  }

  function clearTimer() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  }

  function update() {
    clearTimer();
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remaining === 0) {
      button.disabled = submitting;
      label.textContent = submitting ? 'Envoi…' : 'Renvoyer un code';
      if (wasCoolingDown && !submitting) status.textContent = 'Vous pouvez maintenant renvoyer un code.';
      wasCoolingDown = false;
      return;
    }

    button.disabled = true;
    label.textContent = `Renvoyer un code dans ${formatRemaining(remaining)}`;
    timer = window.setTimeout(update, 250);
  }

  form.addEventListener('submit', (event) => {
    if (button.disabled || submitting) {
      event.preventDefault();
      return;
    }
    submitting = true;
    button.disabled = true;
    label.textContent = 'Envoi…';
  });

  window.addEventListener('pagehide', clearTimer);
  window.addEventListener('pageshow', update);
  update();
})();
