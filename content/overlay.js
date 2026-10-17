const LT = (globalThis.LT ??= {});

const TRAPPED_EVENTS = [
  'pointerdown', 'pointerup', 'pointermove', 'pointercancel',
  'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout',
  'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel',
  'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'keydown', 'keyup', 'keypress', 'focusin', 'focusout',
];

LT.root = function () {
  let r = LT._root;
  if (!r || !r.isConnected) {
    r = LT._root = document.createElement('div');
    r.id = 'lt-ext-root';
    const stop = (e) => e.stopPropagation();
    for (const t of TRAPPED_EVENTS) r.addEventListener(t, stop, { passive: true });
    document.documentElement.appendChild(r);
  }
  return r;
};

LT.fieldOverlay = {
  create(s) {
    const box = document.createElement('div');
    box.className = 'lt-ext-box';
    const inner = document.createElement('div');
    inner.className = 'lt-ext-inner';
    box.appendChild(inner);
    LT.root().appendChild(box);
    s.box = box;
    s.inner = inner;
  },

  clear(s) {
    if (!s.inner) return;
    s.inner.textContent = '';
    s.rects = [];
  },

  render(s, text) {
    if (!s.box) return;
    if (!s.matches.length || !text) {
      this.clear(s);
      this.position(s);
      return;
    }
    s.rects = LT.measureMatches(s.el, text, s.matches);
    const frag = document.createDocumentFragment();
    s.matches.forEach((m, i) => {
      const sev = 'lt-sev-' + LT.severity(m);
      for (const r of s.rects[i]) {
        const seg = document.createElement('div');
        seg.className = 'lt-ext-seg ' + sev;
        seg.style.cssText =
          'left:' + r.left + 'px;top:' + r.top + 'px;' +
          'width:' + Math.max(r.width, 3) + 'px;height:' + r.height + 'px';
        frag.appendChild(seg);
      }
    });
    s.inner.textContent = '';
    s.inner.appendChild(frag);
    this.syncScroll(s);
    this.position(s);
  },

  syncScroll(s) {
    if (!s.inner) return;
    s.inner.style.transform = 'translate(' + -s.el.scrollLeft + 'px,' + -s.el.scrollTop + 'px)';
  },

  position(s) {
    if (!s.box) return;
    const el = s.el;
    const r = el.getBoundingClientRect();
    if (!el.isConnected || (r.width === 0 && r.height === 0)) {
      s.box.style.display = 'none';
      return;
    }
    s.box.style.display = '';
    s.box.style.left = (r.left + window.scrollX + el.clientLeft) + 'px';
    s.box.style.top = (r.top + window.scrollY + el.clientTop) + 'px';
    s.box.style.width = el.clientWidth + 'px';
    s.box.style.height = el.clientHeight + 'px';
  },

  remove(s) {
    s.box?.remove();
    s.box = s.inner = null;
  },
};
