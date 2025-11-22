// mieiDati.js â€” Vista "I miei dati": solo azienda, punti giornalieri, nessuna mediana
(function () {
  //const MONTHS_LACT = ['Set','Ott','Nov','Dic','Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago'];
  const MONTHS_LACT = ['Ott','Nov','Dic','Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set'];

  const YEAR_COLORS = { 2023:'#3b82f6', 2024:'#f59e0b', 2025:'#22c55e', 2026:'#10b981' };

  let chart = null;                 // istanza Chart.js unica
  let bound = false;                // per evitare doppi listener
  let lastSig = '';                 // firma per il polling (azienda|kpi|visibilitÃ |nRows)

  // ---------- utils ----------
  const daysInMonth = (y,m) => new Date(y, m+1, 0).getDate();

  function lactationFromDate(d) {
    const y = d.getFullYear(), m = d.getMonth();
    const start = (m >= 9) ? y : (y - 1);
    const label = `${start}-${String((start + 1) % 100).padStart(2,'0')}`;
    const xMonth = (m + 3) % 12; // Ott(9)->0 ... Set(8)->11
    const frac = (d.getDate() - 1) / daysInMonth(y, m);
    return { startYear: start, label, x: xMonth + frac };
  }

  function getAzienda() {
    if (window.state?.azienda) return String(window.state.azienda);
    return document.getElementById('aziendaHeader')?.textContent?.trim() || '';
  }

  function getKpi() {
    if (window.state?.currentKpi) return String(window.state.currentKpi).toLowerCase();
    const sel = document.getElementById('indicatore');
    return sel?.value ? String(sel.value).toLowerCase() : 'cellule';
  }

  function getAliases(k) {
    const key = String(k).toLowerCase();
    if (window.KPI_ALIASES && KPI_ALIASES[key]) return KPI_ALIASES[key].map(s => String(s).toLowerCase());
    return [key];
  }

  function rowsForCurrent() {
    const az = getAzienda();
    const kpiSel = getKpi();

    // KPI derivato: rapporto grassi/proteine
    if (kpiSel === 'rapporto') {
      const fats = new Map();      // dateKey -> array di grassi
      const prots = new Map();     // dateKey -> array di proteine
      const src = Array.isArray(window.RAW) ? window.RAW : [];
      for (const r of src) {
        if (!r || !r.Data) continue;
        if (String(r.Azienda || '') !== az) continue;
        const k = String(r.KPI || '').toLowerCase();
        const v = Number(r.Valore);
        if (!isFinite(v)) continue;
        const d = new Date(r.Data);
        if (isNaN(+d)) continue;
        const key = d.toISOString().slice(0,10); // usa la data (yyyy-mm-dd)
        if (k === 'grassi' || k === 'fat' || k === '% fat') {
          if (!fats.has(key)) fats.set(key, { values: [], date: d });
          fats.get(key).values.push(v);
        } else if (k === 'proteine' || k === 'protein' || k === '% prot') {
          if (!prots.has(key)) prots.set(key, { values: [], date: d });
          prots.get(key).values.push(v);
        }
      }
      const out = [];
      for (const [key, g] of fats.entries()) {
        if (!prots.has(key)) continue;
        const p = prots.get(key);
        const gAvg = g.values.reduce((a,b)=>a+b,0) / g.values.length;
        const pAvg = p.values.reduce((a,b)=>a+b,0) / p.values.length;
        if (pAvg === 0 || !isFinite(gAvg) || !isFinite(pAvg)) continue;
        out.push({ date: g.date, value: gAvg / pAvg });
      }
      return out;
    }

    const aliases = getAliases(kpiSel);
    const src = Array.isArray(window.RAW) ? window.RAW : [];
    const out = [];
    for (const r of src) {
      if (!r || !r.Data) continue;
      if (String(r.Azienda || '') !== az) continue;
      const kpi = String(r.KPI || '').toLowerCase();
      if (!aliases.includes(kpi)) continue;
      const d = new Date(r.Data);
      const v = Number(r.Valore);
      if (!isFinite(v) || isNaN(+d)) continue;
      out.push({ date: d, value: v });
    }
    return out;
  }

  function groupByLactation(rows) {
    const map = new Map(); // label -> {startYear, points}
    for (const r of rows) {
      const lx = lactationFromDate(r.date);
      if (!map.has(lx.label)) map.set(lx.label, { startYear: lx.startYear, points: [] });
      //map.get(lx.label).points.push({ x: lx.x, y: r.value });
      map.get(lx.label).points.push({ x: lx.x, y: r.value, date: r.date });
    }
    for (const v of map.values()) v.points.sort((a,b)=>a.x-b.x);
    return map;
  }

  //--------

  // Ultime 3 lattazioni presenti nei DATI (ordinate asc: es. [2022, 2023, 2024])
function yearsFromData(byMap) {
  const ys = Array.from(byMap.values())
    .map(o => o.startYear)
    .filter((v,i,a) => a.indexOf(v) === i)
    .sort((a,b) => a - b);
  return ys.slice(-3);
}

// Crea 3 checkbox locali per gli anni passati (sempre visibili)
function buildYearBoxesForYears(years) {
  const host = document.getElementById('md-year-boxes');
  if (!host) return [];
  // salva stato precedente (se câ€™Ã¨)
  const prev = new Set(
    Array.from(host.querySelectorAll('input[type="checkbox"]'))
      .filter(i => i.checked)
      .map(i => Number(i.value))
  );

  const palette = ['#3b82f6', '#f59e0b', '#22c55e']; // blu, arancio, verde
  host.innerHTML = '';

  return years.map((yStart, idx) => {
    const id  = `md-yr${yStart}`;
    const lab = (typeof lactationLabel === 'function')
      ? lactationLabel(yStart)
      : `${yStart}-${String((yStart+1)%100).padStart(2,'0')}`;

    const wrap = document.createElement('label');
    wrap.className = 'select compact';
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '6px';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.id = id;
    chk.value = String(yStart);
    // ripristina spunte; se Ã¨ il primo render â†’ seleziona solo lâ€™ultima
    chk.checked = prev.size ? prev.has(yStart) : (yStart === Math.max(...years));

    const dot = document.createElement('span');
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '999px';
    dot.style.background = palette[idx] || '#64748b';
    dot.style.display = 'inline-block';
    dot.style.boxShadow = '0 0 0 1px rgba(0,0,0,.12) inset';

    const txt = document.createElement('span');
    txt.textContent = lab;

    wrap.appendChild(chk);
    wrap.appendChild(dot);
    wrap.appendChild(txt);
    host.appendChild(wrap);

    return { id, yStart };
  });
}



  //-------

  function lastThreeLabels(map) {
    return Array.from(map.entries())
      .map(([label,obj]) => ({label, startYear: obj.startYear}))
      .sort((a,b)=>b.startYear - a.startYear)
      .slice(0,3)
      .map(o => o.label);
  }


  /* 
  function buildYearBoxes(labels) {
    const host = document.getElementById('md-year-boxes');
    if (!host) return [];
    host.innerHTML = '';
    return labels.map(lab => {
      const y0 = parseInt(lab.split('-')[0], 10);
      const id = `md-${y0}`;
      const el = document.createElement('label');
      el.className = `select compact key-${y0}`;
      el.innerHTML = `<span class="swatch" style="background:${YEAR_COLORS[y0] || '#6366f1'}"></span>${lab}<input type="checkbox" id="${id}" checked style="display:none">`;
      host.appendChild(el);
      return { id, year: y0 };
    });
  }  */

    // === NUOVA buildYearBoxesFromApp ===
// Copiata dal KPI/Mediana: genera le 3 lattazioni [blu, arancio, verde]
function buildYearBoxesFromApp() {
  const host = document.getElementById('md-year-boxes');
  if (!host || !window.lastThreeLactations || !window.lactationLabel) return [];

 // ðŸ”¹ salva stato precedente (se esiste)
const prev = new Set(
   Array.from(host.querySelectorAll('input[type="checkbox"]'))
   .filter(i => i.checked)
     .map(i => Number(i.value))
  );


  const lacStarts = lastThreeLactations(); // es. [2023, 2024, 2025]
  const colors = {};
  colors[lacStarts[0]] = '#3b82f6'; // blu
  colors[lacStarts[1]] = '#f59e0b'; // arancio
  colors[lacStarts[2]] = '#22c55e'; // verde

  host.innerHTML = '';
  return lacStarts.map(yStart => {
    const id = `md-yr${yStart}`;
    const lab = lactationLabel(yStart);

    const wrap = document.createElement('label');
    wrap.className = 'select compact';
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '6px';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.id = id;
    chk.value = String(yStart);

    // seleziona di default solo l'ultima lattazione (la piÃ¹ recente)
    chk.checked = prev.size ? prev.has(yStart) : (yStart === Math.max(...lacStarts));

   
    //chk.checked = true;

    const dot = document.createElement('span');
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '999px';
    dot.style.background = colors[yStart] || '#64748b';
    dot.style.display = 'inline-block';
    dot.style.boxShadow = '0 0 0 1px rgba(0,0,0,.12) inset';

    const txt = document.createElement('span');
    txt.textContent = lab;

    wrap.appendChild(chk);
    wrap.appendChild(dot);
    wrap.appendChild(txt);
    host.appendChild(wrap);

    return { id, yStart };
  });
}

// restituisce Set degli anni selezionati
function activeYearsMD() {
  return new Set(
    Array.from(document.querySelectorAll('#md-year-boxes input[type="checkbox"]:checked'))
      .filter(i => i.checked)
      .map(i => Number(i.value))
  );
}




  function getActiveYears() {
    return new Set(
      Array.from(document.querySelectorAll('#md-year-boxes input[type="checkbox"]'))
        .filter(i => i.checked)
        .map(i => Number(i.id.replace('md-','')))
    );
  }

  // ---------- chart render ----------
  function render() {
    const canvas = document.getElementById('md-chart');
    if (!canvas) return;

    const rows = rowsForCurrent();
    const by = groupByLactation(rows);
    //const labs = lastThreeLabels(by);
    //const boxes = buildYearBoxes(labs);
    //const boxes = buildYearBoxesFromApp();
    const years = yearsFromData(by);
    const boxes = buildYearBoxesForYears(years);

    // collego i checkbox dopo che li ho creati
    setTimeout(() => {
      boxes.forEach(b => {
        const el = document.getElementById(b.id);
        if (el) el.addEventListener('change', () => draw(by));
      });
      draw(by);
    }, 0);
  }

  function draw(byMap) {
    const canvas = document.getElementById('md-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // distruggi eventuale chart associato a questo canvas (fix â€œCanvas is already in useâ€)
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    if (chart) { chart.destroy(); chart = null; }

    //const active = getActiveYears();
    const active = activeYearsMD();
    // Nessuna lattazione selezionata â†’ svuota il grafico e termina
    if (!active.size) {
      const canvas = document.getElementById('md-chart');
      if (canvas) {
       const existing = Chart.getChart(canvas);
        if (existing) {
          existing.data.datasets = [];
          existing.update();
        } else if (chart) {
         chart.data.datasets = [];
          chart.update();
        }
     }
     return;
    }


    

    const datasets = [];
   

    const entries = Array.from(byMap.entries()).sort((a,b)=>a[1].startYear - b[1].startYear);

    // Costruisco i colori a partire dalle lattazioni REALI presenti nei dati
    const ordered = Array.from(byMap.values())
    .map(o => o.startYear)
    .filter((v, i, a) => a.indexOf(v) === i)   // unici
    .sort((a, b) => a - b)                     // ascendente
    .slice(-3);                                // ultime 3

    const palette = ['#3b82f6', '#f59e0b', '#22c55e']; // blu, arancio, verde
    const colorFor = {};
    ordered.forEach((y, idx) => {
    colorFor[y] = palette[idx] || '#64748b';
    });


////

    for (const [label, obj] of entries) {
      if (active.size && !active.has(obj.startYear)) continue;
      datasets.push({
        label,
        data: obj.points,
        parsing: { xAxisKey: 'x', yAxisKey: 'y' },
       // borderColor: YEAR_COLORS[obj.startYear] || '#6366f1',
        borderColor: colorFor[obj.startYear] || '#64748b',

        backgroundColor: 'rgba(0,0,0,0)',
        tension: .25,
        pointRadius: 3,
        spanGaps: true,
      });
    }


    // usa le stesse unitÃ  di app.js
    const kpiSel = getKpi();
    const unit = (window.KPI_UNITS && KPI_UNITS[kpiSel]) || '';
    const limitLine = (kpiSel === 'cellule') ? 1500 : (kpiSel === 'carica' ? 500 : null);

        const options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: 'linear', min: 0, max: 12,
          ticks: { stepSize: 1, callback: v => Number.isInteger(v) ? MONTHS_LACT[v] : '' }
        },
        y: {
          beginAtZero: false,
          grace: '5%',
          title: { display: !!unit, text: unit }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title(items) {
              const d = new Date(items[0].raw.date);
              const dd = String(d.getDate()).padStart(2, '0');
              const mm = String(d.getMonth() + 1).padStart(2, '0');
              return `${dd}/${mm}`;
            },
            label(ctx) {
              const v = ctx.parsed.y;
              return `${v}`;
            }
          }
        }
      },
      elements: { line: { tension: .25 } }
    };

    // Annotazioni: linea limite per cellule/cbt e bande urea
    const annotations = {};
    if (limitLine != null) {
      annotations.limit = {
        type: 'line',
        yMin: limitLine,
        yMax: limitLine,
        borderColor: '#ef4444',
        borderWidth: 2,
        borderDash: [6, 4],
        label: {
          enabled: true,
          content: 'Limite ' + limitLine,
          position: 'end',
          backgroundColor: 'rgba(239,68,68,0.18)',
          color: '#ef4444'
        }
      };
    }
    if (kpiSel === 'urea') {
      const solid = {
        low: 'rgba(239,68,68,0.32)',        // <30 rosso più intenso
        green: 'rgba(34,197,94,0.18)',
        yellowLow: 'rgba(251,191,36,0.26)', // 30-36 giallo più visibile
        yellowHigh: 'rgba(251,191,36,0.26)',// 44-50 giallo più visibile
        high: 'rgba(239,68,68,0.32)'        // >50 rosso più intenso
      };
      const grad = (ctx, from, to) => {
        const area = ctx?.chart?.chartArea;
        const canvas = ctx?.chart?.ctx;
        if (!area || !canvas) return to;
        const g = canvas.createLinearGradient(0, area.bottom, 0, area.top);
        g.addColorStop(0, from);
        g.addColorStop(1, to);
        return g;
      };
      const clamp = (ctx, v) => {
        const s = ctx?.chart?.scales?.y;
        if (!s) return v;
        if (v < s.min) return s.min;
        if (v > s.max) return s.max;
        return v;
      };

      annotations.ureaLow = {
        type: 'box',
        yMin: (ctx) => clamp(ctx, 0),
        yMax: (ctx) => clamp(ctx, 30),
        backgroundColor: solid.low,
        borderWidth: 0
      };
      annotations.ureaMidLow = {
        type: 'box',
        yMin: (ctx) => clamp(ctx, 30),
        yMax: (ctx) => clamp(ctx, 36),
        backgroundColor: (ctx) => grad(ctx, 'rgba(239,68,68,0.32)', solid.yellowLow),
        borderWidth: 0
      };
      annotations.ureaMid = {
        type: 'box',
        yMin: (ctx) => clamp(ctx, 36),
        yMax: (ctx) => clamp(ctx, 44),
        backgroundColor: solid.green,
        borderWidth: 0
      };
      annotations.ureaMidHigh = {
        type: 'box',
        yMin: (ctx) => clamp(ctx, 44),
        yMax: (ctx) => clamp(ctx, 50),
        backgroundColor: solid.yellowHigh, // fascia 44-50 resta gialla
        borderWidth: 0
      };
      annotations.ureaHigh = {
        type: 'box',
        yMin: (ctx) => clamp(ctx, 50),
        yMax: (ctx) => clamp(ctx, Number.POSITIVE_INFINITY),
        backgroundColor: solid.high,
        borderWidth: 0
      };
    } else if (kpiSel === 'rapporto') {
      // banda verde 1.0-1.4, rosso fuori; etichette di rischio
      const clamp = (ctx, v) => {
        const s = ctx?.chart?.scales?.y;
        if (!s) return v;
        if (v < s.min) return s.min;
        if (v > s.max) return s.max;
        return v;
      };
      annotations.ratioLow = {
        type: 'box',
        yMin: (ctx) => clamp(ctx, ctx?.chart?.scales?.y?.min ?? Number.NEGATIVE_INFINITY),
        yMax: (ctx) => clamp(ctx, 1),
        backgroundColor: 'rgba(239,68,68,0.25)',
        borderWidth: 0,
        label: {
          display: true,
          content: 'Rischio subacidosi',
          position: 'center',
          color: '#fff',
          backgroundColor: 'rgba(239,68,68,0.65)',
          font: { size: 12, weight: '600' }
        }
      };
      annotations.ratioMid = {
        type: 'box',
        yMin: (ctx) => clamp(ctx, 1),
        yMax: (ctx) => clamp(ctx, 1.4),
        backgroundColor: 'rgba(34,197,94,0.18)',
        borderWidth: 0
      };
      annotations.ratioHigh = {
        type: 'box',
        yMin: (ctx) => clamp(ctx, 1.4),
        yMax: (ctx) => clamp(ctx, ctx?.chart?.scales?.y?.max ?? Number.POSITIVE_INFINITY),
        backgroundColor: 'rgba(239,68,68,0.25)',
        borderWidth: 0,
        label: {
          display: true,
          content: 'Rischio Ketosi',
          position: 'center',
          color: '#fff',
          backgroundColor: 'rgba(239,68,68,0.65)',
          font: { size: 12, weight: '600' }
        }
      };
    }
    options.plugins.annotation = { annotations };

    chart = new Chart(ctx, { type: 'line', data: { datasets }, options });
  }

  // ---------- wiring ----------

  // Gestione dinamica dell'opzione "rapporto" solo in vista Performance
  const RATIO_VALUE = 'rapporto';
  function ensureRatioOption() {
    const sel = document.getElementById('indicatore');
    if (!sel) return;
    const exists = sel.querySelector(`option[value="${RATIO_VALUE}"]`);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = RATIO_VALUE;
      opt.textContent = 'Rapporto grassi/proteine';
      // inserisci in fondo ai KPI
      sel.appendChild(opt);
    }
  }
  function removeRatioOption() {
    const sel = document.getElementById('indicatore');
    if (!sel) return;
    const exists = sel.querySelector(`option[value="${RATIO_VALUE}"]`);
    if (exists) exists.remove();
    if (sel.value === RATIO_VALUE) {
      sel.value = 'grassi';
      sel.dispatchEvent(new Event('change'));
    }
  }
  function bind() {
    if (bound) return; // evita doppi binding
    bound = true;

    const miei = document.getElementById('miei-dati');
    const conf = document.getElementById('confronto');
    const toggle = document.getElementById('viewToggle');

    // quando entri in "Miei dati" disegna
    if (miei) miei.addEventListener('change', () => {
      if (miei.checked)  {
        ensureRatioOption();
        if (toggle) toggle.dataset.active = 'miei'; 
        setTimeout(render, 0);
      }
    });

    // cambio KPI esterno
    const sel = document.getElementById('indicatore');
    if (sel) sel.addEventListener('change', () => {
      if (document.getElementById('view-miei')?.classList.contains('active')) render();
    });

    // osserva cambio azienda (se lâ€™header cambia testo)
    const hdr = document.getElementById('aziendaHeader');
    if (hdr && 'MutationObserver' in window) {
      const mo = new MutationObserver(() => {
        if (document.getElementById('view-miei')?.classList.contains('active')) render();
      });
      mo.observe(hdr, { childList:true, characterData:true, subtree:true });
    }

    // piccolo polling per catturare cambi di state.azienda / currentKpi fuori dal DOM
    setInterval(() => {
      const sig = `${getAzienda()}|${getKpi()}|${document.getElementById('view-miei')?.classList.contains('active')}|${(window.RAW||[]).length}`;
      if (sig !== lastSig) {
        lastSig = sig;
        if (document.getElementById('view-miei')?.classList.contains('active')) render();
      }
    }, 600);

    // se allâ€™avvio la vista Ã¨ giÃ  attiva, disegna
    const active = document.getElementById('viewToggle')?.dataset?.active === 'miei';
    if (active) { ensureRatioOption(); render(); } else { removeRatioOption(); }

    if (conf) conf.addEventListener('change', () => {
      if (conf.checked && toggle) toggle.dataset.active = 'conf';
      if (conf.checked) {
        const sel = document.getElementById('indicatore');
        const wasRatio = sel && sel.value === RATIO_VALUE;
        if (wasRatio) {
          // rientro in benchmark: porta il KPI a grassi e resetta il periodo alla lattazione più recente
          if (typeof didInitialLacAutoSelect !== 'undefined') {
            didInitialLacAutoSelect = false; // forzare auto-selezione ultima lattazione
          }
          sel.value = 'grassi';
          sel.dispatchEvent(new Event('change'));
          removeRatioOption();
          if (typeof rebuildLactationMenu === 'function') {
            rebuildLactationMenu(false); // forza ultima lattazione disponibile
          }
          const presetEl = document.getElementById('distPreset');
          if (presetEl) {
            // seleziona esplicitamente l'ultima lattazione disponibile (escludendo "custom")
            const lacOptions = Array.from(presetEl.options).filter(o => o.value.startsWith('lac:'));
            if (lacOptions.length) {
              const last = lacOptions[lacOptions.length - 1];
              presetEl.value = last.value;
              if (window.state) window.state.histPeriod = { type: 'lactation', start: Number(last.value.replace('lac:','')) };
            }
            presetEl.dispatchEvent(new Event('change'));
          }
          return;
        }
        removeRatioOption();
      }
    });


  }

  function waitRaw(tries=200) {
    if (Array.isArray(window.RAW) && window.RAW.length) { bind(); return; }
    if (tries <= 0) { bind(); return; }
    setTimeout(() => waitRaw(tries - 1), 80);
  }

  window.addEventListener('DOMContentLoaded', waitRaw);
})();

