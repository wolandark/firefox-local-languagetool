const LT = (globalThis.LT ??= {});

const ext = globalThis.browser ?? globalThis.chrome;

await LT.settingsReady;

(() => {
  if (LT.started) return;
  LT.started = true;

  const FIELD_TYPES = new Set(['', 'text', 'search']);
  const DEBOUNCE_MS = 500;   
  const BOUNDARY_MS = 150;   
  const FIRST_CHECK_MS = 100; 
  const SETTLE_MS = 900;     
  const FOCUS_CHECK_MS = 250;
  const MAX_LIVE = 8;     
  const MAX_TEXT = 20000; 
  const BOUNDARY_SCAN = 500;  
  const FRAGMENT_GUARD = 200; 
  const REANCHOR_MS = 800;    

  const states = new Map(); 
  let contextDead = false;

  const SENSITIVE_AUTOCOMPLETE = /^(?:one-time-code|current-password|new-password|cc-(?:number|csc|exp|exp-month|exp-year|name|type)|username|email|tel|tel-.+|impp|url)$/;
  const SENSITIVE_HINT = /(?:^|[^a-z])(?:pass(?:word|wd|phrase)?|pwd|otp|totp|mfa|2fa|token|secret|api[-_ ]?key|cvv|cvc|csc|iban|swift|ssn|pin|routing|verification|security[-_ ]?code|card[-_ ]?number|credit[-_ ]?card|account[-_ ]?number)(?:$|[^a-z])/i;
  const NUMERIC_MODES = new Set(['numeric', 'tel', 'decimal']);

  function sensitiveField(el) {
    const ac = el.getAttribute('autocomplete');
    if (ac && ac.toLowerCase().split(/\s+/).some(t => SENSITIVE_AUTOCOMPLETE.test(t))) return true;
    if (NUMERIC_MODES.has((el.getAttribute('inputmode') || '').toLowerCase())) return true;

    if (el.maxLength > 0 && el.maxLength <= 8) return true;
    const hint = [el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label')]
      .filter(Boolean).join(' ');
    return !!hint && SENSITIVE_HINT.test(hint);
  }

  const GENERATED_ID = /^:r|\d{4,}|[0-9a-f]{8}/i;

  LT.fieldKey = function (el) {
    const id = el.getAttribute('id');
    if (id && !GENERATED_ID.test(id)) return el.localName + '#' + id;
    const name = el.getAttribute('name');
    if (name) return el.localName + '[name=' + name + ']';
    const label = el.getAttribute('aria-label');
    if (label) return el.localName + '[aria=' + label.slice(0, 40) + ']';
    const path = [];
    for (let n = el; n && n.nodeType === Node.ELEMENT_NODE && path.length < 5; n = n.parentElement) {
      let i = 1;
      for (let p = n.previousElementSibling; p; p = p.previousElementSibling) {
        if (p.localName === n.localName) i++;
      }
      path.unshift(n.localName + ':' + i);
    }
    return path.join('>');
  };

  function fieldDisabled(el) {
    const keys = LT.settings.disabledFields[LT.siteHost];
    
    return !!keys?.length && keys.includes(LT.fieldKey(el));
  }

  function editableRoot(t) {
    if (contextDead || LT.siteDisabled()) return null;
    if (!(t instanceof Element) || t.closest('#lt-ext-root')) return null;
    if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) {
      if (t instanceof HTMLInputElement &&
          !FIELD_TYPES.has((t.getAttribute('type') || '').toLowerCase())) return null;

      if (t.readOnly || t.disabled || sensitiveField(t)) return null;
      return fieldDisabled(t) ? null : t;
    }
    if (t.isContentEditable || t.getAttribute?.('contenteditable') === 'plaintext-only') {
      let el = t;
      while (el.parentElement?.isContentEditable) el = el.parentElement;
      return fieldDisabled(el) ? null : el;
    }
    return null;
  }

  function attach(el) {
    let s = states.get(el);
    if (s) {
      states.delete(el); 
      states.set(el, s);
      return s;
    }
    const kind = (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) ? 'field' : 'ce';
    if (kind === 'ce' && !LT.ceSupported) return null;

    s = {
      el, kind,
      raw: [],        
      matches: [],    
      rects: [],      
      ceRanges: [],   
      map: null,      
      seq: 0, timer: 0, retryMs: 0, lastChecked: null,
      language: null, 
      raf: 0, ro: null,
      typing: false, settle: 0, 
      splice: null,   
      recheck: false, 
      mo: null, moTimer: 0, 
      clipboard: 0,   
      autoTimer: 0, autoRuns: 0, 
    };

    if (kind === 'field') {
      LT.fieldOverlay.create(s);
      s.ro = new ResizeObserver(() => refreshFieldSoon(s));
      s.ro.observe(el);
    } else {
      LT.adoptHighlightStyles(el.getRootNode());
    }

    states.set(el, s);
    while (states.size > MAX_LIVE) dispose(states.values().next().value);
    return s;
  }

  function dispose(s) {
    states.delete(s.el);
    clearTimeout(s.timer);
    clearTimeout(s.clipboard);
    clearTimeout(s.settle);
    clearTimeout(s.autoTimer);
    s.seq++; 
    s.ro?.disconnect();
    stopWatching(s);
    if (s.raf) cancelAnimationFrame(s.raf);
    LT.fieldOverlay.remove(s);
    LT.ceClear(s);
  }

  function textOf(s) {
    if (s.kind === 'field') return { text: s.el.value, map: null };
    const map = LT.ceBuildMap(s.el);
    return { text: map.text, map };
  }

  function scheduleCheck(s, delay) {
    if (contextDead) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => runCheck(s), delay);
  }

  const WORD_CHAR = /[\p{L}\p{N}'’]/u;

  function typingDelay(s, e) {
    if (s.lastChecked == null) return FIRST_CHECK_MS;
    if (!e) return BOUNDARY_MS; 
    if (e.inputType?.startsWith('delete')) return DEBOUNCE_MS;
    const d = e.data;
    if (d == null) return BOUNDARY_MS; 
    return WORD_CHAR.test(d[d.length - 1]) ? DEBOUNCE_MS : BOUNDARY_MS;
  }

  function selectionFor(el) {
    const rootNode = el.getRootNode();
    return rootNode instanceof ShadowRoot && rootNode.getSelection
      ? rootNode.getSelection()
      : window.getSelection();
  }

  function caretOffset(s) {
    if (s.kind === 'field') {
      if (s.el.selectionStart == null || s.el.selectionStart !== s.el.selectionEnd) return -1;
      return s.el.selectionStart;
    }
    const sel = selectionFor(s.el);
    if (!sel?.isCollapsed || !sel.anchorNode || !s.el.contains(sel.anchorNode)) return -1;
    return LT.cePos(s.map || LT.ceBuildMap(s.el), sel.anchorNode, sel.anchorOffset);
  }

  function caretWord(s, text) {
    const pos = caretOffset(s);
    if (pos < 0 || pos > text.length) return null;
    let a = pos, b = pos;
    while (a > 0 && WORD_CHAR.test(text[a - 1])) a--;
    while (b < text.length && WORD_CHAR.test(text[b])) b++;
    return a === b ? null : [a, b];
  }

  function reanchor(s, { start, end, value }) {
    if (s.lastChecked == null) return false;
    const next = s.lastChecked.slice(0, start) + value + s.lastChecked.slice(end);
    if (s.kind === 'ce') LT.ceInvalidateMap();
    const { text, map } = textOf(s);
    if (text !== next) return false;
    const delta = value.length - (end - start);
    s.lastChecked = next;
    s.map = map;
    s.raw = s.raw.flatMap(m =>
      m.offset + m.length <= start ? [m] :
      m.offset >= end ? [{ ...m, offset: m.offset + delta }] :
      []); 

    s.recheck = true;
    applyMatches(s);
    return true;
  }

  function stopWatching(s) {
    s.mo?.disconnect();
    s.mo = null;
    clearTimeout(s.moTimer);
    s.moTimer = 0;
  }

  function watchForSplice(s, splice) {
    stopWatching(s);
    const from = s.lastChecked;
    const attempt = () => {
      
      if (s.lastChecked !== from || !s.el.isConnected || reanchor(s, splice)) stopWatching(s);
    };
    s.mo = new MutationObserver(attempt);
    s.mo.observe(s.el, { subtree: true, childList: true, characterData: true });

    s.moTimer = setTimeout(() => stopWatching(s), REANCHOR_MS);
  }

  function onInput(s, e) {
    LT.closePopup();

    clearTimeout(s.clipboard);
    s.clipboard = 0;
    const splice = s.splice;
    s.splice = null;

    if (e && !splice) s.autoRuns = 0;
    let kept = false;
    if (splice) {
      kept = reanchor(s, splice);
      if (!kept && s.kind === 'ce') watchForSplice(s, splice);
    }

    if (!kept && s.kind === 'field' && s.el.value !== s.lastChecked) {
      LT.fieldOverlay.clear(s);
    }

    if (e?.isComposing) {
      clearTimeout(s.timer);
      return;
    }

    s.typing = true;
    clearTimeout(s.settle);
    s.settle = setTimeout(() => {
      s.settle = 0;
      s.typing = false;
      if (s.lastChecked != null) applyMatches(s);
    }, SETTLE_MS);
    scheduleCheck(s, typingDelay(s, e));
  }

  function tailWindow(text) {
    if (text.length <= MAX_TEXT) return { slice: text, shift: 0, guard: 0 };
    const cut = text.length - MAX_TEXT;
    const probe = text.slice(cut, cut + BOUNDARY_SCAN);

    let rel = -1;
    const para = probe.indexOf('\n\n');
    const line = probe.indexOf('\n');
    if (para >= 0) rel = para + 2;
    else if (line >= 0) rel = line + 1;
    else {
      const sentence = /[.!?]["'”’)\]]?\s+/.exec(probe);
      if (sentence) rel = sentence.index + sentence[0].length;
    }
    if (rel >= 0) return { slice: text.slice(cut + rel), shift: cut + rel, guard: 0 };

    const ws = /\s/.exec(probe);
    const at = cut + (ws ? ws.index + 1 : 0);
    return { slice: text.slice(at), shift: at, guard: FRAGMENT_GUARD };
  }

  function orphaned(err) {
    let alive = false;
    try { alive = !!ext.runtime?.id; } catch {  }
    if (alive && !/context invalidated/i.test(err?.message || '')) return false;
    contextDead = true;
    LT.closePopup();
    for (const s of [...states.values()]) dispose(s);
    return true;
  }

  async function runCheck(s) {
    if (contextDead) return;
    if (!s.el.isConnected) { dispose(s); return; }
    const { text, map } = textOf(s);
    if (text === s.lastChecked && !s.recheck) {

      s.map = map;
      applyMatches(s);
      return;
    }
    s.recheck = false;

    const seq = ++s.seq;
    if (!text.trim()) {
      s.lastChecked = text;
      s.map = map;
      s.raw = [];
      applyMatches(s);
      return;
    }

    const win = tailWindow(text);
    let resp;
    try {
      resp = await LT.checkText(win.slice);
    } catch (err) {
      if (seq !== s.seq) return;
      if (orphaned(err)) return;

      s.lastChecked = null;
      s.language = null;
      s.raw = [];
      applyMatches(s);
      s.retryMs = Math.min((s.retryMs || 1000) * 2, 16000);

      if (!document.hidden) scheduleCheck(s, s.retryMs);
      return;
    }
    if (seq !== s.seq) return;
    s.retryMs = 0;

    s.lastChecked = text;
    s.language = resp.language || null;
    s.map = map;
    s.raw = (resp.matches || [])
      .filter(m => m.offset >= win.guard)
      .map(m => (win.shift ? { ...m, offset: m.offset + win.shift } : m));
    applyMatches(s);
  }

  const letters = (str) => [...str
    .normalize('NFD')
    .replace(/[nN]\u0303/g, m => m.normalize('NFC'))
    .matchAll(/(\P{Diacritic})(\p{Diacritic}*)/gu)]
    .map(([, base, marks]) => [base, marks]);

  function droppedAccents(found, value) {
    const a = letters(found);
    const b = letters(value);
    if (a.length !== b.length) return false;
    return a.every(([base, marks], i) =>
      base === b[i][0] && (marks === '' || marks === b[i][1]));
  }

  function accentOnly(m, found) {
    return (m.replacements || []).some(r => r.value != null && droppedAccents(found, r.value));
  }

  function applyMatches(s) {
    const text = s.lastChecked ?? '';
    const disabled = new Set(LT.settings.disabledRules);
    const ignored = new Set(LT.settings.ignoredWords.map(w => w.toLowerCase()));
    const skipAccents = LT.settings.ignoreAccents;
    s.matches = s.raw.filter(m => {
      if (m.offset < 0 || m.offset + m.length > text.length) return false;
      if (m.rule && disabled.has(m.rule.id)) return false;
      const found = text.slice(m.offset, m.offset + m.length);
      if (ignored.has(found.toLowerCase())) return false;
      return !(skipAccents && accentOnly(m, found));
    });
    const word = s.typing ? caretWord(s, text) : null;
    if (word) {
      s.matches = s.matches.filter(m => m.offset >= word[1] || m.offset + m.length <= word[0]);
    }
    render(s);
    autoCorrectSoon(s);
  }

  const MAX_AUTO_RUNS = 8; 

  function caretOutside(s, from, to) {
    if (s.kind === 'field') {
      if (document.activeElement !== s.el || s.el.selectionStart == null) return null;
      const { selectionStart: start, selectionEnd: end } = s.el;
      if (start < to && end > from) return null;
      return { start, end, dir: s.el.selectionDirection };
    }
    const pos = caretOffset(s);
    if (pos < 0 || (pos > from && pos < to)) return null;
    return { start: pos, end: pos, dir: null };
  }

  function restoreCaret(s, sel, delta) {
    const start = sel.start + delta;
    const end = sel.end + delta;
    if (s.kind === 'field') {
      try {
        s.el.setSelectionRange(start, end, sel.dir || undefined);
      } catch {  }
      return;
    }

    LT.ceInvalidateMap();
    const map = LT.ceBuildMap(s.el);
    const range = start <= map.text.length && end <= map.text.length
      ? LT.ceRangeFor(map, start, end) : null;
    const selection = range && selectionFor(s.el);
    if (!selection) return;
    s.map = map;
    selection.removeAllRanges();
    selection.addRange(range);

    document.dispatchEvent(new Event('selectionchange'));
  }

  function autoCorrectSoon(s, retry = true) {
    if (s.autoTimer || !LT.settings.autoCorrections.length) return;
    if (s.autoRuns >= MAX_AUTO_RUNS) return;
    const text = s.lastChecked ?? '';
    const match = s.matches.find(m => LT.autoReplacement(m, text) != null);
    if (!match) return;
    s.autoTimer = setTimeout(() => {
      s.autoTimer = 0;
      if (!s.el.isConnected) return;

      if (s.lastChecked !== text || !s.matches.includes(match)) {
        if (retry) autoCorrectSoon(s, false);
        return;
      }
      const value = LT.autoReplacement(match, text);
      if (value == null) return;

      s.autoRuns++;

      const end = match.offset + match.length;
      const sel = caretOutside(s, match.offset, end);

      if (!LT.applyReplacement(s, match, value) || !sel) return;
      restoreCaret(s, sel, sel.start >= end ? value.length - match.length : 0);
    }, 0);
  }

  function render(s) {
    if (s.kind === 'field') {
      LT.fieldOverlay.render(s, s.lastChecked ?? '');
    } else {

      const map = LT.ceBuildMap(s.el);
      if (s.lastChecked != null && map.text !== s.lastChecked) {

        scheduleCheck(s, DEBOUNCE_MS);
        return;
      }
      s.map = map;
      const items = [];
      for (const m of s.matches) {
        const range = LT.ceRangeFor(map, m.offset, m.offset + m.length);
        if (range) items.push({ range, sev: LT.severity(m) });
      }
      LT.ceApply(s, items);
    }
  }

  function refreshFieldSoon(s) {
    if (s.raf) return;
    s.raf = requestAnimationFrame(() => {
      s.raf = 0;
      if (!s.el.isConnected) { dispose(s); return; }
      LT.fieldOverlay.render(s, s.lastChecked ?? '');
    });
  }

  let repositionRaf = 0;
  function repositionAll() {
    if (repositionRaf) return;
    repositionRaf = requestAnimationFrame(() => {
      repositionRaf = 0;
      const dead = [];
      for (const s of states.values()) {
        if (!s.el.isConnected) { dead.push(s); continue; }
        if (s.kind === 'field') {
          LT.fieldOverlay.position(s);

          LT.fieldOverlay.syncScroll(s);
        }
      }
      dead.forEach(dispose);
    });
  }

  function onClick(s, e) {
    if (s.lastChecked == null || !s.matches.length) return;

    if (s.kind === 'field') {
      const el = s.el;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left - el.clientLeft + el.scrollLeft;
      const y = e.clientY - r.top - el.clientTop + el.scrollTop;
      for (let i = 0; i < s.matches.length; i++) {
        for (const seg of s.rects[i] || []) {
          if (x >= seg.left - 2 && x <= seg.left + seg.width + 2 &&
              y >= seg.top - 2 && y <= seg.top + seg.height + 2) {
            LT.showPopup(s, s.matches[i], { x: e.clientX, y: e.clientY });
            return;
          }
        }
      }
      return;
    }

    const map = LT.ceBuildMap(s.el);
    if (map.text !== s.lastChecked) {

      scheduleCheck(s, FOCUS_CHECK_MS);
      return;
    }
    const pos = LT.cePosFromPoint(s.el, map, e.clientX, e.clientY);
    if (pos < 0) return;
    const m = s.matches.find(mm => pos >= mm.offset && pos <= mm.offset + mm.length);
    if (!m) return;
    LT.showPopup(s, m, { x: e.clientX, y: e.clientY });
  }

  const pathTarget = (e) => (e.composedPath ? e.composedPath()[0] : e.target);

  function considerTarget(t) {
    const el = editableRoot(t);
    if (!el) return;
    const s = attach(el);

    if (s) scheduleCheck(s, s.lastChecked == null ? FIRST_CHECK_MS : FOCUS_CHECK_MS);
  }

  document.addEventListener('focusin', (e) => considerTarget(pathTarget(e)), true);

  document.addEventListener('input', (e) => {
    const el = editableRoot(pathTarget(e));
    if (!el) return;
    const s = attach(el);
    if (s) onInput(s, e);
  }, true);

  document.addEventListener('scroll', () => {
    if (states.size) repositionAll();
  }, { capture: true, passive: true });

  function revalidate(s) {
    if (s.lastChecked == null || !s.el.isConnected) return;
    const now = s.kind === 'field' ? s.el.value : LT.ceBuildMap(s.el).text;
    if (now !== s.lastChecked) onInput(s);
  }

  let revalidateTimer = 0;
  function revalidateSoon() {
    clearTimeout(revalidateTimer);
    revalidateTimer = setTimeout(() => {
      for (const s of states.values()) revalidate(s);
    }, FOCUS_CHECK_MS);
  }

  function onClipboardEdit(e) {
    const el = editableRoot(pathTarget(e));
    if (!el) return;
    const s = attach(el);
    if (!s || s.clipboard) return;
    s.clipboard = setTimeout(() => {
      s.clipboard = 0;

      if (s.lastChecked == null) scheduleCheck(s, DEBOUNCE_MS);
      else revalidate(s);
    }, FOCUS_CHECK_MS);
  }

  for (const type of ['paste', 'cut', 'drop']) {
    document.addEventListener(type, onClipboardEdit, true);
  }

  document.addEventListener('click', (e) => {
    if (!states.size) return;
    repositionAll();
    revalidateSoon();
    const el = editableRoot(pathTarget(e));
    const s = el && states.get(el);
    if (s) onClick(s, e);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !states.size) return;
    const el = editableRoot(pathTarget(e));
    const s = el && states.get(el);
    if (s) scheduleCheck(s, FOCUS_CHECK_MS);
  }, true);

  window.addEventListener('resize', () => {
    LT.closePopup();
    for (const s of states.values()) {
      if (s.kind === 'field') refreshFieldSoon(s);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    for (const s of states.values()) if (s.retryMs) scheduleCheck(s, 100);
  });

  LT.afterEdit = (s) => onInput(s);

  const RECHECK_KEYS = new Set(['serverUrl', 'language', 'preferredVariants', 'motherTongue', 'level']);

  LT.onSettingsChanged.push((keys) => {

    if (keys.some(k => k === 'enabled' || k === 'disabledSites' || k === 'disabledFields')) {
      LT.closePopup();
      for (const s of [...states.values()]) {
        if (editableRoot(s.el) !== s.el) dispose(s);
      }
    }
    if (keys.some(k => RECHECK_KEYS.has(k))) {
      for (const s of states.values()) {
        s.lastChecked = null;
        scheduleCheck(s, 100);
      }
    } else {
      for (const s of states.values()) applyMatches(s);
    }
  });

  for (const t of LT.pending || []) considerTarget(t);
  LT.pending = null;
  LT.bootDone?.();
})();
