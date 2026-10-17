const LT = (globalThis.LT ??= {});

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

LT.SYNC_DEFAULTS = SYNC_DEFAULTS;
LT.LOCAL_DEFAULTS = LOCAL_DEFAULTS;
LT.settings = { ...SYNC_DEFAULTS, ...LOCAL_DEFAULTS };
LT.onSettingsChanged = [];

LT.emitSettings = (keys) => {
  for (const fn of LT.onSettingsChanged) {
    try { fn(keys); } catch {  }
  }
};

LT.saveError = null;
LT.save = async function (area, items) {
  try {
    await ext.storage[area].set(items);
    LT.saveError = null;
    return true;
  } catch (err) {
    LT.saveError = (err && err.message) || 'Could not save (storage quota?)';
    return false;
  }
};

LT.siteHost = (() => {
  let host = location.hostname;
  if (window.top !== window) {
    try { host = window.top.location.hostname || host; } catch {  }
  }
  return host;
})();

LT.siteDisabled = () =>
  !LT.settings.enabled || LT.settings.disabledSites.includes(LT.siteHost);

LT.settingsReady = (async () => {
  const [sync, local] = await Promise.all([
    ext.storage.sync.get(SYNC_DEFAULTS),
    ext.storage.local.get(LOCAL_DEFAULTS),
  ]);
  Object.assign(LT.settings, sync, local);
})().catch(() => {  });

ext.storage.onChanged.addListener((changes, area) => {
  const defaults = area === 'sync' ? SYNC_DEFAULTS : area === 'local' ? LOCAL_DEFAULTS : null;
  if (!defaults) return;
  const keys = [];
  for (const k of Object.keys(defaults)) {
    if (k in changes) {
      LT.settings[k] = changes[k].newValue ?? defaults[k];
      keys.push(k);
    }
  }
  if (keys.length) LT.emitSettings(keys);
});
