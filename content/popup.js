const LT = (globalThis.LT ??= {});

(() => {
  let active = null; 

  LT.closePopup = function () {
    if (!active) return;
    for (const fn of active.cleanup) fn();
    active.root.remove();
    active = null;
  };

  function div(className, text) {
    const d = document.createElement('div');
    d.className = className;
    if (text != null) d.textContent = text;
    return d;
  }

  function button(className, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  const WS_NAMES = {
    ' ': 'Single space',
    '  ': 'Two spaces',
    '\n': 'Line break',
    '\t': 'Tab',
    '\u00a0': 'Non-breaking space',
  };

  function describeReplacement(value) {
    if (value === '') return { label: 'Remove', ws: true };
    if (!/\S/.test(value)) {
      if (WS_NAMES[value]) return { label: WS_NAMES[value], ws: true };
      const viz = value.replace(/ /g, '·').replace(/\t/g, '⇥').replace(/\n/g, '¶');
      return { label: viz + ' (whitespace)', ws: true };
    }
    return { label: value, ws: false };
  }

  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  LT.showPopup = function (s, match, at) {
    LT.closePopup();

    const root = div('lt-ext-popup');

    if (match.shortMessage && match.shortMessage !== match.message) {
      root.appendChild(div('lt-ext-pop-short', match.shortMessage));
    }

    const meta = div('lt-ext-pop-rule');
    const dot = div('lt-ext-dot lt-sev-' + LT.severity(match));
    
    if (match.rule?.issueType) dot.title = match.rule.issueType;
    meta.appendChild(dot);
    const cat = match.rule?.category?.name || '';
    const desc = match.rule?.description || '';
    const metaText = div('lt-ext-pop-rule-text', cat && desc ? cat + ' · ' + desc : (desc || cat || 'Unknown rule'));
    if (match.rule?.id) {
      metaText.title = match.rule.id + (match.rule.subId ? '[' + match.rule.subId + ']' : '');
    }
    meta.appendChild(metaText);
    const url = match.rule?.urls?.[0]?.value;
    if (url && /^https?:/i.test(url)) {
      const a = document.createElement('a');
      a.className = 'lt-ext-pop-link';
      a.textContent = '↗';
      a.title = 'About this rule';
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      meta.appendChild(a);
    }
    root.appendChild(meta);

    async function persist(area, items) {
      if (await LT.save(area, items)) { LT.closePopup(); return true; }
      if (active?.root !== root) return false;
      let note = root.querySelector('.lt-ext-pop-error');
      if (!note) {
        note = div('lt-ext-pop-error');
        root.appendChild(note);
      }
      note.textContent = LT.saveError || 'Could not save';
      return false;
    }

    const actions = div('lt-ext-pop-actions');
    
    const word = (s.lastChecked || '').slice(match.offset, match.offset + match.length);
    if (word.trim()) {
      const lc = word.toLowerCase();
      if (LT.settings.ignoredWords.some(w => w.toLowerCase() === lc)) {
        actions.appendChild(div('lt-ext-pop-note', 'Word ignored'));
      } else {

        const b = button('lt-ext-pop-act', 'Ignore', () => {
          persist('sync', { ignoredWords: [...LT.settings.ignoredWords, word] });
        });
        b.title = 'Never flag ‘' + trunc(word, 40) + '’ again';
        actions.appendChild(b);
      }
    }
    const ruleId = match.rule?.id;
    if (ruleId) {
      if (LT.settings.disabledRules.includes(ruleId)) {
        actions.appendChild(div('lt-ext-pop-note', 'Rule disabled'));
      } else {
        const b = button('lt-ext-pop-act', 'Disable Rule', () => {
          persist('sync', { disabledRules: [...LT.settings.disabledRules, ruleId] });
        });
        b.title = ruleId;
        actions.appendChild(b);
      }
    }

    const off = button('lt-ext-pop-act', 'Disable Here', () => {
      const host = LT.siteHost;
      const fields = LT.settings.disabledFields;
      const key = LT.fieldKey(s.el);
      const list = fields[host] || [];
      if (list.includes(key)) { LT.closePopup(); return; }
      persist('local', { disabledFields: { ...fields, [host]: [...list, key] } });
    });
    off.title = 'Stop checking this field on ' + LT.siteHost;
    actions.appendChild(off);
    if (actions.childNodes.length) root.appendChild(actions);

    root.appendChild(div('lt-ext-pop-msg', match.message || 'Possible issue'));

    let primary = null; 
    let sugRow = null;
    if (match.replacements?.length) {
      const list = sugRow = div('lt-ext-pop-sug');
      for (const rep of match.replacements.slice(0, 2)) {
        const value = rep.value ?? '';
        const d = describeReplacement(value);
        const b = button('lt-ext-pop-item' + (d.ws ? ' lt-ext-ws' : ''), d.label, () => {
          LT.closePopup();
          LT.applyReplacement(s, match, value);
        });
        b.title = rep.shortDescription || d.label;

        if (!primary) {
          primary = b;
          const pair = autoPair(b, word, value);
          list.appendChild(pair || b);
        } else {
          list.appendChild(b);
        }
      }
      root.appendChild(list);
    }

    const lang = s.language;
    if (lang?.code) {
      const el = div('lt-ext-pop-lang', lang.code);
      const detected = lang.detectedLanguage?.code;
      el.title = (lang.name || lang.code) +
        (detected && detected !== lang.code ? ' (detected ' + detected + ')' : '');
      (sugRow || root).appendChild(el);
    }

    function autoPair(main, from, value) {
      if (!ruleId || !from) return null;
      const entry = { rule: ruleId, sub: match.rule?.subId || '', from, to: value };
      const key = LT.autoEntryKey(entry);
      const on = LT.settings.autoCorrections.some(e => LT.autoEntryKey(e) === key);
      const pair = div('lt-ext-pop-pair');
      main.classList.add('lt-ext-pop-pair-main');
      pair.appendChild(main);
      const auto = button('lt-ext-pop-auto', '🪄', async () => {

        if (await persist('sync', { autoCorrections: [...LT.settings.autoCorrections, entry] })) {
          LT.applyReplacement(s, match, value);
        }
      });
      
      if (on) {
        auto.disabled = true;
        auto.classList.add('lt-ext-on');
        auto.title = 'Already corrected automatically';
      } else {
        auto.title = 'Always fix ‘' + trunc(from, 30) + '’ → ‘' + trunc(value, 30) +
          '’ for this rule';
      }
      auto.setAttribute('aria-label', auto.title);
      pair.appendChild(auto);
      return pair;
    }

    root.addEventListener('pointerdown', (e) => e.preventDefault());

    root.style.visibility = 'hidden';
    LT.root().appendChild(root);
    const pw = root.offsetWidth;
    const ph = root.offsetHeight;

    const GAP = 12;
    let top = at.y - ph - GAP;
    if (top < 8) top = Math.min(at.y + GAP, window.innerHeight - ph - 8);
    top = Math.max(8, top);
    const anchorX = primary ? primary.offsetLeft + primary.offsetWidth / 2 : pw / 2;
    const left = Math.max(8, Math.min(at.x - anchorX, window.innerWidth - pw - 8));
    root.style.top = top + 'px';
    root.style.left = left + 'px';
    root.style.visibility = '';

    const onPointer = (e) => { if (!root.contains(e.target)) LT.closePopup(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); LT.closePopup(); }
    };

    let anchorRect = s.el.getBoundingClientRect();
    let popTop = top;
    let popLeft = left;
    let followRaf = 0;
    const follow = () => {
      if (followRaf) return;
      followRaf = requestAnimationFrame(() => {
        followRaf = 0;
        if (active?.root !== root) return;
        const r = s.el.getBoundingClientRect();
        const dx = r.left - anchorRect.left;
        const dy = r.top - anchorRect.top;
        anchorRect = r;
        if (!dx && !dy) return;
        popTop = Math.max(8, Math.min(popTop + dy, window.innerHeight - root.offsetHeight - 8));
        popLeft = Math.max(8, Math.min(popLeft + dx, window.innerWidth - root.offsetWidth - 8));
        root.style.top = popTop + 'px';
        root.style.left = popLeft + 'px';
      });
    };
    const onScroll = (e) => { if (!root.contains(e.target)) follow(); };
    const onFocus = (e) => { if (!root.contains(e.target) && e.target !== s.el) LT.closePopup(); };

    active = {
      root,
      cleanup: [() => {
        document.removeEventListener('pointerdown', onPointer, true);
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('scroll', onScroll, { capture: true });
        document.removeEventListener('focusin', onFocus, true);
        if (followRaf) cancelAnimationFrame(followRaf);
      }],
    };

    setTimeout(() => {
      if (active?.root !== root) return;
      document.addEventListener('pointerdown', onPointer, true);
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('scroll', onScroll, { capture: true, passive: true });
      document.addEventListener('focusin', onFocus, true);
    }, 0);
  };
})();
