'use strict';

const ext = globalThis.browser ?? globalThis.chrome;

(ext.action ?? ext.browserAction)?.onClicked.addListener(() => {
  ext.tabs.create({ url: ext.runtime.getURL('pages/popup.html') });
});

const DEFAULT_SERVER = 'http://127.0.0.1:8081';

function serverBase(url) {
  let u = String(url || DEFAULT_SERVER).trim();
  u = u.replace(/\/+$/, '').replace(/\/v2(\/check|\/languages)?$/, '');
  return u || DEFAULT_SERVER;
}

async function fetchJson(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    if (!r.ok) return { error: 'Server responded ' + r.status };
    return { data: await r.json() };
  } catch (err) {
    return { error: (err && err.message) || 'Request failed' };
  } finally {
    clearTimeout(timer);
  }
}

const CACHE_MAX = 30;
const CACHE_MAX_TEXT = 10000; 
const cache = new Map();      
const inflight = new Map();   

async function handleCheck(req) {
  const base = serverBase(req.serverUrl);
  const text = String(req.text ?? '');
  const params = new URLSearchParams({ language: req.language || 'auto', text });
  if (req.language === 'auto' && Array.isArray(req.preferredVariants) && req.preferredVariants.length) {
    params.set('preferredVariants', req.preferredVariants.join(','));
  }
  if (req.motherTongue) params.set('motherTongue', req.motherTongue);
  if (req.level === 'picky') params.set('level', 'picky');
  if (Array.isArray(req.disabledRules) && req.disabledRules.length) {
    params.set('disabledRules', req.disabledRules.join(','));
  }
  const body = params.toString();
  const key = base + '\n' + body;

  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); 
    cache.set(key, hit);
    return hit;
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const res = await fetchJson(base + '/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }, 15000);
    if (res.error) return { error: res.error };
    const out = { matches: res.data.matches || [], language: res.data.language || null };
    if (text.length <= CACHE_MAX_TEXT) {
      cache.set(key, out);
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return out;
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

async function handleLanguages(req) {
  const res = await fetchJson(serverBase(req.serverUrl) + '/v2/languages', { method: 'GET' }, 8000);
  if (res.error) return { error: res.error };
  return { languages: Array.isArray(res.data) ? res.data : [] };
}

ext.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === 'checkText') {
    handleCheck(request).then(sendResponse);
    return true;
  }
  if (request?.type === 'getLanguages') {
    handleLanguages(request).then(sendResponse);
    return true;
  }
  return false;
});
