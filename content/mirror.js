const LT = (globalThis.LT ??= {});

(() => {
  const PROPS = [
    'direction', 'font-family', 'font-feature-settings', 'font-kerning',
    'font-size', 'font-stretch', 'font-style', 'font-variant', 'font-weight',
    'letter-spacing', 'line-height', 'tab-size', 'text-align', 'text-indent',
    'text-transform', 'word-break', 'word-spacing',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  ];

  let mirror = null;

  function ensureMirror() {
    if (!mirror || !mirror.isConnected) {
      mirror = document.createElement('div');
      mirror.className = 'lt-ext-mirror';
      mirror.setAttribute('aria-hidden', 'true');
      LT.root().appendChild(mirror);
    }
    return mirror;
  }

  LT.measureMatches = function (el, text, matches) {
    const m = ensureMirror();
    const cs = getComputedStyle(el);

    let css = '';
    for (const p of PROPS) css += p + ':' + cs.getPropertyValue(p) + ';';
    const isTA = el.tagName === 'TEXTAREA';
    const wraps = isTA && el.wrap !== 'off';
    css += 'white-space:' + (wraps ? 'pre-wrap' : 'pre') + ';';
    css += 'overflow-wrap:' + (wraps ? 'break-word' : 'normal') + ';';

    css += 'box-sizing:border-box;border:0;margin:0;width:' + el.clientWidth + 'px;';
    m.style.cssText = css;

    const spans = new Array(matches.length).fill(null);
    const order = matches.map((_, i) => i).sort((a, b) => matches[a].offset - matches[b].offset);
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const i of order) {
      const mm = matches[i];
      const end = mm.offset + mm.length;
      if (mm.offset < last || end > text.length) continue;
      if (mm.offset > last) frag.appendChild(document.createTextNode(text.slice(last, mm.offset)));
      const sp = document.createElement('span');
      sp.textContent = text.slice(mm.offset, end);
      spans[i] = sp;
      frag.appendChild(sp);
      last = end;
    }
    frag.appendChild(document.createTextNode(text.slice(last)));
    m.textContent = '';
    m.appendChild(frag);

    const base = m.getBoundingClientRect();

    let dy = 0;
    if (!isTA) {
      const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      dy = Math.max(0, (el.clientHeight - padV - (base.height - padV)) / 2);
    }

    const out = matches.map(() => []);
    spans.forEach((sp, i) => {
      if (!sp) return;
      for (const r of sp.getClientRects()) {
        out[i].push({
          left: r.left - base.left,
          top: r.top - base.top + dy,
          width: r.width,
          height: r.height,
        });
      }
    });
    m.textContent = '';
    return out;
  };
})();
