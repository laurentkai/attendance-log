const recoveryKeyDialog = document.querySelector('[data-recovery-key-dialog]');
const recoveryKeyValue = document.querySelector('[data-recovery-key-value]');
const copyFeedback = document.querySelector('[data-copy-feedback]');
const securityFeedback = document.querySelector('[data-security-client-feedback]');

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
    securityFeedback.textContent = 'La clé ne peut pas être affichée pour le moment.';
    securityFeedback.hidden = false;
  }
});

document.querySelector('[data-copy-recovery-key]')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(recoveryKeyValue.value);
    copyFeedback.textContent = 'Clé copiée.';
  } catch (_error) {
    recoveryKeyValue.focus();
    recoveryKeyValue.select();
    copyFeedback.textContent = 'Copie automatique indisponible. Copiez la sélection manuellement.';
  }
});

document.querySelector('[data-close-recovery-key]')?.addEventListener('click', () => {
  clearRecoveryKey();
  recoveryKeyDialog.close();
});

recoveryKeyDialog?.addEventListener('close', clearRecoveryKey);
window.addEventListener('pagehide', clearRecoveryKey);
