window.AttendanceLogI18n.ready.then(() => {
const recoveryKeyDialog = document.querySelector('[data-recovery-key-dialog]');
const recoveryKeyValue = document.querySelector('[data-recovery-key-value]');
const copyFeedback = document.querySelector('[data-copy-feedback]');
const securityFeedback = document.querySelector('[data-security-client-feedback]');
const t = (key, params) => window.AttendanceLogI18n.t(key, params);

const clearRecoveryKey = () => {
  recoveryKeyValue.value = '';
  copyFeedback.textContent = '';
};

document.querySelector('[data-show-recovery-key]')?.addEventListener('click', async () => {
  try {
    securityFeedback.hidden = true;
    securityFeedback.textContent = '';
    const response = await fetch('/settings/security/key', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 401) {
      window.location.assign('/login');
      return;
    }
    if (!response.ok) throw new Error('KEY_UNAVAILABLE');
    const result = await response.json();
    recoveryKeyValue.value = result.key;
    copyFeedback.textContent = '';
    recoveryKeyDialog.showModal();
  } catch (_error) {
    securityFeedback.textContent = t('security.dialog.unavailable');
    securityFeedback.hidden = false;
  }
});

document.querySelector('[data-copy-recovery-key]')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(recoveryKeyValue.value);
    copyFeedback.textContent = t('security.dialog.copied');
  } catch (_error) {
    recoveryKeyValue.focus();
    recoveryKeyValue.select();
    copyFeedback.textContent = t('security.dialog.copy_manual');
  }
});

document.querySelector('[data-close-recovery-key]')?.addEventListener('click', () => {
  clearRecoveryKey();
  recoveryKeyDialog.close();
});

recoveryKeyDialog?.addEventListener('close', clearRecoveryKey);
window.addEventListener('pagehide', clearRecoveryKey);
}).catch(() => {});
