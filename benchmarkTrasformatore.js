// benchmarkTrasformatore.js — Vista "Benchmark" per il caseificio
(function () {
  let kpiChart = null;
  // lascio lo slot per l'istogramma, che sistemeremo dopo
  let histChart = null;

  // Etichette asse X per lattazione (Ott–Set)
  const LATT_MONTH_LABELS = ['Ott', 'Nov', 'Dic', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set'];

  // Palette colori per le lattazioni (max 3, come in app.js)
  const LAC_COLORS = ['#3b82f6', '#f59e0b', '#22c55e'];

  // Mappa stabile: startYear (string) -> colore, così colori e pallini restano allineati
  const LAC_COLOR_MAP = {};

  // Flag per non ricostruire 100 volte le checkbox
  let yearBoxesInitialized = false;

  // Flag per capire se i dati RAW (data.json) sono arrivati
  let rawReady = false;

  // Stato periodo istogramma (lattazione o intervallo custom)
  let histPeriod = { type: 'lactation', start: null, from: null, to: null };

  // ---------- KPI: unità e alias (qui i KPI sono leggermente diversi dall'allevatore) ----------
  const KPI_UNITS = {
    cellule:   'cell/mL',
    carica:    'UFC/mL',
    grasso:    '%',
    proteine:  '%',
    urea:      'mg/dL'
  };

  const KPI_ALIASES = {
    cellule:   ['cellule', 'scc', 'cellule somatiche', 'cellule somatiche (scc)'],
    carica:    ['carica', 'cbt', 'carica batterica', 'carica batterica (cbt)'],
    grasso:    ['grasso', 'grassi', 'fat', '% fat'],
    proteine:  ['proteine', 'protein', '% prot'],
    caseina:   ['caseina', 'caseine'],
    urea:      ['urea']
  };

  function normalizeKpiKey(key) {
    const k = String(key || '').toLowerCase();
    if (k === 'grasso') return 'grasso';
    return k;
  }

  function getSelectedKpi() {
    const sel = document.getElementById('indicatore');
    if (!sel) return 'grasso';
    return normalizeKpiKey(sel.value || 'grasso');
  }

  function getKpiUnit(k) {
    const key = normalizeKpiKey(k);
    return KPI_UNITS[key] || '';
  }

  function getAliasesFor(k) {
    const key = normalizeKpiKey(k);
    return (KPI_ALIASES[key] || [key]).map(s => String(s).toLowerCase());
  }

  function arithmeticMean(values) {
    let sum = 0;
    let n   = 0;
    for (const v of values) {
      const x = Number(v);
      if (Number.isFinite(x)) {
        sum += x;
        n++;
      }
    }
    return n ? (sum / n) : null;
  }

  function isLogKpi(k) {
    return k === 'cellule' || k === 'carica';
  }

  function aggGeometric(values) {
    let sum = 0;
    let n   = 0;
    for (const v of values) {
      const num = Number(v);
      if (Number.isFinite(num) && num > 0) {
        sum += Math.log(num);
        n++;
      }
    }
    return n ? Math.exp(sum / n) : null;
  }

  function percentileRank(arr, v) {
    const nums = arr
      .filter(x => typeof x === 'number' && Number.isFinite(x))
      .sort((a, b) => a - b);

    if (!nums.length || typeof v !== 'number' || !Number.isFinite(v)) return null;

    let count = 0;
    let ties  = 0;
    for (const x of nums) {
      if (x < v) count++;
      else if (x === v) ties++;
    }
    return Math.round(((count + 0.5 * ties) / nums.length) * 100);
  }

  // ---------- Mappa Anno/Mese → lattazione (Ott–Set) ----------
  /**
   * Converte Anno/Mese (1..12) in:
   *   - startYear della lattazione (Ott–Set)
   *   - indice 0..11 nel ciclo di lattazione
   *
   * Esempio:
   *   2022-10 → startYear=2022, index=0 (Ott)
   *   2022-11 → startYear=2022, index=1 (Nov)
   *   2023-01 → startYear=2022, index=3 (Gen)
   */
  function mapToLactation(anno, mese) {
    const y = Number(anno);
    const m = Number(mese);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;

    const startYear = m >= 10 ? y : y - 1;
    const pos = m >= 10 ? (m - 9) : (m + 3); // 10->1, 11->2, 12->3, 1->4, ..., 9->12

    return {
      startYear,
      index: pos - 1 // 0..11
    };
  }

  /**
   * Raggruppa i record (Anno, Mese, Valore) per lattazione (startYear)
   * e costruisce un vettore di 12 valori per ciascuna lattazione (Ott–Set).
   *
   * out: {
   *   "2022": {
   *     startYear: 2022,
   *     label: "2022-23",
   *     values: [..12..],
   *     count: numero di mesi con almeno un valore
   *   }, ...
   * }
   */
  function groupByLactation(rows) {
    const map = {};

    rows.forEach(r => {
      const lm = mapToLactation(r.Anno, r.Mese);
      if (!lm) return;
      const key = String(lm.startYear);

      if (!map[key]) {
        const endYear = lm.startYear + 1;
        const label = lm.startYear + '-' + String(endYear).slice(2);
        map[key] = {
          startYear: lm.startYear,
          label,
          values: new Array(12).fill(null),
          count: 0 // numero di mesi con valore
        };
      }

      const v = Number(r.Valore);
      if (!Number.isFinite(v)) return;

      if (map[key].values[lm.index] == null) {
        map[key].count++;
      }
      map[key].values[lm.index] = v;
    });

    return map;
  }

  /**
   * Costruisce dinamicamente le checkbox delle lattazioni disponibili,
   * sopra il grafico KPI (stile index allevatore), MA:
   * - mostra solo le ultime 3 lattazioni
   * - ciascuna deve avere almeno 4 mesi con dati (count >= 4)
   * - con un pallino colorato accanto alla checkbox (come in app.js)
   * - inizialmente è selezionata SOLO l’ultima lattazione (la più recente)
   */
  function ensureYearBoxes(lactMap) {
    const container = document.querySelector('#view-conf .year-boxes');
    if (!container) return;
    container.innerHTML = '';

    // svuota la mappa colori
    for (const k in LAC_COLOR_MAP) {
      if (Object.prototype.hasOwnProperty.call(LAC_COLOR_MAP, k)) {
        delete LAC_COLOR_MAP[k];
      }
    }

    const entries = Object.values(lactMap).sort((a, b) => a.startYear - b.startYear);

    // Filtra solo le lattazioni con almeno 4 mesi con dati
    const valid = entries.filter(l => (l.count || 0) >= 4);

    const source = valid.length ? valid : entries;
    const lastThree = source.slice(-3);
    const lastIdx = lastThree.length - 1; // indice dell'ultima (più recente)

    lastThree.forEach((l, idx) => {
      const color = LAC_COLORS[idx % LAC_COLORS.length];

      // mappa anno di lattazione -> colore, così il dataset userà lo stesso colore del pallino
      LAC_COLOR_MAP[String(l.startYear)] = color;

      const labelEl = document.createElement('label');
      labelEl.style.display = 'inline-flex';
      labelEl.style.alignItems = 'center';
      labelEl.style.gap = '6px';
      labelEl.style.marginRight = '10px';
      labelEl.style.fontSize = '13px';
      labelEl.style.color = '#0f172a';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = String(l.startYear);
      // solo l’ultima lattazione (più recente) è selezionata di default
      cb.checked = (idx === lastIdx);

      // Pallino colorato (come swatch legenda)
      const dot = document.createElement('span');
      dot.className = 'lac-dot';
      dot.style.width = '10px';
      dot.style.height = '10px';
      dot.style.borderRadius = '999px';
      dot.style.display = 'inline-block';
      dot.style.boxShadow = '0 0 0 1px rgba(0,0,0,.12) inset';
      dot.style.backgroundColor = color;

      const span = document.createElement('span');
      span.textContent = l.label;

      labelEl.appendChild(cb);
      labelEl.appendChild(dot);
      labelEl.appendChild(span);

      container.appendChild(labelEl);
    });

    yearBoxesInitialized = true;
  }

  function getActiveLactationKeys() {
    const container = document.querySelector('#view-conf .year-boxes');
    if (!container) return [];
    const cbs = container.querySelectorAll('input[type="checkbox"]');
    const active = [];
    cbs.forEach(cb => {
      if (cb.checked) active.push(cb.value);
    });
    return active;
  }

  // ---------- filtri benchmark / RAW intrappàre ----------
  function getBenchmarkMode() {
    const sel = document.getElementById('benchmarkType');
    return sel && sel.value ? sel.value : 'intraAppare';
  }

  function filterRawByCaseificioAndProvincia() {
    const base = Array.isArray(window.RAW) ? window.RAW : [];
    if (!base.length) {
      return { rows: [], nAziende: 0 };
    }

    const mode = getBenchmarkMode();
    if (mode !== 'intraAppare') {
      // per intracaseificio e regione, per ora non usiamo RAW
      return { rows: [], nAziende: 0 };
    }

    // nome caseificio dal selettore azienda (per ora CAO)
    const azSel = document.getElementById('aziendaSelect');
    let caseificioName = null;
    if (azSel && azSel.options && azSel.selectedIndex >= 0) {
      caseificioName = azSel.options[azSel.selectedIndex].textContent.trim();
    }

    let rows = base;
    if (caseificioName) {
      rows = rows.filter(r => {
        if (!r) return false;
        const c = String(r.Caseificio || '').trim();
        return c === caseificioName;
      });
    }

    // filtro provincia
    const provSel = document.getElementById('provinciaFilter');
    const provVal = provSel && provSel.value ? provSel.value : 'tutte';
    if (provVal !== 'tutte') {
      let provName = null;
      if (provVal === 'sassari')       provName = 'Sassari';
      else if (provVal === 'nuoro')    provName = 'Nuoro';
      else if (provVal === 'oristano') provName = 'Oristano';
      else if (provVal === 'cagliari') provName = 'Cagliari';

      if (provName) {
        rows = rows.filter(r => {
          if (!r) return false;
          return String(r.Provincia || '').trim() === provName;
        });
      }
    }

    const aziSet = new Set();
    for (const r of rows) {
      if (r && r.Azienda) aziSet.add(String(r.Azienda));
    }

    return { rows, nAziende: aziSet.size };
  }

  /**
   * Dati intrappàre:
   * 1) filtriamo per KPI
   * 2) aggreghiamo per (azienda, anno, mese) con media aritmetica
   * 3) per ogni (anno, mese) facciamo la media delle aziende
   * 4) torniamo righe {Anno, Mese, Valore} pronte per groupByLactation
   */
  function computeGroupMonthlyMeans(rawRows, kpiKey) {
    if (!Array.isArray(rawRows) || !rawRows.length) return [];

    const aliases = getAliasesFor(kpiKey);

    const aziYM = new Map(); // "Azienda|Anno|Mese" -> [valori]

    for (const r of rawRows) {
      if (!r) continue;

      const k = String(r.KPI || '').toLowerCase();
      if (!aliases.includes(k)) continue;

      let anno, mese;
      if (r.Anno != null && r.Mese != null) {
        anno = Number(r.Anno);
        mese = Number(r.Mese);
      } else if (r.Data) {
        const d = new Date(r.Data);
        if (!Number.isFinite(d.getTime())) continue;
        anno = d.getFullYear();
        mese = d.getMonth() + 1;
      } else {
        continue;
      }

      const val = Number(r.Valore);
      if (!Number.isFinite(val)) continue;

      const az = String(r.Azienda || '');
      const key = az + '|' + anno + '|' + mese;
      if (!aziYM.has(key)) aziYM.set(key, []);
      aziYM.get(key).push(val);
    }

    // media per (azienda, anno, mese)
    const ymValues = new Map(); // "Anno|Mese" -> [media_azienda]
    aziYM.forEach((vals, key) => {
      const mAzi = arithmeticMean(vals);
      if (mAzi == null) return;
      const parts = key.split('|');
      const anno = Number(parts[1]);
      const mese = Number(parts[2]);
      const ymKey = anno + '|' + mese;
      if (!ymValues.has(ymKey)) ymValues.set(ymKey, []);
      ymValues.get(ymKey).push(mAzi);
    });

    const out = [];
    ymValues.forEach((vals, ymKey) => {
      const mediaGruppo = arithmeticMean(vals);
      if (mediaGruppo == null) return;
      const parts = ymKey.split('|');
      out.push({
        Anno: Number(parts[0]),
        Mese: Number(parts[1]),
        Valore: mediaGruppo
      });
    });

    return out;
  }

  function rowsForKpi(rawRows, kpiKey) {
    if (!Array.isArray(rawRows) || !rawRows.length) return [];
    const aliases = getAliasesFor(kpiKey);
    const out = [];

    for (const r of rawRows) {
      if (!r) continue;
      const k = String(r.KPI || '').toLowerCase();
      if (!aliases.includes(k)) continue;

      let y, m;
      if (r.Anno != null && r.Mese != null) {
        y = Number(r.Anno);
        m = Number(r.Mese) - 1; // 0-based
      } else if (r.Data) {
        const d = new Date(r.Data);
        if (!Number.isFinite(d.getTime())) continue;
        y = d.getFullYear();
        m = d.getMonth();
      } else {
        continue;
      }

      const v = Number(r.Valore);
      if (!Number.isFinite(v)) continue;

      out.push({ Azienda: String(r.Azienda || ''), year: y, month: m, value: v });
    }

    return out;
  }

  function monthlyAggregate(rawRows, kpiKey) {
    const byKey = new Map();
    const useGeo = isLogKpi(kpiKey);

    rawRows.forEach(r => {
      const key = r.year + '|' + r.month + '|' + r.Azienda;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(r.value);
    });

    const out = [];
    byKey.forEach((vals, keyStr) => {
      const [y, m, az] = keyStr.split('|');
      const agg = useGeo ? aggGeometric(vals) : arithmeticMean(vals);
      if (agg != null) {
        out.push({ Azienda: az, year: Number(y), month: Number(m), value: agg });
      }
    });

    return out;
  }

  function buildYMMap(rawRows, kpiKey) {
    const agg = monthlyAggregate(rawRows, kpiKey);
    const map = new Map();

    agg.forEach(r => {
      const key = r.year + '-' + r.month;
      if (!map.has(key)) {
        map.set(key, { year: r.year, month: r.month, by: new Map() });
      }
      map.get(key).by.set(r.Azienda, r.value);
    });

    return map;
  }

  function lactationLabel(yStart) {
    const yEnd = (yStart + 1).toString().slice(-2);
    return yStart + '-' + yEnd;
  }

  // ---------- costruzione dati per il grafico KPI ----------
  /**
   * Prepara labels e datasets per il grafico KPI:
   *  - serie CAO (cisterna caseificio) da window.CAO / CAO_RAW
   *  - opzionalmente serie "media gruppo" calcolata da RAW (data.json) quando benchmarkType = intraAppare
   */
  function buildKpiData() {
    // Senza dati CAO non ha senso disegnare nulla
    if (!window.CAO || !Array.isArray(window.CAO_RAW)) {
      return { labels: LATT_MONTH_LABELS, datasets: [], nAziende: 0, unit: '' };
    }

      const kpi = getSelectedKpi();
      // Per il benchmark trasformatore l'asse Y è sempre percentuale
      const unit = '%';

    // dati della cisterna del caseificio CAO
    const rowsCao = window.CAO.filter({ kpi, caseificio: 'CAO' });
    if (!rowsCao.length) {
      return { labels: LATT_MONTH_LABELS, datasets: [], nAziende: 0, unit };
    }

    const lactMapCao = groupByLactation(rowsCao);

    // Costruisco UNA sola volta le checkbox delle lattazioni (con regola "minimo 4 mesi")
    if (!yearBoxesInitialized) {
      ensureYearBoxes(lactMapCao);
    }

    const activeKeys = getActiveLactationKeys();
    // Se l'utente spegne tutto, grafico vuoto
    if (!activeKeys.length) {
      return {
        labels: LATT_MONTH_LABELS,
        datasets: [],
        nAziende: 0,
        unit
      };
    }

    // Serie CAO (una per lattazione attiva)
    const datasets = [];
    activeKeys.forEach((key, idx) => {
      const l = lactMapCao[key];
      if (!l) return;

      const color = LAC_COLOR_MAP[key] || LAC_COLORS[idx % LAC_COLORS.length];

      datasets.push({
        label: l.label + ' – CAO',
        data: l.values,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 3,
        pointHoverRadius: 4,
        spanGaps: true,
        _seriesType: 'caseificio'
      });
    });

    // Serie "media gruppo" intra-appàre (dati RAW), solo se modalita intraAppare
    let nAziende = 0;
    const mode = getBenchmarkMode();
    if (mode === 'intraAppare' && Array.isArray(window.RAW) && window.RAW.length) {
      const { rows, nAziende: nAz } = filterRawByCaseificioAndProvincia();
      nAziende = nAz;

      if (rows.length && nAziende > 0) {
        // media mensile del gruppo → groupByLactation come per CAO
        const groupMonthly = computeGroupMonthlyMeans(rows, kpi);
        const lactMapGroup = groupByLactation(groupMonthly);

        const medianToggle = document.getElementById('showMedian');
        const showGroup    = !medianToggle || !!medianToggle.checked;

        activeKeys.forEach((key, idx) => {
          const lg = lactMapGroup[key];
          if (!lg) return;

          const color = LAC_COLOR_MAP[key] || LAC_COLORS[idx % LAC_COLORS.length];

          datasets.push({
            label: lg.label + ' – media gruppo',
            data: lg.values,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            tension: 0.25,
            // pallino solo in hover per evidenziare la serie tratteggiata
            pointRadius: 0,
            pointHoverRadius: 4,
            borderDash: [5, 4],
            spanGaps: true,
            hidden: !showGroup,
            _seriesType: 'group'
          });
        });
      }
    }

    return {
      labels: LATT_MONTH_LABELS,
      datasets,
      nAziende,
      unit
    };
  }

  // ---------- titolo (uno solo, con N aziende) ----------
  function updateTitle(nAziende) {
    const card = document.querySelector('#kpiChartHost')?.closest('.card');
    if (!card) return;

    const titleEl  = card.querySelector('.card-title');
    const legendEl = card.querySelector('.legend');

    if (titleEl) {
      if (nAziende && nAziende > 0) {
        titleEl.textContent = 'Valore KPI: Caseificio vs media del gruppo di ' + nAziende + ' aziende';
      } else {
        // quando non abbiamo ancora RAW o non siamo in intraAppare
        titleEl.textContent = 'Valore KPI: Caseificio';
      }
    }

  }


  // Crea, se manca, la checkbox "Mostra media aziende" accanto al titolo
  function ensureGroupToggle() {
    const head = document.getElementById('kpiChartHost')?.previousElementSibling;
    if (!head) return null;

    let toggle = document.getElementById('showMedian');
    if (toggle) return toggle;

    const legendHost = head.querySelector('.legend') || head;
    legendHost.textContent = '';

    const row = document.createElement('div');
    row.style.display = 'inline-flex';
    row.style.alignItems = 'center';
    row.style.gap = '12px';
    row.style.fontSize = '13px';
    row.style.color = '#0f172a';

    const wrap = document.createElement('label');
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '6px';

    toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.id = 'showMedian';
    toggle.checked = true;

    const txt = document.createElement('span');
    txt.textContent = 'Mostra media aziende';

    wrap.appendChild(toggle);
    wrap.appendChild(txt);

    function legendItem(label, dashed) {
      const item = document.createElement('span');
      item.style.display = 'inline-flex';
      item.style.alignItems = 'center';
      item.style.gap = '6px';

      const line = document.createElement('span');
      line.style.display = 'inline-block';
      line.style.width = '28px';
      line.style.height = '0';
      line.style.borderTop = dashed ? '2px dashed currentColor' : '2px solid currentColor';

      const lab = document.createElement('span');
      lab.textContent = label;

      item.appendChild(line);
      item.appendChild(lab);
      return item;
    }

    row.appendChild(wrap);
    row.appendChild(legendItem('Media caseificio', false));
    row.appendChild(legendItem('Media aziende', true));

    legendHost.appendChild(row);

    return toggle;
  }
  // ---------- render grafico KPI ----------
  function renderKpiChart() {
    const canvas = document.querySelector('#kpiChartHost canvas');
    if (!canvas || !canvas.getContext || typeof Chart === 'undefined') return;

    const ctx = canvas.getContext('2d');

    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    if (kpiChart) {
      kpiChart.destroy();
      kpiChart = null;
    }

    const cfg = buildKpiData();
    updateTitle(cfg.nAziende);

    kpiChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: cfg.labels,
        datasets: cfg.datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'nearest',
          intersect: false
        },
        layout: {
          padding: {
            top: 10,
            bottom: 0
          }
        },
        plugins: {
          // niente legenda standard: le checkbox + pallino sono la legenda
          legend: {
            display: false
          },
          tooltip: {
            mode: 'nearest',
            intersect: false,
            callbacks: {
              label(context) {
                const v = context.parsed.y;
                if (v == null) return '';
                const dsLabel = context.dataset.label || '';
                if (!cfg.unit) {
                  return `${dsLabel}: ${v.toFixed(3)}`;
                }
                return `${dsLabel}: ${v.toFixed(3)} ${cfg.unit}`;
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: false,
              text: ''
            },
            ticks: {
              autoSkip: false
            }
          },
          y: {
            title: {
              display: !!cfg.unit,
              text: cfg.unit || ''
            },
            beginAtZero: false,
            ticks: {
              callback: (v) => {
                const num = Number(v);
                return Number.isFinite(num) ? `${num.toFixed(1)} %` : `${v} %`;
              }
            }
          }
        }
      }
    });
  }

  // Per ora lascio un placeholder per l’istogramma (a destra)
  function renderEmptyHist() {
    const canvas = document.querySelector('#histChartHost canvas');
    if (!canvas || !canvas.getContext || typeof Chart === 'undefined') return;

    const ctx = canvas.getContext('2d');
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    if (histChart) {
      histChart.destroy();
      histChart = null;
    }

    histChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'Distribuzione campione (in arrivo)',
          data: []
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            display: false
          },
          y: {
            display: false
          }
        }
      }
    });
  }

  // Nuova implementazione istogramma (dataset gruppo + linea media caseificio)
  function ensureHistChart() {
    const canvas = document.querySelector('#histChartHost canvas');
    if (!canvas || !canvas.getContext || typeof Chart === 'undefined') return null;

    if (histChart && histChart.canvas === canvas) return histChart;

    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    const ctx = canvas.getContext('2d');
    histChart = new Chart(ctx, {
      type: 'bar',
      data: {
        datasets: [
          {
            label: 'Frequenza %',
            data: [],
            parsing: { xAxisKey: 'x', yAxisKey: 'y' },
            backgroundColor: (ctx) => {
              const c = ctx.raw?.count;
              return (Number.isFinite(c) && c > 0) ? 'rgba(59,130,246,0.28)' : 'transparent';
            },
            borderColor: (ctx) => {
              const c = ctx.raw?.count;
              return (Number.isFinite(c) && c > 0) ? '#3b82f6' : 'transparent';
            },
            borderWidth: (ctx) => {
              const c = ctx.raw?.count;
              return (Number.isFinite(c) && c > 0) ? 1 : 0;
            },
            barPercentage: 1,
            categoryPercentage: 1,
            _tag: 'bars'
          },
          {
            type: 'scatter',
            label: 'Caseificio',
            data: [],
            backgroundColor: '#f43f5e',
            borderColor: '#f43f5e',
            pointRadius: 2.5,
            pointHoverRadius: 7,
            pointHitRadius: 10,
            showLine: false,
            _tag: 'caseificio'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        animation: { duration: 0 },
        scales: {
          x: {
            type: 'linear',
            title: { display: false, text: '' }
          },
          y: {
            beginAtZero: true,
            ticks: { callback: (v) => v + '%' }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true },
          annotation: { annotations: {} }
        }
      }
    });

    return histChart;
  }

  function getCaoMonthMap(kpiKey) {
    if (!window.CAO) return new Map();
    const rows = window.CAO.filter({ kpi: kpiKey, caseificio: 'CAO' });
    const tmp = new Map();

    rows.forEach(r => {
      if (!r) return;
      const y = Number(r.Anno);
      const m = Number(r.Mese) - 1;
      const v = Number(r.Valore);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(v)) return;
      const key = y + '-' + m;
      if (!tmp.has(key)) tmp.set(key, []);
      tmp.get(key).push(v);
    });

    const out = new Map();
    tmp.forEach((vals, keyStr) => {
      const agg = arithmeticMean(vals);
      if (agg == null) return;
      const parts = keyStr.split('-').map(Number);
      out.set(keyStr, { year: parts[0], month: parts[1], value: agg });
    });

    return out;
  }

  function availableLactationStarts(kpiKey) {
    const map = getCaoMonthMap(kpiKey);
    const counts = new Map(); // startYear -> mesi con valore

    map.forEach(obj => {
      if (!obj) return;
      const start = obj.month >= 9 ? obj.year : (obj.year - 1);
      const key = String(start);
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const all = Array.from(counts.entries())
      .map(([k, c]) => ({ start: Number(k), count: c }))
      .filter(x => Number.isFinite(x.start))
      .sort((a, b) => a.start - b.start);

    // Applica la regola "almeno 4 campioni" per considerare l'ultima lattazione
    const filtered = all.filter(x => x.count >= 4);
    const useList = filtered.length ? filtered : all;

    return useList.slice(-3).map(x => x.start);
  }

  function setCustomLabelText(selectEl, from, to) {
    if (!selectEl) return;
    const opt = selectEl.querySelector('option[value="custom"]');
    if (!opt) return;
    if (from && to) {
      opt.textContent = 'Intervallo ' + formatMonth(from) + ' -> ' + formatMonth(to);
    } else {
      opt.textContent = 'Intervallo personalizzato';
    }
  }

  function formatMonth(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }

  function updatePeriodUIFromState() {
    const preset = document.getElementById('distPreset');
    const wrap   = document.getElementById('customPeriod');
    const fm     = document.getElementById('fromMonth');
    const tm     = document.getElementById('toMonth');

    if (!preset) return;

    if (histPeriod.type === 'lactation') {
      preset.value = 'lac:' + histPeriod.start;
      if (wrap) wrap.style.display = 'none';
    } else {
      preset.value = 'custom';
      if (wrap) wrap.style.display = 'flex';
      if (histPeriod.from && fm) fm.value = formatMonth(histPeriod.from);
      if (histPeriod.to && tm)   tm.value = formatMonth(histPeriod.to);
      setCustomLabelText(preset, histPeriod.from, histPeriod.to);
    }
  }

  function getCaoBounds(kpiKey) {
    const map = getCaoMonthMap(kpiKey);
    let minD = null;
    let maxD = null;
    map.forEach(obj => {
      if (!obj) return;
      const d = new Date(obj.year, obj.month, 1);
      if (!minD || d < minD) minD = d;
      if (!maxD || d > maxD) maxD = d;
    });
    return { min: minD, max: maxD };
  }

  function ensureHistPreset(preserveSelection = false) {
    const preset = document.getElementById('distPreset');
    if (!preset) return;

    const prev = preset.value;
    const kpi  = getSelectedKpi();
    const starts = availableLactationStarts(kpi);

    preset.innerHTML = '';
    starts.forEach(y => {
      const opt = document.createElement('option');
      opt.value = 'lac:' + y;
      opt.textContent = 'Lattazione ' + lactationLabel(y);
      preset.appendChild(opt);
    });

    const optCustom = document.createElement('option');
    optCustom.value = 'custom';
    optCustom.textContent = 'Intervallo personalizzato';
    preset.appendChild(optCustom);

    let target = null;
    if (preserveSelection && prev) target = prev;

    const startList = starts.map(Number);
    if (target && target.startsWith('lac:')) {
      const ySel = Number(target.split(':')[1]);
      if (!startList.includes(ySel)) target = null;
    }

    if (!target) {
      const last = startList[startList.length - 1];
      if (Number.isFinite(last)) {
        target = 'lac:' + last;
        histPeriod = { type: 'lactation', start: last, from: null, to: null };
      } else {
        target = 'custom';
      }
    }

    preset.value = target;
    if (target === 'custom') {
      const bounds = getCaoBounds(kpi);
      if (histPeriod.type !== 'custom') {
        if (bounds.min && bounds.max) {
          histPeriod = { type: 'custom', from: bounds.min, to: bounds.max };
        } else {
          histPeriod = { type: 'custom', from: null, to: null };
        }
      } else {
        if ((!histPeriod.from || !histPeriod.to) && bounds.min && bounds.max) {
          histPeriod.from = histPeriod.from || bounds.min;
          histPeriod.to   = histPeriod.to   || bounds.max;
        }
      }
      setCustomLabelText(preset, histPeriod.from, histPeriod.to);
    } else if (target.startsWith('lac:')) {
      const ySel = Number(target.split(':')[1]);
      histPeriod = { type: 'lactation', start: ySel, from: null, to: null };
    }

    updatePeriodUIFromState();
  }

  function renderHistogram() {
    const chart = ensureHistChart();
    const posBadge = document.getElementById('posBadge');
    if (!chart) return;

    const kpi = getSelectedKpi();
    ensureHistPreset(true);

    const groupFiltered = filterRawByCaseificioAndProvincia();
    const rowsKpi = rowsForKpi(groupFiltered.rows, kpi);
    const by = buildYMMap(rowsKpi, kpi);

    const ymKeys = Array.from(by.keys())
      .map(k => {
        const parts = k.split('-').map(Number);
        return { y: parts[0], m: parts[1] };
      })
      .sort((a, b) => (a.y - b.y) || (a.m - b.m));

    if (!ymKeys.length) {
      chart.data.datasets[0].data = [];
      chart.options.plugins.annotation.annotations = {};
      chart.update();
      if (posBadge) posBadge.textContent = '-- percentile';
      return;
    }

    const fmEl = document.getElementById('fromMonth');
    const tmEl = document.getElementById('toMonth');
    const bounds = getCaoBounds(kpi);
    if (bounds.min && bounds.max) {
      const minStr = formatMonth(bounds.min);
      const maxStr = formatMonth(bounds.max);
      if (fmEl) { fmEl.min = minStr; fmEl.max = maxStr; }
      if (tmEl) { tmEl.min = minStr; tmEl.max = maxStr; }
    }

    if (histPeriod.type === 'lactation' && !Number.isFinite(histPeriod.start)) {
      const starts = availableLactationStarts(kpi);
      const last = starts[starts.length - 1];
      if (Number.isFinite(last)) histPeriod.start = last;
    }

    const inRangeMonths = [];
    if (histPeriod.type === 'lactation') {
      const y0 = Number(histPeriod.start);
      ymKeys.forEach(k => {
        if ((k.y === y0 && k.m >= 9) || (k.y === y0 + 1 && k.m <= 8)) {
          inRangeMonths.push(k);
        }
      });
    } else if (histPeriod.type === 'custom') {
      let fromD = histPeriod.from;
      let toD   = histPeriod.to;
      if (!fromD || !toD) {
        fromD = bounds.min;
        toD   = bounds.max;
        histPeriod.from = fromD;
        histPeriod.to   = toD;
        updatePeriodUIFromState();
      }
      if (fromD && toD && fromD > toD) {
        const tmp = fromD;
        fromD = toD;
        toD = tmp;
      }
      ymKeys.forEach(k => {
        const d = new Date(k.y, k.m, 1);
        if (fromD && toD && d >= fromD && d <= toD) {
          inRangeMonths.push(k);
        }
      });
    }

    const perAz = new Map();
    inRangeMonths.forEach(ym => {
      const bucket = by.get(ym.y + '-' + ym.m);
      if (!bucket) return;
      bucket.by.forEach((val, az) => {
        if (!Number.isFinite(val)) return;
        if (!perAz.has(az)) perAz.set(az, []);
        perAz.get(az).push(val);
      });
    });

    const useGeo = isLogKpi(kpi);
    const vals = [];
    perAz.forEach(list => {
      const agg = useGeo ? aggGeometric(list) : arithmeticMean(list);
      if (agg != null) vals.push(agg);
    });

    const caoMap = getCaoMonthMap(kpi);
    const caoVals = [];
    inRangeMonths.forEach(ym => {
      const c = caoMap.get(ym.y + '-' + ym.m);
      if (c && Number.isFinite(c.value)) caoVals.push(c.value);
    });
    const caseificioAgg = caoVals.length
      ? (useGeo ? aggGeometric(caoVals) : arithmeticMean(caoVals))
      : null;

    if (!vals.length) {
      chart.data.datasets[0].data = [];
      chart.options.plugins.annotation.annotations = {};
      chart.update();
      if (posBadge) posBadge.textContent = '-- percentile';
      return;
    }

    function freedmanBins(values) {
      const n = values.length;
      if (n < 2) return 6;
      const s = values.slice().sort((a, b) => a - b);
      const q1 = s[Math.floor(0.25 * (n - 1))];
      const q3 = s[Math.floor(0.75 * (n - 1))];
      let iqr = (q3 - q1);
      if (!Number.isFinite(iqr) || iqr === 0) {
        iqr = (s[n - 1] - s[0]) / 4;
        if (!Number.isFinite(iqr) || iqr === 0) iqr = 1;
      }
      const h = 2 * iqr * Math.pow(n, -1 / 3);
      let bins = Math.ceil((s[n - 1] - s[0]) / (h || 1)) || 6;
      if (bins < 6) bins = 6;
      if (bins > 15) bins = 15;
      return bins;
    }

    let bins = freedmanBins(vals);
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    let centers;
    let counts;
    let step;

    let edges = [];
    if (mn === mx) {
      bins = 1;
      step = 1;
      edges = [mn - 0.5, mn + 0.5];
      centers = [mn];
      counts = [vals.length];
    } else {
      step = (mx - mn) / bins;
      if (!Number.isFinite(step) || step <= 0) step = 1;
      edges = [];
      for (let i = 0; i <= bins; i++) edges.push(mn + i * step);
      centers = [];
      for (let i = 0; i < bins; i++) {
        centers.push(mn + (i + 0.5) * step);
      }
      counts = new Array(bins).fill(0);
      for (const v of vals) {
        let idx = Math.floor((v - mn) / step);
        if (idx >= bins) idx = bins - 1;
        if (idx < 0) idx = 0;
        counts[idx]++;
      }
    }

    const total = counts.reduce((a, c) => a + c, 0) || 1;
    const data = centers.map((c, i) => ({
      x: c,
      y: Math.round((counts[i] / total) * 1000) / 10,
      count: counts[i],
      from: edges[i],
      to: edges[i + 1]
    }));

    const pr = percentileRank(vals, caseificioAgg);
    const unit = getKpiUnit(kpi) || '%';

    chart.data.datasets[0].data = data;
    chart.data.datasets[1].data = (caseificioAgg != null)
      ? [{
          x: caseificioAgg,
          y: 0,
          caseificioValue: caseificioAgg,
          unit
        }]
      : [];
    let axisMin = mn;
    let axisMax = mx;
    if (axisMin === axisMax) {
      axisMin = mn - 0.5;
      axisMax = mn + 0.5;
    }
    // includi la posizione del caseificio nell'asse X per renderla sempre visibile
    if (caseificioAgg != null && Number.isFinite(caseificioAgg)) {
      const pad = Number.isFinite(step) && step > 0 ? (step * 0.3) : 0.5;
      axisMin = Math.min(axisMin, caseificioAgg - pad);
      axisMax = Math.max(axisMax, caseificioAgg + pad);
    }

    chart.options.scales.x = {
      type: 'linear',
      min: axisMin,
      max: axisMax,
      bounds: 'ticks',
      offset: false,
      title: { display: !!unit, text: unit ? (unit + ' ' + (kpi || '')) : '' },
      ticks: {
        callback: (v) => Number.isFinite(v) ? v.toFixed(2) : v
      },
      afterBuildTicks: (scale) => {
        const tks = edges.map(v => ({ value: v }));
        scale.ticks = tks;
      }
    };

    chart.options.plugins.annotation.annotations = (caseificioAgg != null)
      ? {
          caseificio: {
            type: 'line',
            xMin: caseificioAgg,
            xMax: caseificioAgg,
            borderColor: '#ef4444',
            borderWidth: 2,
            label: {
              enabled: true,
              content: 'Caseificio: ' + caseificioAgg.toFixed(2) + (unit ? (' ' + unit) : ''),
              rotation: 90,
              backgroundColor: 'rgba(244,63,94,0.18)',
              color: '#f43f5e'
            }
          }
        }
      : {};

    chart.options.plugins.tooltip = {
      enabled: true,
      displayColors: false,
      filter(item) {
        if (item.dataset && item.dataset._tag === 'bars') {
          const c = item.raw?.count;
          return Number.isFinite(c) && c > 0;
        }
        return true;
      },
      callbacks: {
        label(ctx) {
          if (ctx.dataset && ctx.dataset._tag === 'caseificio') {
            const d = ctx.raw || {};
            const val = Number.isFinite(d.caseificioValue) ? d.caseificioValue.toFixed(2) : '';
            return val ? ['Caseificio: ' + val + (unit ? ' ' + unit : '')] : '';
          }
          const d = ctx.raw || {};
          const left = Number.isFinite(d.from) ? d.from.toFixed(2) : '?';
          const right = Number.isFinite(d.to) ? d.to.toFixed(2) : '?';
          const isLast = ctx.dataIndex === (ctx.chart.data.datasets[0].data.length - 1);
          const range = 'Range: [' + left + ' ; ' + right + (isLast ? ' ]' : ' [');
          const pct = Number.isFinite(d.y) ? 'Frequenza: ' + d.y.toFixed(1) + '%' : '';
          const cnt = Number.isFinite(d.count) ? 'Aziende: ' + d.count : '';
          return [range, pct, cnt].filter(Boolean);
        }
      }
    };

    chart.update();

    if (posBadge) {
      posBadge.textContent = (pr != null) ? (pr + ' percentile') : '-- percentile';
    }
  }

  // ---------- binding UI ----------
  function bindUi() {
    // cambio KPI
    const kpiSel = document.getElementById('indicatore');
    if (kpiSel) {
      kpiSel.addEventListener('change', () => {
        renderKpiChart();
        renderHistogram();
        ensureKpiStyleLegend();
      });
    }

    // cambio tipo di benchmark o provincia o caseificio
    ['benchmarkType', 'provinciaFilter', 'aziendaSelect'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          renderKpiChart();
          renderHistogram();
        });
      }
    });

    // cambio lattazioni (delegato: checkbox nel container .year-boxes)
    document.addEventListener('change', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLInputElement)) return;
      const container = t.closest('#view-conf .year-boxes');
      if (!container) return;
      if (t.type === 'checkbox') {
        renderKpiChart();
        renderHistogram();
      }
    });

    // toggle media gruppo (checkbox "Mostra media aziende")
    const medianToggle = ensureGroupToggle();
    if (medianToggle && !medianToggle._bound) {
      medianToggle.addEventListener('change', () => {
        if (!kpiChart) return;
        const showGroup = !!medianToggle.checked;
        kpiChart.data.datasets.forEach(ds => {
          if (ds._seriesType === 'group') {
            ds.hidden = !showGroup;
          }
        });
        kpiChart.update();
      });
      medianToggle._bound = true;
    }

    // cambio preset istogramma (lattazioni/custom)
    const presetSel = document.getElementById('distPreset');
    const customWrap = document.getElementById('customPeriod');
    if (presetSel && !presetSel._bound) {
      presetSel.addEventListener('change', () => {
        const v = presetSel.value;
        if (v && v.startsWith('lac:')) {
          const y = Number(v.split(':')[1]);
          histPeriod = { type: 'lactation', start: y, from: null, to: null };
          if (customWrap) customWrap.style.display = 'none';
          renderHistogram();
        } else if (v === 'custom') {
          if (customWrap) customWrap.style.display = 'flex';
        }
      });
      presetSel._bound = true;
    }

    const applyCustom = document.getElementById('applyCustom');
    if (applyCustom && !applyCustom._bound) {
      applyCustom.addEventListener('click', (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const fm = document.getElementById('fromMonth');
        const tm = document.getElementById('toMonth');
        if (!fm || !tm || !fm.value || !tm.value) return;

        const fParts = fm.value.split('-').map(Number);
        const tParts = tm.value.split('-').map(Number);
        let fromD = new Date(fParts[0], (fParts[1] || 1) - 1, 1);
        let toD   = new Date(tParts[0], (tParts[1] || 1) - 1, 1);
        if (fromD > toD) {
          const tmp = fromD;
          fromD = toD;
          toD = tmp;
        }

        histPeriod = { type: 'custom', from: fromD, to: toD };
        setCustomLabelText(presetSel, fromD, toD);
        if (presetSel) presetSel.value = 'custom';
        renderHistogram();
      });
      applyCustom._bound = true;
    }
  }

  function onCaoReady() {
    bindUi();
    renderKpiChart();
    ensureHistPreset(false);
    renderHistogram();
  }

  function init() {
    // ascolta il caricamento di RAW (data.json) per aggiornare la media del gruppo
    document.addEventListener('raw:loaded', () => {
      rawReady = true;
      renderKpiChart();
      ensureHistPreset(true);
      renderHistogram();
    });

    // aspetta che il loader CAO abbia caricato i dati
    if (window.CAO_RAW && window.CAO_RAW.length) {
      onCaoReady();
    } else {
      document.addEventListener('cao:loaded', function handle() {
        document.removeEventListener('cao:loaded', handle);
        onCaoReady();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


