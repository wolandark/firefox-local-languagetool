'use strict';

(() => {
  
  const ext = globalThis.browser ?? globalThis.chrome;
  const LT = (globalThis.LT ??= {});
  if (LT.booted) return;
  LT.booted = true;

  const pending = (LT.pending = new Set());

  const maybeEditable = (t) =>
    t instanceof Element &&
    (t instanceof HTMLTextAreaElement ||
      t instanceof HTMLInputElement ||
      t.isContentEditable ||
      t.getAttribute('contenteditable') === 'plaintext-only');

  let loading = false;
  function note(t) {
    if (!maybeEditable(t) || t.closest('#lt-ext-root')) return;
    pending.add(t);
    if (loading) return;
    loading = true;
    try {
      import(ext.runtime.getURL('content/index.js')).catch(giveUpOrRetry);
    } catch {
      giveUpOrRetry();
    }
  }

  function giveUpOrRetry() {
    let alive = false;
    try { alive = !!ext.runtime?.id; } catch {  }
    if (alive) loading = false; else LT.bootDone();
  }

  const onEvent = (e) => note(e.composedPath ? e.composedPath()[0] : e.target);

  LT.bootDone = () => {
    document.removeEventListener('focusin', onEvent, true);
    document.removeEventListener('input', onEvent, true);
  };

  document.addEventListener('focusin', onEvent, true);
  document.addEventListener('input', onEvent, true);

  let ae = document.activeElement;
  while (ae?.shadowRoot?.activeElement) ae = ae.shadowRoot.activeElement;
  if (ae && ae !== document.body) note(ae);
})();
