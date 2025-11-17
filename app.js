// ================== APPÀRE - Charts Logic (stable Y-width align) ==================

// ---- Config & constants ----
const KPI_ALIASES = {
  cellule:   ['cellule','scc','cellule somatiche','cellule somatiche (scc)'],
  carica:    ['carica','cbt','carica batterica','carica batterica (cbt)'],
  urea:      ['urea'],
  grassi:    ['grassi','fat','% fat'],
  proteine:  ['proteine','protein','% prot']
};
const KPI_UNITS = { cellule:'cell/mL', carica:'UFC/mL', urea:'mg/dL', grassi:'%', proteine:'%' };
const LAC_MONTHS_IT = ['Ott','Nov','Dic','Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set'];

window.KPI_UNITS = KPI_UNITS; // aggiunta per mieiDati.js


// ---- App state ----
var state = { currentLacStart: null, currentKpi: 'cellule', azienda: 'GOIA SILVIA', histPeriod: { type:'months', value:12 } };
var RAW = [];
var prChart, kpiChart, histChart;
var didInitialLacAutoSelect = false;   // per selezionare di default l'ultima lattazione SOLO una volta all'avvio


// ---- Filtro benchmark: IntraAppare vs IntraCaseificio ----
function getBenchmarkRaw(){
  // Dataset di base: tutti i record caricati
  var base = Array.isArray(RAW) ? RAW : [];
  if (!base.length) return base;

  // Prima selezione: tipo di benchmark (IntraAppare / IntraCaseificio / Regione)
  var sel = document.getElementById('benchmarkType');
  var mode = sel && sel.value ? sel.value : 'intraAppare';

  var working = base;

  // Modalità IntraCaseificio → sottoinsieme con stesso caseificio dell'azienda selezionata
  if (mode === 'intraCaseificio') {
    var azCase = state && state.azienda ? state.azienda : null;
    if (azCase) {
      var caseificio = null;
      for (var i = 0; i < base.length; i++) {
        var r0 = base[i];
        if (r0 && r0.Azienda === azCase && r0.Caseificio) {
          caseificio = r0.Caseificio;
          break;
        }
      }
      if (caseificio) {
        working = base.filter(function(r){
          return r && r.Caseificio === caseificio;
        });
      }
    }
  }
  // modalità 'intraAppare' e 'regione' per ora usano tutto il dataset 'base'
  // (in futuro 'regione' potrà includere anche dati extra-Laore)

  // Seconda selezione: filtro provincia (solo sul gruppo di confronto, non sull'azienda selezionata)
  var provSel = document.getElementById('provinciaFilter');
  var provVal = provSel && provSel.value ? provSel.value : 'tutte';
  if (provVal !== 'tutte') {
    var provName = null;
    if (provVal === 'sassari')      provName = 'Sassari';
    else if (provVal === 'nuoro')   provName = 'Nuoro';
    else if (provVal === 'oristano')provName = 'Oristano';
    else if (provVal === 'cagliari')provName = 'Cagliari';

    if (provName) {
      working = working.filter(function(r){
        return r && r.Provincia === provName;
      });
    }
  }

  // Aggiungiamo SEMPRE i record dell'azienda selezionata,
  // anche se non rientrano nel filtro di provincia, così l'allevatore
  // vede sempre la propria serie confrontata con il gruppo scelto.
  var az = state && state.azienda ? state.azienda : null;
  if (!az) return working;

  var hasAz = false;
  for (var j = 0; j < working.length; j++) {
    var r1 = working[j];
    if (r1 && r1.Azienda === az) {
      hasAz = true;
      break;
    }
  }
  if (hasAz) return working;

  // Unione: gruppo filtrato + tutte le osservazioni della propria azienda
  var azRows = base.filter(function(r){
    return r && r.Azienda === az;
  });

  return working.concat(azRows);

  
}



// ==== Lock larghezza sinistra per KPI ====
let _leftLockWidth = 0; // in px, larghezza "asse Y + padding" target

// ---- Utility ----
function lowerIsBetter(k){ return (k==='cellule' || k==='carica'); }
function isLogKPI(k){ return (k==='cellule' || k==='carica'); }
function aggArithmetic(values){ var s=0,n=0; for (var v of values){ if (isFinite(v)){ s+=v; n++; } } return n? s/n : null; }
function aggGeometric(values){ var s=0,n=0; for (var v of values){ if (isFinite(v)&&v>0){ s+=Math.log(v); n++; } } return n? Math.exp(s/n) : null; }


function rowsForKpi(raw, k){
  var aliases = KPI_ALIASES[k] || [k]; var out=[];
  for (var r of raw){
    if (aliases.indexOf(String(r.KPI).toLowerCase()) !== -1){
      var y=+r.Anno, m=(+r.Mese)-1, v=+r.Valore;
      if (isFinite(v) && !isNaN(y) && !isNaN(m)) out.push({ Azienda:r.Azienda, year:y, month:m, value:v });
    }
  }
  return out;
}

// Aggiorna il testo "confronto su X aziende" sopra il grafico PR
function updateBenchmarkCountLabel(rows){
  var el = document.getElementById('benchmarkCount');
  if (!el) return;

  // Conta quante aziende diverse compaiono nel dataset usato per il benchmark
  var set = new Set();
  if (Array.isArray(rows)) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r && r.Azienda) set.add(String(r.Azienda));
    }
  }
  var n = set.size;

  if (!n) {
    // Nessun dato: non mostriamo niente
    el.textContent = '';
  } else if (n === 1) {
    // Sei da solo nel gruppo
    el.textContent = '– al momento sei l\'unica azienda nel gruppo di confronto';
  } else {
    // Gruppo con più aziende
    el.textContent = '– confronto su ' + n + ' aziende';
  }
}



function updateCaseificioLabel(){
  var el = document.getElementById('caseificioLabel');
  if (!el) return;

  var modeSel = document.getElementById('benchmarkType');
  var mode = modeSel && modeSel.value ? modeSel.value : 'intraAppare';

  // Mostriamo il caseificio solo in modalità IntraCaseificio
  if (mode !== 'intraCaseificio') {
    el.textContent = '';
    return;
  }

  var az = state && state.azienda ? state.azienda : null;
  if (!az || !Array.isArray(RAW) || !RAW.length) {
    el.textContent = '';
    return;
  }

  var caseificio = null;
  for (var i = 0; i < RAW.length; i++) {
    var r = RAW[i];
    if (r && r.Azienda === az && r.Caseificio) {
      caseificio = r.Caseificio;
      break;
    }
  }

  if (caseificio) {
    el.textContent = 'Caseificio: ' + caseificio;
  } else {
    el.textContent = '';
  }
}






function monthlyAggregate(rawRows, kpi){
  var byKey = new Map(); var useGeo = isLogKPI(kpi);
  for (var r of rawRows){
    var key = r.year+'|'+r.month+'|'+r.Azienda;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r.value);
  }
  var out=[];
  byKey.forEach((vals,keyStr)=>{
    var [y,m,az] = keyStr.split('|'); y=+y; m=+m;
    var agg = useGeo ? aggGeometric(vals) : aggArithmetic(vals);
    if (agg!=null) out.push({Azienda:az, year:y, month:m, value:agg});
  });
  return out;
}
function percentileRank(arr,v){
  var nums = arr.filter(x=>typeof x==='number'&&!isNaN(x)).sort((a,b)=>a-b);
  if (!nums.length || typeof v!=='number' || isNaN(v)) return null;
  var count=0, ties=0;
  for (var x of nums){ if (x < v) count++; else if (x===v) ties++; }
  return Math.round(((count + 0.5*ties)/nums.length)*100);
}
function median(arr){
  var a = arr.filter(x=>isFinite(x)).sort((x,y)=>x-y);
  var n=a.length; if (!n) return null;
  var m=Math.floor(n/2); return (n%2)? a[m] : (a[m-1]+a[m])/2;
}

// ---- YM cache ----
var cache = { ymByKpi: new Map() };
function getYMMap(kpiRows,kpiKey){
  var key = kpiKey;
  if (cache.ymByKpi.has(key)) return cache.ymByKpi.get(key);
  var agg = monthlyAggregate(kpiRows, key);
  var m = new Map();
  for (var r of agg){
    var mapKey = r.year+'-'+r.month;
    if (!m.has(mapKey)) m.set(mapKey, {year:r.year, month:r.month, by:new Map()});
    m.get(mapKey).by.set(r.Azienda, r.value);
  }
  cache.ymByKpi.set(key,m);
  return m;
}

// ---- Lattazioni (ultime 3) ----
function todayY(){ return new Date().getFullYear(); }
function todayM(){ return new Date().getMonth(); } // 0..11
function currentLactationStart(){ const m=todayM(), y=todayY(); return (m>=9)? y : (y-1); }
function lastThreeLactations(){ const s=currentLactationStart(); return [s-2, s-1, s]; }
function lactationLabel(yStart){ const yEnd = (yStart+1).toString().slice(-2); return `${yStart}-${yEnd}`; }
function lacPosFromMonth(m){ return (m + 3) % 12; } // Ott(9)->0 ... Set(8)->11

// fix ultime lattazioni variabili in base ai dati aziendali

// Ultime 3 lattazioni presenti nei DATI per l'azienda corrente (lattazione Ott→Set)
function getLactationStartsFromRows(rows) {
  const set = new Set();
  const az = state.azienda;
  for (const r of rows) {
    if (!r || r.Azienda !== az) continue;
    const y = r.year;
    const m = r.month; // 0..11
    if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
    // Lattazione: Ott(9)–Dic(11) → anno stesso, Gen(0)–Set(8) → anno-1
    const yStart = (m >= 9) ? y : (y - 1);
    set.add(yStart);
  }
  // ordina e prendi le ultime 3
  return Array.from(set).sort((a, b) => a - b).slice(-3);
}






// ---- Charts ----
var HoverLine = { id:'hoverLine', afterDatasetsDraw(chart){ const a=chart.getActiveElements(); if(!a||!a.length) return;
  const ca=chart.chartArea, y=a[0].element.y, ctx=chart.ctx; ctx.save(); ctx.beginPath(); ctx.moveTo(ca.left,y); ctx.lineTo(ca.right,y);
  ctx.lineWidth=1; ctx.strokeStyle='rgba(51,65,85,0.8)'; ctx.setLineDash([4,4]); ctx.stroke(); ctx.restore(); } };
Chart.register(window['chartjs-plugin-annotation'], HoverLine);

function ensureCharts(){
  prChart = new Chart(document.querySelector('#prChartHost canvas').getContext('2d'), {
    type:'line',
    data:{ labels:LAC_MONTHS_IT, datasets:[] },
    options:{
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, animation:{duration:0},
      scales:{ 
        x:{type:'category', labels:LAC_MONTHS_IT}, 
        y:{min:0, max:100, ticks:{stepSize:20}},
        // PAD FITTIZIO (legge chart.__padLeft)
        padL:{ 
          position:'left',
          grid:{display:false, drawTicks:false},
          ticks:{display:false},
          display:true,
          afterFit:(scale)=>{ scale.width = (scale && scale.chart && scale.chart.__padLeft) || 0; }
        }
      },
      plugins:{ 
        legend:{display:false}, 
        tooltip:{enabled:true},
        annotation:{ annotations:{
          low:{type:'box', yMin:0, yMax:24, backgroundColor:'rgba(239,68,68,.12)', borderWidth:0},
          mid:{type:'box', yMin:25, yMax:74, backgroundColor:'rgba(245,158,11,.12)', borderWidth:0},
          high:{type:'box', yMin:75, yMax:100, backgroundColor:'rgba(34,197,94,.12)', borderWidth:0},
          t40:{type:'line', yMin:25, yMax:25, borderColor:'rgba(15,23,42,.35)', borderDash:[6,6], borderWidth:1},
          t75:{type:'line', yMin:75, yMax:75, borderColor:'rgba(15,23,42,.35)', borderDash:[6,6], borderWidth:1},
          medianLine:{type:'line', yMin:50, yMax:50, borderColor:'rgba(220,38,38,0.95)', borderWidth:1.5, borderDash:[4,2],
            label:{display:true, content:'Mediana (50%)', position:'end', color:'#dc2626', font:{weight:'bold', size:10}}}
        }}
      },
      elements:{ line:{tension:.3}, point:{radius:3} }
    }
  });

  kpiChart = new Chart(document.querySelector('#kpiChartHost canvas').getContext('2d'), {
    type:'line',
    data:{ labels:LAC_MONTHS_IT, datasets:[] },
    options:{
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, animation:{duration:0},
      scales:{ 
        x:{type:'category', labels:LAC_MONTHS_IT}, 
        y:{ beginAtZero:false, grace:'5%', title:{display:false, text:''} },
        padL:{ 
          position:'left',
          grid:{display:false, drawTicks:false},
          ticks:{display:false},
          display:true,
          afterFit:(scale)=>{ scale.width = (scale && scale.chart && scale.chart.__padLeft) || 0; }
        }
      },
      plugins:{ legend:{display:false}, tooltip:{enabled:true}, annotation:{annotations:{}} },
      elements:{ line:{tension:.3}, point:{radius:3} }
    }
  });

  histChart = new Chart(document.querySelector('#histChartHost canvas').getContext('2d'), {
    type:'bar',
    data:{ datasets:[{label:'Frequenza %', data:[], parsing:{xAxisKey:'x', yAxisKey:'y'}, backgroundColor:'rgba(2,132,199,.25)', borderColor:'#0284c7'}] },
    options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, animation:{duration:0},
      scales:{ x:{type:'linear', title:{display:false, text:''}}, y:{beginAtZero:true, ticks:{callback:v=>v+'%'}} },
      plugins:{ legend:{display:false}, tooltip:{enabled:true}, annotation:{annotations:{}} }
    }
  });
}

// ===== Allineamento robusto per larghezza asse Y =====
function equalizeByYAxisWidth(){
  if (!prChart || !kpiChart) return;
  const prY   = prChart.scales && prChart.scales.y;
  const kpiY  = kpiChart.scales && kpiChart.scales.y;
  if (!prY || !kpiY) return;

  // Larghezza effettiva degli assi Y (in px)
  const wPR  = prY.width  || 0;
  const wKPI = kpiY.width || 0;

  // Target: il max tra i due e il "lock" corrente (non si restringe finché resti nello stesso KPI)
  const target = Math.max(_leftLockWidth || 0, wPR, wKPI);
  _leftLockWidth = target;

  // Assegna il pad fittizio necessario a OGNUNO per raggiungere il target
  prChart.__padLeft  = Math.max(0, target - wPR);
  kpiChart.__padLeft = Math.max(0, target - wKPI);

  // Aggiorna senza animazione
  prChart.update('none');
  kpiChart.update('none');
}

// 2 RAF per aspettare layout/ticks → misuro → applico pad → ricalcolo
let _syncA=null,_syncB=null;
function scheduleSync(){
  if (_syncA) cancelAnimationFrame(_syncA);
  if (_syncB) cancelAnimationFrame(_syncB);
  _syncA = requestAnimationFrame(()=>{
    _syncB = requestAnimationFrame(()=>{ equalizeByYAxisWidth(); });
  });
}

// ---- Legenda HTML (continua/tratteggiata) a destra del titolo KPI ----
function ensureKpiStyleLegend(){
  const host = document.getElementById('kpiChartHost');
  const head = host ? host.previousElementSibling : null;
  if (!head) return;

  const oldColored = head.querySelector('.legend'); if (oldColored) oldColored.remove();
  const oldSimple  = head.querySelector('#kpiLegendSimple'); if (oldSimple) oldSimple.remove();

  head.style.display = 'flex';
  head.style.alignItems = 'center';
  head.style.gap = head.style.gap || '12px';

  const title = head.querySelector('.card-title');
  if (!title) return;

  const medianWrap = document.getElementById('showMedian')?.parentElement || null;

  const legend = document.createElement('div');
  legend.id = 'kpiLegendSimple';
  legend.style.display = 'inline-flex';
  legend.style.alignItems = 'center';
  legend.style.gap = '14px';
  legend.style.fontSize = '12px';
  legend.style.color = '#334155';

  function item(label, dashed){
    const w = document.createElement('span');
    w.style.display = 'inline-flex';
    w.style.alignItems = 'center';
    w.style.gap = '6px';
    const ln = document.createElement('span');
    ln.style.display = 'inline-block';
    ln.style.width = '28px';
    ln.style.height = '0';
    ln.style.borderTop = dashed ? '2px dashed currentColor' : '2px solid currentColor';
    const tx = document.createElement('span'); tx.textContent = label;
    w.appendChild(ln); w.appendChild(tx);
    return w;
  }
  legend.appendChild(item('Azienda', false));
  legend.appendChild(item('Mediana (altre aziende)', true));

  if (medianWrap) head.insertBefore(legend, medianWrap); else head.appendChild(legend);
}


// ---- Selettore AZIENDA (dinamico dal RAW) ----
function ensureAziendaSelector(){
  try{
    // 1) Trova il contenitore *esterno ai grafici* dove prima c'era la label "Goia Silvia"
    //    Tentativi in ordine: id noto, data-role, classi comuni, poi fallback a match testuale esatto.
    function findLabelHost(){
      const idCandidates = ['aziendaLabel','aziendaTitle','aziendaName','aziendaBadge'];
      for (const id of idCandidates){
        const el = document.getElementById(id);
        if (el) return el;
      }
      const role = document.querySelector('[data-role="azienda-label"]');
      if (role) return role;
      const cls = document.querySelector('.azienda-label, .aziendaName, .azienda, .az-label');
      if (cls) return cls;
      // Fallback: primo heading/span/div che contenga esattamente il nome corrente
      const pool = document.querySelectorAll('h1,h2,h3,h4,span,strong,div');
      for (const el of pool){
        const t = (el.textContent || '').trim();
        if (t === state.azienda) return el;
      }
      // Fallback finale: barra superiore se presente
      const topbar = document.getElementById('topbar') || document.querySelector('.topbar,.header,.toolbar');
      if (topbar) return topbar;
      return null;
    }

    const host = findLabelHost();
    if (!host) return;

    // 2) Crea o recupera il <select>
    let sel = document.getElementById('aziendaSelect');
    if (!sel){
      sel = document.createElement('select');
      sel.id = 'aziendaSelect';
      sel.style.fontSize = '13px';
      sel.style.padding = '4px 8px';
      sel.style.border = '1px solid #cbd5e1';
      sel.style.borderRadius = '8px';
      sel.style.background = '#fff';
      sel.style.color = '#0f172a';
      sel.title = 'Seleziona azienda';

      // Se l'host conteneva solo il testo "Goia Silvia", lo sostituiamo con un wrapper label+select
      const wrap = document.createElement('span');
      wrap.style.display = 'inline-flex';
      wrap.style.gap = '8px';
      wrap.style.alignItems = 'center';

      // Prova a capire se era solo testo o c'erano altri nodi
      const hadOnlyText = host.childNodes.length === 1 && host.firstChild && host.firstChild.nodeType === 3;
      if (hadOnlyText){
        const lab = document.createElement('span');
        lab.textContent = 'Azienda:';
        lab.style.fontWeight = '600';
        lab.style.color = '#334155';
        wrap.appendChild(lab);
        wrap.appendChild(sel);
        host.textContent = '';
        host.appendChild(wrap);
      } else {
        // Altrimenti, inseriamo il select subito dopo il primo nodo (lasciando eventuali icone/testi)
        host.appendChild(sel);
        host.style.display = host.style.display || 'inline-flex';
        host.style.gap = host.style.gap || '8px';
        host.style.alignItems = host.style.alignItems || 'center';
      }
    }

    // 3) Popola aziende uniche da RAW
    const set = new Set();
    for (const r of RAW){ if (r && r.Azienda) set.add(String(r.Azienda)); }
    const list = Array.from(set).sort((a,b)=>a.localeCompare(b,'it',{sensitivity:'base'}));

    // Mantieni selezione corrente se possibile
    const current = state.azienda && list.includes(state.azienda) ? state.azienda : (list[0] || state.azienda);
    state.azienda = current;

    // Ricostruisci options solo se differiscono
    const existing = Array.from(sel.options).map(o=>o.value);
    const same = existing.length===list.length && existing.every((v,i)=>v===list[i]);
    if (!same){
      sel.innerHTML = '';
      for (const name of list){
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      }
    }
    sel.value = state.azienda;

    // 4) Change handler
    if (!sel._bound){
      sel.addEventListener('change', ()=>{
        state.azienda = sel.value;
        updateCaseificioLabel();
        // 🔹 FIX: la mappa YM dipende anche dai filtri + azienda, quindi va svuotata
            if (cache && cache.ymByKpi && cache.ymByKpi.clear) {
            cache.ymByKpi.clear();
            }

        const rows = rowsForKpi(getBenchmarkRaw(), state.currentKpi);
        updateBenchmarkCountLabel(rows);
        updatePR(rows); 
        updateKPI(rows); 
        updateHistogram(rows);
        scheduleSync();
        
        
      });
      sel._bound = true;
    }
  }catch(e){ console.warn('ensureAziendaSelector error', e); }
}



// ---- Update routines ----
function updatePR(rows){

  const by = getYMMap(rows, state.currentKpi);

  // --- Lattazioni REALI dai dati dell'AZIENDA corrente (Ott→Set) ---
  const lacStarts = getLactationStartsFromRows(rows); // es. [2022, 2023, 2024]
  const palette = ['#3b82f6', '#f59e0b', '#22c55e'];

  /*
    const by = getYMMap(rows, state.currentKpi);

  // --- Lattazioni REALI dai dati (come in mieiDati) ---
  const lacSet = new Set();
  for (const obj of by.values()) {
    const y = obj.year;
    const m = obj.month;           // 0..11
    const yStart = (m >= 9) ? y : (y - 1);  // Ott-Dic -> y, Gen-Set -> y-1
    if (Number.isFinite(yStart)) lacSet.add(yStart);
  }
  const lacStarts = Array.from(lacSet).sort((a,b)=>a-b).slice(-3); // ultime 3
  const palette = ['#3b82f6', '#f59e0b', '#22c55e'];
   */



  // Mappa checkbox fisse -> lattazioni presenti
  const ids = ['yr2023','yr2024','yr2025'];
  const map = ids.map((id, idx) => [id, lacStarts[idx]]);

  const colors = {};
  lacStarts.forEach((y, idx) => { colors[y] = palette[idx] || '#64748b'; });

  // --- Aggiorna label, colore e visibilità delle checkbox ---
  map.forEach(([id, yStart])=>{
    const inp = document.getElementById(id);
    let lab = document.querySelector(`label[for="${id}"]`);
    if (!lab && inp && inp.parentElement && inp.parentElement.tagName.toLowerCase()==='label'){
      lab = inp.parentElement;
    }

    if (!yStart || !inp || !lab) {
      // Nessuna lattazione associata → nascondi / disabilita
      if (lab) lab.style.display = 'none';
      if (inp) { inp.checked = false; inp.disabled = true; }
      const labSpan = document.getElementById(id+'Lbl');
      if (labSpan) labSpan.textContent = '';
      return;
    }

    // Lattazione valida → mostra e abilita
    inp.disabled = false;
    lab.style.display = 'inline-flex';
    lab.style.alignItems = 'center';
    lab.style.gap = '6px';

    const labelTxt = lactationLabel(yStart);
    const color = colors[yStart] || '#64748b';

    const labSpan = document.getElementById(id+'Lbl');
    if (labSpan) labSpan.textContent = labelTxt;

    const old = lab.querySelector('[data-role="lac-swatch"]'); if (old) old.remove();
    const dot = document.createElement('span');
    dot.setAttribute('data-role','lac-swatch');
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '999px';
    dot.style.background = color;
    dot.style.display = 'inline-block';
    dot.style.boxShadow = '0 0 0 1px rgba(0,0,0,.12) inset';

    const first = lab.firstElementChild;
    if (inp && first === inp){ inp.insertAdjacentElement('afterend', dot); } else { lab.insertBefore(dot, lab.firstChild); }
  });

      // --- Se è il primissimo render con dati, seleziona di default SOLO l'ultima lattazione disponibile ---
  if (!didInitialLacAutoSelect) {
    const available = map.filter(([id, y]) => Number.isFinite(y));
    if (available.length) {
      // Spegni tutte le checkbox disponibili
      available.forEach(([id])=>{
        const el = document.getElementById(id);
        if (el && !el.disabled) el.checked = false;
      });
      // Accendi solo l'ultima lattazione (più recente)
      const [lastId] = available[available.length - 1];
      const lastEl = document.getElementById(lastId);
      if (lastEl && !lastEl.disabled) lastEl.checked = true;

      didInitialLacAutoSelect = true;
    }
  }




  // --- Lattazioni selezionate (solo quelle con anno valido) ---
  const selected = map
    .filter(([id, y])=>{
      if (!Number.isFinite(y)) return false;
      const el = document.getElementById(id);
      return el && el.checked && !el.disabled;
    })
    .map(([id,y])=>y);

  const trans = v => v; // niente inversione, crescita verso l'alto

  const ds = [];
  for (const y of selected){
    const arr = new Array(12).fill(null);
    for (let m=9;m<=11;m++){
      const b = by.get(`${y}-${m}`); if (!b) continue;
      const vals = Array.from(b.by.values()).map(trans);
      const vAzi = b.by.get(state.azienda); const tv = (vAzi!=null)? trans(vAzi) : null;
      arr[lacPosFromMonth(m)] = percentileRank(vals, tv);
    }
    for (let m=0;m<=8;m++){
      const b = by.get(`${y+1}-${m}`); if (!b) continue;
      const vals = Array.from(b.by.values()).map(trans);
      const vAzi = b.by.get(state.azienda); const tv = (vAzi!=null)? trans(vAzi) : null;
      arr[lacPosFromMonth(m)] = percentileRank(vals, tv);
    }
    ds.push({
      label: lactationLabel(y),
      data: arr,
      borderColor: colors[y] || '#64748b',
      backgroundColor: (colors[y] || '#64748b')+'22',
      spanGaps:true,
      _lacStart:y
    });
  }

  prChart.data.labels = LAC_MONTHS_IT;
  prChart.data.datasets = ds;

  // --- Sfondo PR: solo colori delle bande, come prima ---
  {
    const isLower = lowerIsBetter(state.currentKpi);
    const annRoot = prChart.options?.plugins?.annotation;
    const ann = annRoot?.annotations;
    if (ann && ann.low && ann.mid && ann.high) {
      ann.low.backgroundColor  = isLower ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';
      ann.mid.backgroundColor  = 'rgba(245,158,11,0.12)';
      ann.high.backgroundColor = isLower ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)';
    }
  }

  prChart.update('none');
  scheduleSync();
}


function updateKPI(rows){

  const by = getYMMap(rows, state.currentKpi);

  // --- Lattazioni REALI dai dati dell'AZIENDA corrente (coerenti con updatePR) ---
  const lacStarts = getLactationStartsFromRows(rows);
  const palette = ['#3b82f6', '#f59e0b', '#22c55e'];
  const ids = ['yr2023','yr2024','yr2025'];
  const map = ids.map((id, idx) => [id, lacStarts[idx]]);

  
  
  /*
  const by = getYMMap(rows, state.currentKpi);

  // --- Lattazioni REALI dai dati (coerenti con updatePR) ---
  const lacSet = new Set();
  for (const obj of by.values()) {
    const y = obj.year;
    const m = obj.month;
    const yStart = (m >= 9) ? y : (y - 1);
    if (Number.isFinite(yStart)) lacSet.add(yStart);
  }
  const lacStarts = Array.from(lacSet).sort((a,b)=>a-b).slice(-3);
  const palette = ['#3b82f6', '#f59e0b', '#22c55e'];
  const ids = ['yr2023','yr2024','yr2025'];
  const map = ids.map((id, idx) => [id, lacStarts[idx]]);
  
   */

  const colorFor = {};
  lacStarts.forEach((y, idx) => { colorFor[y] = palette[idx] || '#64748b'; });

  const selected = map
    .filter(([id,y])=>{
      if (!Number.isFinite(y)) return false;
      const el = document.getElementById(id);
      return el && el.checked && !el.disabled;
    })
    .map(([_,y])=>y);


  



   /*
  // Toggle "Mostra mediana"
  let medianToggle = document.getElementById('showMedian');
  if (!medianToggle){
    const hostHead = document.getElementById('kpiChartHost')?.previousElementSibling;
    if (hostHead){
      const wrap = document.createElement('label');
      wrap.style.marginLeft = 'auto';
      wrap.style.fontSize = '13px';
      wrap.style.display = 'inline-flex';
      wrap.style.gap = '6px';
      wrap.style.alignItems = 'center';
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.id = 'showMedian'; chk.checked = true;
      const txt = document.createElement('span'); txt.textContent = 'Mostra mediana';
      wrap.appendChild(chk); wrap.appendChild(txt);
      hostHead.appendChild(wrap);
      medianToggle = chk;
      chk.addEventListener('change', ()=>{
        updateKPI(rows);
        scheduleSync();
      });
    }
  }
  const showMedian = medianToggle ? !!medianToggle.checked : true;

  */

       // Toggle "Mostra mediana"
  let medianToggle = document.getElementById('showMedian');
  if (!medianToggle){
    const hostHead = document.getElementById('kpiChartHost')?.previousElementSibling;
    if (hostHead){
      const wrap = document.createElement('label');
      wrap.style.marginLeft = 'auto';
      wrap.style.fontSize = '13px';
      wrap.style.display = 'inline-flex';
      wrap.style.gap = '6px';
      wrap.style.alignItems = 'center';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.id = 'showMedian';
      chk.checked = true;

      const txt = document.createElement('span');
      txt.textContent = 'Mostra mediana';

      wrap.appendChild(chk);
      wrap.appendChild(txt);
      hostHead.appendChild(wrap);

      medianToggle = chk;

      // 👉 invece di richiamare updateKPI, nascondiamo/mostriamo solo i dataset di mediana
      chk.addEventListener('change', ()=>{
        const show = !!chk.checked;
        if (!kpiChart) return;
        kpiChart.data.datasets.forEach(ds=>{
          if (ds._type === 'median') {
            ds.hidden = !show;
          }
        });
        kpiChart.update('none');
        scheduleSync();
      });
    }
  }
  const showMedian = medianToggle ? !!medianToggle.checked : true;
///////




  const datasets = [];
  for (const yStart of selected){
    const azi = new Array(12).fill(null);
    const med = new Array(12).fill(null);

    for (let m=9;m<=11;m++){
      const b=by.get(`${yStart}-${m}`); if(!b) continue;
      const vals=Array.from(b.by.values());
      azi[lacPosFromMonth(m)]= b.by.get(state.azienda) ?? null;
      med[lacPosFromMonth(m)]= median(vals);
    }
    for (let m=0;m<=8;m++){
      const b=by.get(`${yStart+1}-${m}`); if(!b) continue;
      const vals=Array.from(b.by.values());
      azi[lacPosFromMonth(m)]= b.by.get(state.azienda) ?? null;
      med[lacPosFromMonth(m)]= median(vals);
    }

    const c = colorFor[yStart] || '#64748b';
    datasets.push({ label: lactationLabel(yStart) + ' – KPI', data: azi, borderColor: c, backgroundColor: c+'22', borderWidth: 2, spanGaps: true, pointRadius: 3, _type: 'kpi', _lacStart: yStart });
    datasets.push({ label: lactationLabel(yStart) + ' – Mediana', data: med, borderColor: c, backgroundColor: c+'10', borderWidth: 2, borderDash: [6,4], spanGaps: true, pointRadius: 0, hidden: !showMedian, _type: 'median', _lacStart: yStart });
  }

  const unit = KPI_UNITS[state.currentKpi] || '';
  kpiChart.data.labels = LAC_MONTHS_IT;
  kpiChart.data.datasets = datasets;
  kpiChart.options.scales.y.title = { display: !!unit, text: unit };
  // --- Limiti normativi (unità ×10^3): SCC=1500, CBT=500 ---
  (function(){
    if (!kpiChart?.options?.plugins?.annotation) return;
    let anns = {};
    if (state.currentKpi === 'cellule') {
      anns = {
        scc_limit: {
          type:'line', yMin:1500, yMax:1500, borderColor:'rgba(239,68,68,0.75)', borderWidth:1, borderDash:[6,6],
          label:{display:true, content:'Limite 1500', position:'end', backgroundColor:'rgba(255,255,255,0.8)', color:'#111', font:{size:10}}
        }
      };
    } else if (state.currentKpi === 'carica') {
      anns = {
        cbt_limit: {
          type:'line', yMin:500, yMax:500, borderColor:'rgba(239,68,68,0.75)', borderWidth:1, borderDash:[6,6],
          label:{display:true, content:'Limite 500', position:'end', backgroundColor:'rgba(255,255,255,0.8)', color:'#111', font:{size:10}}
        }
      };
    }
    kpiChart.options.plugins.annotation.annotations = anns;
  })();

  kpiChart.update('none');

  ensureKpiStyleLegend();
  ensureAziendaSelector();
  scheduleSync();
}

function updateHistogram(rows){
  const by = getYMMap(rows, state.currentKpi);
  const ymKeys = Array.from(by.keys()).map(k=>{const [y,m]=k.split('-').map(Number); return {y,m};})
    .sort((a,b)=>(a.y-b.y)||(a.m-b.m));
  if (!ymKeys.length){ histChart.data.datasets[0].data = []; histChart.update(); const pb=document.getElementById('posBadge'); if(pb) pb.textContent='—° percentile'; return; }
  
  
  
  ////////
     
      // --- Limiti min/max per il periodo personalizzato in base ai dati dell'AZIENDA corrente ---
  (function(){
    const az = state.azienda;
    let minD = null, maxD = null;

    // scorri la mappa by (year,month,byAziende)
    by.forEach((obj) => {
      if (!obj || !obj.by || !obj.by.has(az)) return;   // considera solo i mesi dove l'azienda ha valori
      const d = new Date(obj.year, obj.month, 1);
      if (!minD || d < minD) minD = d;
      if (!maxD || d > maxD) maxD = d;
    });

    const fmEl = document.getElementById('fromMonth');
    const tmEl = document.getElementById('toMonth');
    if (!fmEl || !tmEl || !minD || !maxD) return;

    function fmtMonth(d){
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      return `${y}-${m}`;
    }

    const minStr = fmtMonth(minD);
    const maxStr = fmtMonth(maxD);

    // Limita la scelta dell’utente all’intervallo in cui l’AZIENDA ha dati
    fmEl.min = minStr;
    fmEl.max = maxStr;
    tmEl.min = minStr;
    tmEl.max = maxStr;

    // Se i valori correnti escono dai limiti, li ri-allineiamo al range disponibile
    if (fmEl.value && fmEl.value < minStr) fmEl.value = minStr;
    if (tmEl.value && tmEl.value > maxStr) tmEl.value = maxStr;
  })();


     

  ///////
  const lastYM = ymKeys[ymKeys.length-1];
  const maxD = new Date(lastYM.y, lastYM.m, 1);

  
  var inRangeMonths = [];
  if (state.histPeriod.type === 'months') {
    var minD = new Date(maxD.getFullYear(), maxD.getMonth() - (state.histPeriod.value - 1), 1);
    for (const k of ymKeys) {
      var d = new Date(k.y, k.m, 1);
      if (d >= minD && d <= maxD) inRangeMonths.push(k);
    }
  } else if (state.histPeriod.type === 'lactation') {
    // Lattazione: da Ottobre (9) di yStart a Settembre (8) di yStart+1
    var y0 = Number(state.histPeriod.start);
    for (const k of ymKeys) {
      if ((k.y === y0 && k.m >= 9) || (k.y === y0 + 1 && k.m <= 8)) {
        inRangeMonths.push(k);
      }
    }
  } else {
    // Intervallo personalizzato mm/aa
    for (const k2 of ymKeys) {
      var d2 = new Date(k2.y, k2.m, 1);
      if (d2 >= state.histPeriod.from && d2 <= state.histPeriod.to) inRangeMonths.push(k2);
    }
  }


  var perAz = new Map();
  inRangeMonths.forEach(ym=>{
    const b = by.get(`${ym.y}-${ym.m}`); if (!b) return;
    b.by.forEach((val,az)=>{ if(!isFinite(val)) return; if(!perAz.has(az)) perAz.set(az,[]); perAz.get(az).push(val); });
  });

  var useGeo = isLogKPI(state.currentKpi);
  var vals=[], aziAgg=null;
  perAz.forEach((list,az)=>{ var agg = useGeo ? aggGeometric(list) : aggArithmetic(list); if(agg!=null){ vals.push(agg); if(az===state.azienda) aziAgg=agg; }});

  if (!vals.length){ histChart.data.datasets[0].data=[]; histChart.update(); const pb=document.getElementById('posBadge'); if(pb) pb.textContent='—° percentile'; return; }

  function freedmanBins(values){
    var n=values.length; if(n<2) return 6;
    var s=values.slice().sort((a,b)=>a-b); var q1=s[Math.floor(0.25*(n-1))], q3=s[Math.floor(0.75*(n-1))];
    var iqr = (q3-q1); if(!isFinite(iqr)||iqr===0){ iqr=(s[n-1]-s[0])/4; if(!isFinite(iqr)||iqr===0) iqr=1; }
    var h = 2 * iqr * Math.pow(n, -1/3);
    var bins = Math.ceil((s[n-1]-s[0])/(h||1)) || 6; if(bins<6) bins=6; if(bins>15) bins=15; return bins;
  }

  //////////////
    var bins = freedmanBins(vals),
      mn   = Math.min(...vals),
      mx   = Math.max(...vals);

  var centers, counts;

  if (mn === mx) {
    // Tutti i valori uguali: un solo bin centrato sul valore
    bins = 1;
    var step = 1;
    centers = [mn];
    counts  = [vals.length];
  } else {
    var step = (mx - mn) / bins;
    if (!isFinite(step) || step <= 0) step = 1;
    centers = [];
    for (let b = 0; b < bins; b++) centers.push(mn + (b + 0.5) * step);
    counts = new Array(bins).fill(0);
    for (var v of vals){ 
      var idx = Math.floor((v - mn) / step); 
      if (idx >= bins) idx = bins - 1; 
      if (idx < 0) idx = 0; 
      counts[idx]++; 
    }
  }

  var total = counts.reduce((a,c)=>a+c,0)||1;
  var data = centers.map((c,i)=>({x:c, y: Math.round((counts[i]/total)*1000)/10}));





  ///////
  /*
  var bins=freedmanBins(vals), mn=Math.min(...vals), mx=Math.max(...vals), step=(mx-mn)/bins; if(!isFinite(step)||step<=0) step=1;
  var centers=[]; for (let b=0;b<bins;b++) centers.push(mn+(b+0.5)*step);
  var counts=new Array(bins).fill(0);
  for (var v of vals){ var idx=Math.floor((v-mn)/step); if(idx>=bins) idx=bins-1; if(idx<0) idx=0; counts[idx]++; }
  var total=counts.reduce((a,c)=>a+c,0)||1;
  var data=centers.map((c,i)=>({x:c, y: Math.round((counts[i]/total)*1000)/10}));
  */
  /////////////




  // PR coerente con PR del grafico: nessuna inversione, crescita sempre verso l'alto
  var pr = percentileRank(vals, aziAgg);

  var unit = KPI_UNITS[state.currentKpi] || '';
  histChart.data.datasets[0].data = data;

  //histChart.options.scales.x = { type:'linear', min:mn, max:mx, title:{display: !!unit, text: unit} };
    
  var axisMin = mn, axisMax = mx;
  if (axisMin === axisMax) { axisMin = mn - 0.5; axisMax = mn + 0.5; }
  histChart.options.scales.x = { type:'linear', min:axisMin, max:axisMax, title:{display: !!unit, text: unit} };

  
  histChart.options.plugins.annotation.annotations = (aziAgg!=null) ? {
    azi: { type:'line', xMin:aziAgg, xMax:aziAgg, borderColor:'#ef4444', borderWidth:2,
           label:{enabled:true, content:'Azienda: ' + aziAgg.toFixed(2) + (unit?(' '+unit):'') + ' (PR ' + pr + ')',
                  rotation:90, backgroundColor:'rgba(239,68,68,0.15)', color:'#ef4444'} }
  } : {};
  histChart.update();
  const posBadge = document.getElementById('posBadge');
  if (posBadge) posBadge.textContent = (pr!=null) ? (pr + '° percentile') : '—° percentile';
}

// ---- Wiring ----
(function init(){
  try{ const seedTag=document.getElementById('seed'); if(seedTag&&seedTag.textContent){ RAW = JSON.parse(seedTag.textContent); } }catch(e){ console.warn('No seed parsed', e); }
  ensureCharts();
  ensureAziendaSelector();

  const kSel = document.getElementById('indicatore');
  if (kSel){
    state.currentKpi = kSel.value || state.currentKpi;
    kSel.addEventListener('change', function(){
      state.currentKpi = this.value;

      // reset lock quando cambi KPI
      _leftLockWidth = 0;

      cache.ymByKpi.delete(state.currentKpi);
      const rows = rowsForKpi(getBenchmarkRaw(), state.currentKpi);
      updateBenchmarkCountLabel(rows);  ////////////////////////////////////////////////////////////////////

      updatePR(rows); updateKPI(rows); updateHistogram(rows);
  updatePeriodUIFromState();
      updatePeriodUIFromState();
    });
  }


  /*
  const miei = document.getElementById('miei-dati');
  const conf = document.getElementById('confronto');
  const viewMiei = document.getElementById('view-miei');
  const viewConf = document.getElementById('view-conf');
  function applyView(){
    if (miei && miei.checked){ viewMiei && viewMiei.classList.add('active'); viewConf && viewConf.classList.remove('active'); }
    else { viewConf && viewConf.classList.add('active'); viewMiei && viewMiei.classList.remove('active'); }
  }
  if (miei) miei.addEventListener('change', applyView);
  if (conf) conf.addEventListener('change', applyView);
     */
  const miei = document.getElementById('miei-dati');
  const conf = document.getElementById('confronto');
  const viewMiei = document.getElementById('view-miei');
  const viewConf = document.getElementById('view-conf');
  const benchmarkOpts = document.getElementById('benchmarkOptions'); // <--- AGGIUNTO: Riferimento alle opzioni benchmark

    const benchmarkTypeSel = document.getElementById('benchmarkType');
  if (benchmarkTypeSel && !benchmarkTypeSel._bound){
    benchmarkTypeSel.addEventListener('change', function(){
      if (cache && cache.ymByKpi && cache.ymByKpi.clear) {
        cache.ymByKpi.clear();
      }
      const rows = rowsForKpi(getBenchmarkRaw(), state.currentKpi);
      updateCaseificioLabel();
      updateBenchmarkCountLabel(rows); ///////////////////////////////////////////////////////////////

      updatePR(rows);
      updateKPI(rows);
      updateHistogram(rows);
      scheduleSync();
    });
    benchmarkTypeSel._bound = true;
  }

  const provinciaSel = document.getElementById('provinciaFilter');
  if (provinciaSel && !provinciaSel._bound){
    provinciaSel.addEventListener('change', function(){
      if (cache && cache.ymByKpi && cache.ymByKpi.clear) {
        cache.ymByKpi.clear();
      }
      const rows = rowsForKpi(getBenchmarkRaw(), state.currentKpi);
      updateBenchmarkCountLabel(rows); ///////////////////////////////////////////////////////////////

      updatePR(rows);
      updateKPI(rows);
      updateHistogram(rows);
      scheduleSync();
    });
    provinciaSel._bound = true;
  }


  function applyView(){
    if (miei && miei.checked){
      viewMiei && viewMiei.classList.add('active'); 
      viewConf && viewConf.classList.remove('active');
      if (benchmarkOpts) benchmarkOpts.style.display = 'none'; // <--- AGGIUNTO: Nasconde le opzioni benchmark
    }
    else {
      viewConf && viewConf.classList.add('active'); 
      viewMiei && viewMiei.classList.remove('active');
      if (benchmarkOpts) benchmarkOpts.style.display = 'flex'; // <--- AGGIUNTO: Mostra le opzioni benchmark
    }
  }
  if (miei) miei.addEventListener('change', applyView);
  if (conf) conf.addEventListener('change', applyView);


  //

  ['yr2023','yr2024','yr2025'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', function(){
      const rows = rowsForKpi(getBenchmarkRaw(), state.currentKpi);

      updatePR(rows);
      updateKPI(rows);
    });
  });
  // --- Periodo istogramma: 3 lattazioni + intervallo personalizzato ---
  const preset = document.getElementById('distPreset');
  const wrap   = document.getElementById('customPeriod');
  const apply  = document.getElementById('applyCustom');


  
  function rebuildLactationMenu() {
    if (!preset) return;
    // calcola ultime 3 lattazioni rispetto alla data corrente
    const yNow = new Date().getMonth() >= 9 ? new Date().getFullYear() : new Date().getFullYear() - 1; // anno di inizio lattazione corrente
    const lacs = [yNow - 2, yNow - 1, yNow];

    // ricostruisci menu
    preset.innerHTML = '';
    for (const y of lacs) {
      const opt = document.createElement('option');
      opt.value = 'lac:' + y;
      opt.textContent = 'Lattazione ' + lactationLabel(y);
      preset.appendChild(opt);
    }
    const optCustom = document.createElement('option');
    optCustom.value = 'custom';
    optCustom.textContent = 'Intervallo personalizzato';
    preset.appendChild(optCustom);

    // default: 2024-25 se presente, altrimenti ultima lattazione
    const preferred = 2024;
    const hasPreferred = lacs.includes(preferred);
    const def = hasPreferred ? preferred : lacs[lacs.length - 1];
    preset.value = 'lac:' + def;
    state.histPeriod = { type: 'lactation', start: def };
    if (wrap) wrap.style.display = 'none';
  }


  function formatMonth(d){
    if (!(d instanceof Date)) return '';
    const y = d.getFullYear();
    const m = (d.getMonth()+1).toString().padStart(2,'0');
    return `${y}-${m}`;
  }
  function setCustomLabelText(preset, fromD, toD){
    if (!preset) return;
    const optCustom = Array.from(preset.options).find(o => o.value === 'custom');
    if (!optCustom) return;
    if (fromD && toD){
      optCustom.textContent = `Intervallo personalizzato (${formatMonth(fromD)} → ${formatMonth(toD)})`;
    } else {
      optCustom.textContent = 'Intervallo personalizzato';
    }
  }
  function updatePeriodUIFromState(){
    const preset = document.getElementById('distPreset');
    const wrap   = document.getElementById('customPeriod');
    const fm = document.getElementById('fromMonth');
    const tm = document.getElementById('toMonth');
    if (!preset) return;
    if (state.histPeriod?.type === 'custom'){
      // Keep select on 'custom' and KEEP panel open to allow quick tweaks
      preset.value = 'custom';
      if (wrap) wrap.style.display = 'flex';
      const f = state.histPeriod.from, t = state.histPeriod.to;
      if (fm) fm.value = formatMonth(f);
      if (tm) tm.value = formatMonth(t);
      setCustomLabelText(preset, f, t);
    } else if (state.histPeriod?.type === 'lactation'){
      if (wrap) wrap.style.display = 'flex';
      preset.value = 'lac:' + Number(state.histPeriod.start);
      setCustomLabelText(preset, null, null);
    } else if (state.histPeriod?.type === 'months'){
      // legacy months mode
      setCustomLabelText(preset, null, null);
    }
  }

  rebuildLactationMenu();
  updatePeriodUIFromState();

  if (preset) {
    preset.addEventListener('change', () => {
      const v = preset.value;
      if (v === 'custom') {
        if (wrap) wrap.style.display = 'flex';
      } else if (v && v.startsWith('lac:')) {
        if (wrap) wrap.style.display = 'flex';
        const y = Number(v.split(':')[1]);
        state.histPeriod = { type: 'lactation', start: y };
        const rows = rowsForKpi(getBenchmarkRaw(), state.currentKpi);
        updateHistogram(rows);
      }
    });
  }

  if (apply) {
    apply.addEventListener('click', (e) => {
      if (e && e.preventDefault) e.preventDefault();
      const fm = document.getElementById('fromMonth');
      const tm = document.getElementById('toMonth');
      const f = fm?.value;
      const t = tm?.value;
      if (!f || !t) return;
      // input type="month" => "YYYY-MM"
      const [fy, fmon] = f.split('-').map(Number);
      const [ty, tmon] = t.split('-').map(Number);
      let fromD = new Date(fy, (fmon || 1)-1, 1);
      let toD   = new Date(ty, (tmon || 1)-1, 1);
      if (fromD > toD) { const tmp = fromD; fromD = toD; toD = tmp; }

      state.histPeriod = { type: 'custom', from: fromD, to: toD };
      // show chosen extremities in the select option label and keep inputs populated
      setCustomLabelText(preset, fromD, toD);
      if (fm) fm.value = formatMonth(fromD);
      if (tm) tm.value = formatMonth(toD);

      if (preset) preset.value = 'custom';
      if (wrap) wrap.style.display = 'flex';
      const rows = rowsForKpi(getBenchmarkRaw(), state.currentKpi);
      updateHistogram(rows);
    });
  }


  // Primo render
  const rows = rowsForKpi(getBenchmarkRaw(), state.currentKpi);
  updateBenchmarkCountLabel(rows);
  updateCaseificioLabel();
  updatePR(rows); updateKPI(rows); updateHistogram(rows);
  updatePeriodUIFromState();
  applyView();

  // Legenda + sync
  ensureKpiStyleLegend();
  ensureAziendaSelector();
  scheduleSync();

  //////
  // 🔹 Quando il dataLoader ha caricato RAW, ricalcola tutto automaticamente
  document.addEventListener('raw:loaded', function(ev){
  try {
    // 1) aggiorna la lista aziende in base a RAW pieno
    ensureAziendaSelector();

    // 2) recupera il select KPI
    const kSel = document.getElementById('indicatore');
    if (kSel) {
      // sincronizza comunque state.currentKpi con il valore corrente del select
      state.currentKpi = kSel.value || state.currentKpi || 'cellule';

      // 3) simula un "change" sul select → parte la stessa logica che usi a mano
      const evChange = new Event('change', { bubbles: true });
      kSel.dispatchEvent(evChange);
    } else {
      // fallback di sicurezza: se per qualche motivo non c'è il select
      const rows = rowsForKpi(getBenchmarkRaw(), state.currentKpi || 'cellule');
      updateBenchmarkCountLabel(rows);

      updatePR(rows);
      updateKPI(rows);
      updateHistogram(rows);
      updatePeriodUIFromState();
      applyView();
    }
  } catch (e) {
    console.warn('raw:loaded handler error', e);
  }
});


  
  /////
  




  window.addEventListener('resize', scheduleSync);
})();


// === Pulsante DEMO ===
function showCredit() {
  const toast = document.createElement('div');
  toast.textContent = 'Giannicola Spezzigu';
  toast.style.position = 'fixed';
  toast.style.top = '20px';
  toast.style.right = '20px';
  toast.style.background = 'rgba(15,23,42,0.9)';
  toast.style.color = 'white';
  toast.style.padding = '10px 16px';
  toast.style.borderRadius = '12px';
  toast.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
  toast.style.fontFamily = 'system-ui, sans-serif';
  toast.style.zIndex = '9999';
  toast.style.opacity = '0';
  toast.style.transition = 'opacity 0.4s ease';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '1'; }, 10);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 500);
  }, 2000);
}
(function bindDemoButton() {
  const demoEl = document.getElementById('demo');
  if (!demoEl) return;
  demoEl.style.cursor = 'pointer';
  demoEl.addEventListener('mouseenter', () => { demoEl.style.opacity = '0.8'; });
  demoEl.addEventListener('mouseleave', () => { demoEl.style.opacity = '1'; });
  demoEl.addEventListener('click', showCredit);
})();