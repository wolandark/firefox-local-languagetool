'use strict';

const ext = globalThis.browser ?? globalThis.chrome;

const SYNC_DEFAULTS = {
  serverUrl: 'http://127.0.0.1:8081',
  language: 'auto',
  preferredVariants: [],
  motherTongue: '',
  level: 'picky',
  ignoreAccents: false,
  enabled: true,
  disabledSites: [],
  disabledRules: [],
  ignoredWords: [],
  autoCorrections: [],
};

const LOCAL_DEFAULTS = {
  disabledFields: {},
};

const FALLBACK_LANGS = [
  { longCode: 'en', name: 'English' },
  { longCode: 'en-US', name: 'English (US)' },
  { longCode: 'en-GB', name: 'English (GB)' },
  { longCode: 'en-AU', name: 'English (Australian)' },
  { longCode: 'en-CA', name: 'English (Canadian)' },
  { longCode: 'en-NZ', name: 'English (New Zealand)' },
  { longCode: 'en-ZA', name: 'English (South African)' },
  { longCode: 'es', name: 'Spanish' },
  { longCode: 'de', name: 'German' },
  { longCode: 'de-DE', name: 'German' },
  { longCode: 'de-AT', name: 'German (Austria)' },
  { longCode: 'de-CH', name: 'German (Swiss)' },
  { longCode: 'fr', name: 'French' },
  { longCode: 'it', name: 'Italian' },
  { longCode: 'nl', name: 'Dutch' },
  { longCode: 'pt-BR', name: 'Portuguese (Brazil)' },
  { longCode: 'pt-PT', name: 'Portuguese (Portugal)' },
  { longCode: 'pl-PL', name: 'Polish' },
  { longCode: 'ru-RU', name: 'Russian' },
  { longCode: 'uk-UA', name: 'Ukrainian' },
  { longCode: 'sv', name: 'Swedish' },
  { longCode: 'ca-ES', name: 'Catalan' },
];

const $ = (id) => document.getElementById(id);
const settings = { ...SYNC_DEFAULTS, ...LOCAL_DEFAULTS };
let siteHost = '';
let languageCatalog = [];

function normalizeServer(url) {
  let u = String(url || SYNC_DEFAULTS.serverUrl).trim();
  u = u.replace(/\/+$/, '').replace(/\/v2(\/check|\/languages)?$/, '');
  return u || SYNC_DEFAULTS.serverUrl;
}

async function save(area, items) {
  try {
    await ext.storage[area].set(items);
    $('error').hidden = true;
    return true;
  } catch (err) {
    $('error').textContent = (err && err.message) || 'Could not save';
    $('error').hidden = false;
    return false;
  }
}

function setStatus(kind, title) {
  const dot = $('status');
  dot.className = 'dot' + (kind ? ' ' + kind : '');
  dot.title = title;
}

function option(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

function baseCode(code) {
  return String(code).split('-')[0];
}

const byName = (a, b) => a.name.localeCompare(b.name);

function renderLanguages(langs) {
  const sorted = [...langs].filter(l => l.longCode && l.name)
    .sort((a, b) => a.longCode.localeCompare(b.longCode));
  languageCatalog = sorted;

  const sel = $('language');
  sel.textContent = '';
  sel.appendChild(option('auto', 'Auto-detect'));
  const bases = new Map();
  for (const l of sorted) {
    const base = baseCode(l.longCode);
    if (!bases.has(base)) bases.set(base, l);
  }
  for (const [base, l] of [...bases].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    sel.appendChild(option(base, l.name.replace(/\s*\([^)]*\)\s*$/, '')));
  }
  const savedBase = settings.language === 'auto' ? 'auto' : baseCode(settings.language);
  if (![...sel.options].some(o => o.value === savedBase)) {
    sel.appendChild(option(savedBase, savedBase));
  }
  sel.value = savedBase;
  renderVariantSelect(savedBase);

  const variants = $('variants');
  variants.textContent = '';
  const seenVar = new Set();
  const dialects = sorted.filter(l => {
    if (!l.longCode.includes('-') || seenVar.has(l.longCode)) return false;
    seenVar.add(l.longCode);
    return true;
  });
  const chosen = (l) => settings.preferredVariants.includes(l.longCode);
  for (const l of [...dialects.filter(chosen), ...dialects.filter(l => !chosen(l))]) {
    const o = option(l.longCode, l.name + ' (' + l.longCode + ')');
    o.selected = chosen(l);
    variants.appendChild(o);
  }

  const mother = $('mother');
  mother.textContent = '';
  mother.appendChild(option('', 'Not set'));
  const seenMother = new Set(['']);
  for (const l of sorted) {
    if (seenMother.has(l.longCode)) continue;
    seenMother.add(l.longCode);
    mother.appendChild(option(l.longCode, l.name + ' (' + l.longCode + ')'));
  }
  if (!seenMother.has(settings.motherTongue)) {
    mother.appendChild(option(settings.motherTongue, settings.motherTongue));
  }
  mother.value = settings.motherTongue;

  syncVariantsVisibility();
}

function renderVariantSelect(base) {
  const row = $('variant-row');
  const sel = $('variant');
  sel.textContent = '';
  if (base === 'auto') {
    row.hidden = true;
    return;
  }
  const variants = languageCatalog.filter(l => baseCode(l.longCode) === base);
  if (!variants.length) {
    row.hidden = true;
    return;
  }
  const preferred = variants.find(l => l.longCode === settings.language) ||
    variants.find(l => l.longCode === base) || variants[0];
  for (const l of variants) {
    sel.appendChild(option(l.longCode, l.name + ' (' + l.longCode + ')'));
  }
  sel.value = preferred.longCode;
  row.hidden = variants.length < 2;
}

function syncVariantsVisibility() {
  $('variants-row').hidden = settings.language !== 'auto';
}

async function loadLanguages() {
  setStatus('', 'Checking server…');
  try {
    const resp = await ext.runtime.sendMessage({ type: 'getLanguages', serverUrl: settings.serverUrl });
    if (!resp || resp.error) throw new Error(resp?.error || 'No response');
    renderLanguages(resp.languages);
    setStatus('ok', 'Server reachable');
  } catch (err) {
    renderLanguages(FALLBACK_LANGS);
    setStatus('error', 'Server unreachable: ' + err.message);
  }
}

function removeButton(title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'remove';
  b.textContent = '×';
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function renderWords() {
  const box = $('words');
  box.textContent = '';
  for (const word of settings.ignoredWords) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.appendChild(document.createTextNode(word));
    chip.appendChild(removeButton('Stop ignoring', () => {
      save('sync', { ignoredWords: settings.ignoredWords.filter(w => w !== word) });
    }));
    box.appendChild(chip);
  }
}

function renderAuto() {
  const list = $('auto');
  list.textContent = '';
  settings.autoCorrections.forEach((entry, i) => {
    if (!entry || typeof entry.from !== 'string') return;
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = entry.from + ' → ' + entry.to;
    li.appendChild(span);
    const rule = document.createElement('span');
    rule.className = 'rule';
    rule.textContent = entry.rule + (entry.sub ? '[' + entry.sub + ']' : '');
    rule.title = rule.textContent;
    li.appendChild(rule);
    li.appendChild(removeButton('Stop correcting automatically', () => {
      save('sync', { autoCorrections: settings.autoCorrections.filter((_, j) => j !== i) });
    }));
    list.appendChild(li);
  });
}

function renderRules() {
  const list = $('rules');
  list.textContent = '';
  for (const rule of settings.disabledRules) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = rule;
    li.appendChild(span);
    li.appendChild(removeButton('Re-enable rule', () => {
      save('sync', { disabledRules: settings.disabledRules.filter(r => r !== rule) });
    }));
    list.appendChild(li);
  }
}

function renderFields() {
  const list = $('fields');
  list.textContent = '';
  for (const [host, keys] of Object.entries(settings.disabledFields)) {
    for (const key of keys) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = host + ' — ' + key;
      li.appendChild(span);
      li.appendChild(removeButton('Check this field again', () => {
        const left = keys.filter(k => k !== key);
        const next = { ...settings.disabledFields };
        if (left.length) next[host] = left; else delete next[host];
        save('local', { disabledFields: next });
      }));
      list.appendChild(li);
    }
  }
}

function renderToggles() {
  $('enabled').checked = settings.enabled;
  $('picky').checked = settings.level === 'picky';
  $('accents').checked = settings.ignoreAccents;
  if (siteHost) {
    $('site-row').hidden = false;
    $('site-host').textContent = siteHost;
    $('site').checked = settings.disabledSites.includes(siteHost);
  }
  document.body.classList.toggle('off', !settings.enabled);
}

let serverTimer = 0;
function saveServer() {
  const url = normalizeServer($('server').value);
  if (url !== settings.serverUrl) save('sync', { serverUrl: url });
}
$('server').addEventListener('input', () => {
  clearTimeout(serverTimer);
  serverTimer = setTimeout(saveServer, 500);
});

$('server').addEventListener('change', () => {
  clearTimeout(serverTimer);
  saveServer();
});

$('language').addEventListener('change', () => {
  const base = $('language').value;
  if (base === 'auto') {
    save('sync', { language: 'auto' });
    renderVariantSelect(base);
    syncVariantsVisibility();
    return;
  }
  renderVariantSelect(base);
  const variant = $('variant').value;
  save('sync', { language: variant || base });
});

$('variant').addEventListener('change', () => {
  save('sync', { language: $('variant').value });
});

$('variants').addEventListener('change', () => {
  save('sync', {
    preferredVariants: [...$('variants').selectedOptions].map(o => o.value),
  });
});

$('mother').addEventListener('change', () => {
  save('sync', { motherTongue: $('mother').value });
});

$('picky').addEventListener('change', () => {
  save('sync', { level: $('picky').checked ? 'picky' : 'default' });
});

$('accents').addEventListener('change', () => {
  save('sync', { ignoreAccents: $('accents').checked });
});

$('enabled').addEventListener('change', () => {
  save('sync', { enabled: $('enabled').checked });
});

$('site').addEventListener('change', () => {
  if (!siteHost) return;
  const on = $('site').checked;
  const list = settings.disabledSites.filter(h => h !== siteHost);
  save('sync', { disabledSites: on ? [...list, siteHost] : list });
});

ext.storage.onChanged.addListener((changes, area) => {
  const defaults = area === 'sync' ? SYNC_DEFAULTS : area === 'local' ? LOCAL_DEFAULTS : null;
  if (!defaults) return;
  let reloadLangs = false;
  for (const k of Object.keys(defaults)) {
    if (k in changes) {
      settings[k] = changes[k].newValue ?? defaults[k];
      reloadLangs = reloadLangs || k === 'serverUrl' || k === 'language';
    }
  }
  renderWords();
  renderAuto();
  renderRules();
  renderFields();
  renderToggles();
  if (reloadLangs) {
    if (document.activeElement !== $('server')) $('server').value = settings.serverUrl;
    syncVariantsVisibility();
    loadLanguages();
  }
});

async function currentHost() {
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return '';
    const u = new URL(tab.url);
    return /^https?:$/.test(u.protocol) ? u.hostname : '';
  } catch {
    return '';
  }
}

(async () => {
  const [sync, local, host] = await Promise.all([
    ext.storage.sync.get(SYNC_DEFAULTS),
    ext.storage.local.get(LOCAL_DEFAULTS),
    currentHost(),
  ]);
  Object.assign(settings, sync, local);
  siteHost = host;
  $('server').value = settings.serverUrl;
  renderWords();
  renderAuto();
  renderRules();
  renderFields();
  renderToggles();
  loadLanguages();
})();
