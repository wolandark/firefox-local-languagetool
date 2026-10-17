const LT = (globalThis.LT ??= {});

LT.applyReplacement = function (s, match, value) {
  const el = s.el;
  const start = match.offset;
  const end = match.offset + match.length;

  const expected = (s.lastChecked ?? '').slice(start, end);
  const stale = () => { LT.afterEdit?.(s); return false; };

  if (s.kind === 'field') {
    if (el.value.slice(start, end) !== expected) return stale();

    s.splice = { start, end, value };
    el.focus();
    el.setSelectionRange(start, end);
    let ok = false;
    try {
      ok = document.execCommand(value === '' ? 'delete' : 'insertText', false, value);
    } catch {  }
    if (!ok) {

      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const next = el.value.slice(0, start) + value + el.value.slice(end);
      if (setter) setter.call(el, next); else el.value = next;
      el.setSelectionRange(start + value.length, start + value.length);
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, inputType: 'insertText', data: value,
      }));
    }

    LT.afterEdit?.(s);
    return true;
  }

  const map = LT.ceBuildMap(el);
  if (map.text.slice(start, end) !== expected) return stale();
  const range = LT.ceRangeFor(map, start, end);
  if (!range) return false;
  const rootNode = el.getRootNode();
  const sel = rootNode instanceof ShadowRoot && rootNode.getSelection
    ? rootNode.getSelection()
    : window.getSelection();
  if (!sel) return false;
  el.focus();
  sel.removeAllRanges();
  sel.addRange(range);

  document.dispatchEvent(new Event('selectionchange'));

  s.splice = { start, end, value };

  const staticRange = new StaticRange({
    startContainer: range.startContainer,
    startOffset: range.startOffset,
    endContainer: range.endContainer,
    endOffset: range.endOffset,
  });
  const announce = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: value === '' ? 'deleteContentBackward' : 'insertText',
    data: value === '' ? null : value,
  });
  Object.defineProperty(announce, 'getTargetRanges', { value: () => [staticRange] });
  if (!el.dispatchEvent(announce)) {

    LT.afterEdit?.(s);
    return true;
  }

  let ok = false;
  try {
    ok = document.execCommand(value === '' ? 'delete' : 'insertText', false, value);
  } catch {  }
  if (!ok) {
    
    range.deleteContents();
    if (value) range.insertNode(document.createTextNode(value));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, composed: true, inputType: 'insertText', data: value,
    }));
  }
  LT.afterEdit?.(s);
  return true;
};
