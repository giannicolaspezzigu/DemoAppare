// loaderCaseificio.js - carica dati CAO: cisterna (datiCAO.json) + campioni conferitori (conferitoriCAO.json)
(function () {
  const SRC_CAMPI = './conferitoriCAO.json';
  const SRC_TANK  = './datiCAO.json';

  // Stato globale
  window.CAO_RAW  = Array.isArray(window.CAO_RAW) ? window.CAO_RAW : [];   // campioni conferitori
  window.CAO_TANK = Array.isArray(window.CAO_TANK) ? window.CAO_TANK : []; // valori cisterna mensili

  let loadPromise = null;

  function norm(v) {
    return String(v || '').trim().toLowerCase();
  }

  // Alias KPI per gestire plurali / sinonimi
  const KPI_ALIASES = {
    grassi:    ['grassi', 'grasso'],
    proteine:  ['proteine', 'proteina'],
    lattosio:  ['lattosio'],
    caseina:   ['caseina', 'caseine'],
    cellule:   ['cellule', 'scc'],
    carica:    ['carica', 'cbt'],
    urea:      ['urea'],
    crio:      ['crio', 'crio ft'],
    nacl:      ['nacl'],
    ph:        ['ph']
  };

  function mapProvincia(p) {
    const v = norm(p);
    if (v === 'ca') return 'Cagliari';
    if (v === 'ss') return 'Sassari';
    if (v === 'or') return 'Oristano';
    if (v === 'nu') return 'Nuoro';
    return (p || '').trim();
  }

  function filter(opts = {}) {
    const { kpi, fromYear, toYear, fromMonth, toMonth, provincia } = opts;

    let kpiAccepted = null;
    if (kpi) {
      const key = norm(kpi);
      kpiAccepted = KPI_ALIASES[key] ? KPI_ALIASES[key].map(norm) : [key];
    }

    const provName = provincia ? mapProvincia(provincia) : null;

    return window.CAO_RAW.filter(r => {
      if (!r) return false;

      if (kpiAccepted) {
        const rk = norm(r.KPI);
        if (!kpiAccepted.includes(rk)) return false;
      }

      if (provName && r.Provincia && r.Provincia !== provName) return false;

      const y = Number(r.Anno);
      const m = Number(r.Mese);
      if (Number.isFinite(fromYear) && y < fromYear) return false;
      if (Number.isFinite(toYear) && y > toYear) return false;
      if (Number.isFinite(fromMonth) && m < fromMonth) return false;
      if (Number.isFinite(toMonth)   && m > toMonth)   return false;

      return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(Number(r.Valore));
    });
  }

  function filterTank(opts = {}) {
    const { kpi, fromYear, toYear, fromMonth, toMonth, provincia } = opts;

    let kpiAccepted = null;
    if (kpi) {
      const key = norm(kpi);
      kpiAccepted = KPI_ALIASES[key] ? KPI_ALIASES[key].map(norm) : [key];
    }

    const provName = provincia ? mapProvincia(provincia) : null;

    return window.CAO_TANK.filter(r => {
      if (!r) return false;

      if (kpiAccepted) {
        const rk = norm(r.KPI);
        if (!kpiAccepted.includes(rk)) return false;
      }

      if (provName && r.Provincia && r.Provincia !== provName) return false;

      const y = Number(r.Anno);
      const m = Number(r.Mese);
      if (Number.isFinite(fromYear) && y < fromYear) return false;
      if (Number.isFinite(toYear) && y > toYear) return false;
      if (Number.isFinite(fromMonth) && m < fromMonth) return false;
      if (Number.isFinite(toMonth)   && m > toMonth)   return false;

      return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(Number(r.Valore));
    });
  }

  async function ensureLoaded(force = false) {
    if (window.CAO_RAW.length && window.CAO_TANK.length && !force) {
      return { tank: window.CAO_TANK, samples: window.CAO_RAW };
    }
    if (!loadPromise || force) {
      const urlCam  = SRC_CAMPI + '?v=' + Date.now();
      const urlTank = SRC_TANK  + '?v=' + Date.now();
      loadPromise = Promise.all([
        fetch(urlTank, { cache: 'no-store' }).then(resp => {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.json();
        }),
        fetch(urlCam, { cache: 'no-store' }).then(resp => {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.json();
        })
      ])
        .then(([tank, campioni]) => {
          window.CAO_TANK = Array.isArray(tank) ? tank : [];
          window.CAO_RAW  = Array.isArray(campioni) ? campioni : [];
          console.log('[loaderCaseificio] caricati', window.CAO_TANK.length, 'valori cisterna e', window.CAO_RAW.length, 'campioni');
          document.dispatchEvent(new CustomEvent('cao:loaded', {
            detail: { size: window.CAO_RAW.length, tank: window.CAO_TANK.length }
          }));
          return { tank: window.CAO_TANK, samples: window.CAO_RAW };
        })
        .catch(err => {
          console.error('[loaderCaseificio] errore nel caricamento di dati CAO:', err);
          window.CAO_RAW  = [];
          window.CAO_TANK = [];
          document.dispatchEvent(new CustomEvent('cao:loaded', {
            detail: { size: 0, tank: 0, error: String(err) }
          }));
          return { tank: [], samples: [] };
        });
    }
    return loadPromise;
  }

  window.CAO = {
    isLoaded() { return window.CAO_RAW.length > 0 || window.CAO_TANK.length > 0; },
    isLoading() { return !!loadPromise; },
    ensureLoaded,
    load: ensureLoaded,
    getAll() { return window.CAO_RAW.slice(); },
    getTank() { return window.CAO_TANK.slice(); },
    filter,
    filterTank
  };

  // Avvia subito il caricamento come comportamento di default
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensureLoaded().catch(() => {}));
  } else {
    ensureLoaded().catch(() => {});
  }
})();
