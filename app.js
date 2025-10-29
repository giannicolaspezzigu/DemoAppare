// ================== APPÀRE - Charts Logic (clean build) ==================

// ---- Config & constants ----
const KPI_ALIASES = {
  cellule:   ['cellule','scc','cellule somatiche','cellule somatiche (scc)'],
  carica:    ['carica','cbt','carica batterica','carica batterica (cbt)'],
  urea:      ['urea'],
  grassi:    ['grassi','fat','% fat'],
  proteine:  ['proteine','protein','% prot']
};
const KPI_UNITS = { cellule:'cell/mL', carica:'UFC/mL', urea:'mg/dL', grassi:'%', proteine:'%' };
// Limiti normativi ufficiali
const KPI_LIMITS = {
  cellule:[1500000], // SCC
  carica:[500000],   // CBT
  urea:[], grassi:[], proteine:[]
};
const MONTHS_IT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

// ---- App state ----
var state = { currentYear: null,
  currentKpi: 'cellule',
  azienda: 'GOIA SILVIA',
  histPeriod: { type:'months', value:12 }
};
var RAW = [];
var prChart, kpiChart, histChart;



function equalizeY() {
  try {
    // Aspetta che entrambi i grafici siano disegnati
    setTimeout(() => {
      try {
        if (kpiChart?.scales?.y && prChart?.scales?.y) {
          const wy = kpiChart.scales.y.width;
          if (wy && isFinite(wy)) {
            // Allinea il PR alla larghezza del KPI (leggermente più largo per sicurezza)
            prChart.options.scales.y.afterFit = (scale) => {
              scale.width = wy + 2;
            };
            prChart.update();
          }
        }
      } catch (err) {
        console.error("equalizeY inner error", err);
      }
    }, 50); // piccola attesa per assicurare layout completato
  } catch (err) {
    console.error("equalizeY outer error", err);
  }
}










// ---- Helpers ----
function lowerIsBetter(k){ return (k==='cellule' || k==='carica'); }
function isLogKPI(k){ return (k==='cellule' || k==='carica'); }

function rowsForKpi(raw, k){
  var aliases = KPI_ALIASES[k] || [k];
  var out = [];
  for (var i=0;i<raw.length;i++){
    var r = raw[i];
    if (aliases.indexOf(String(r.KPI).toLowerCase()) !== -1){
      var y = Number(r.Anno), m = Number(r.Mese)-1, v = Number(r.Valore);
      if (isFinite(v) && !isNaN(y) && !isNaN(m)){
        out.push({ Azienda:r.Azienda, year:y, month:m, value:v });
      }
    }
  }
  return out;
}

function aggArithmetic(values){
  var s=0, n=0;
  for (var i=0;i<values.length;i++){
    var v = values[i];
    if (isFinite(v)){ s+=v; n++; }
  }
  return n ? s/n : null;
}
function aggGeometric(values){
  var sumLog=0, n=0;
  for (var i=0;i<values.length;i++){
    var v = values[i];
    if (isFinite(v) && v>0){ sumLog += Math.log(v); n++; }
  }
  return n ? Math.exp(sumLog/n) : null;
}

// Aggrega per (anno, mese, azienda) applicando media geo/aritm a seconda del KPI
function monthlyAggregate(rawRows, kpi){
  var byKey = new Map();
  for (var i=0;i<rawRows.length;i++){
    var r = rawRows[i];
    var key = r.year+'|'+r.month+'|'+r.Azienda;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r.value);
  }
  var out = [];
  var useGeo = isLogKPI(kpi);
  byKey.forEach(function(vals, keyStr){
    var parts = keyStr.split('|');
    var y = Number(parts[0]), m = Number(parts[1]), az = parts[2];
    var agg = useGeo ? aggGeometric(vals) : aggArithmetic(vals);
    if (agg!=null){
      out.push({ Azienda:az, year:y, month:m, value:agg });
    }
  });
  return out;
}

// Percentile rank con tie = 0.5
function percentileRank(arr, v){
  var nums = [];
  for (var i=0;i<arr.length;i++){
    var x = arr[i];
    if (typeof x==='number' && !isNaN(x)) nums.push(x);
  }
  nums.sort(function(a,b){ return a-b; });
  if (nums.length===0 || typeof v!=='number' || isNaN(v)) return null;
  var count=0, ties=0;
  for (var j=0;j<nums.length;j++){
    var x2 = nums[j];
    if (x2 < v) count++;
    else if (x2 === v) ties++;
  }
  return Math.round(((count + 0.5*ties)/nums.length)*100);
}

function median(arr){
  var a = [];
  for (var i=0;i<arr.length;i++) if (isFinite(arr[i])) a.push(arr[i]);
  a.sort(function(x,y){ return x-y; });
  var n = a.length;
  if (!n) return null;
  var m = Math.floor(n/2);
  return (n%2) ? a[m] : (a[m-1]+a[m])/2;
}

// Memoization YM map (per KPI corrente)
var cache = { ymByKpi: new Map() };
function getYMMap(kpiRows){
  var key = state.currentKpi;
  if (cache.ymByKpi.has(key)) return cache.ymByKpi.get(key);
  var agg = monthlyAggregate(kpiRows, key);
  var m = new Map(); // "year-month" -> {year, month, by: Map(azienda->val)}
  for (var i=0;i<agg.length;i++){
    var r = agg[i];
    var mapKey = String(r.year)+'-'+String(r.month);
    if (!m.has(mapKey)) m.set(mapKey, {year:r.year, month:r.month, by:new Map()});
    m.get(mapKey).by.set(r.Azienda, r.value);
  }
  cache.ymByKpi.set(key, m);
  return m;
}

// Freedman–Diaconis for bins
function freedmanBins(values){
  var n = values.length;
  if (n<2) return 6;
  var s = values.slice().sort(function(a,b){return a-b;});
  var q1 = s[Math.floor(0.25*(n-1))], q3 = s[Math.floor(0.75*(n-1))];
  var iqr = (q3 - q1);
  if (!isFinite(iqr) || iqr===0){
    iqr = (s[n-1]-s[0])/4;
    if (!isFinite(iqr) || iqr===0) iqr = 1;
  }
  var h = 2 * iqr * Math.pow(n, -1/3);
  var bins = Math.ceil((s[n-1]-s[0])/(h || 1)) || 6;
  if (bins<6) bins=6;
  if (bins>15) bins=15;
  return bins;
}

// ---- Charts ----
var HoverLine = {
  id: 'hoverLine',
  afterDatasetsDraw: function(chart) {
    var active = chart.getActiveElements();
    if (!active || !active.length) return;
    var ca = chart.chartArea;
    var y = active[0].element.y;
    var ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ca.left, y);
    ctx.lineTo(ca.right, y);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(51,65,85,0.8)';
    ctx.setLineDash([4,4]);
    ctx.stroke();
    ctx.restore();
  }
};
Chart.register(window['chartjs-plugin-annotation'], HoverLine);


function ensureCharts(){
  prChart = new Chart(document.querySelector('#prChartHost canvas').getContext('2d'), {
    type:'line',
    data:{ labels: MONTHS_IT, datasets: [] },
    options:{
      responsive:true, maintainAspectRatio:false,
      layout:{padding:{top:0,right:0,bottom:0,left:0}},
      interaction:{mode:'index', intersect:false},
      animation:{duration:0},
      scales:{ 
        x:{type:'category', labels: MONTHS_IT, offset:false},
        y:{ min:0, max:100, ticks:{stepSize:20} } 
      },
      plugins:{
        legend:{display:false}, tooltip:{enabled:true},
        annotation:{ annotations:{
          low:{type:'box', yMin:0, yMax:39, backgroundColor:'rgba(239,68,68,.12)', borderWidth:0},
          mid:{type:'box', yMin:40, yMax:74, backgroundColor:'rgba(245,158,11,.12)', borderWidth:0},
          high:{type:'box', yMin:75, yMax:100, backgroundColor:'rgba(34,197,94,.12)', borderWidth:0},
          t40:{type:'line', yMin:40, yMax:40, borderColor:'rgba(15,23,42,.35)', borderDash:[6,6], borderWidth:1},
          t75:{type:'line', yMin:75, yMax:75, borderColor:'rgba(15,23,42,.35)', borderDash:[6,6], borderWidth:1}
        }}
      },
      elements:{ line:{tension:.3}, point:{radius:3} },
      onHover: function(e, active){ e.native && (e.native.target.style.cursor = active && active.length ? 'pointer' : 'default'); },
      onClick: function(evt){
        var elems = prChart.getElementsAtEventForMode(evt, 'dataset', {intersect:false}, false);
        if (!elems || !elems.length){
          elems = prChart.getElementsAtEventForMode(evt, 'nearest', {intersect:false}, false);
        }
        if (elems && elems.length){
          var dsIndex = elems[0].datasetIndex;
          var ds = prChart.data.datasets[dsIndex];
          if (ds && ds.label){
            var y = parseInt(ds.label,10);
            if (!isNaN(y)){
              state.currentYear = y;
              var rows = rowsForKpi(RAW, state.currentKpi);
              updateKPI(rows);
            }
          }
        }
      }
    }
  });

  kpiChart = new Chart(document.querySelector('#kpiChartHost canvas').getContext('2d'), {
    type:'line',
    data:{ labels: MONTHS_IT, datasets:[
      { label:'Azienda',         borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,.12)', data:[], spanGaps:true },
      { label:'Mediana gruppo',  borderColor:'#0ea5e9', backgroundColor:'rgba(14,165,233,.12)', data:[], spanGaps:true }
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      layout:{padding:{top:0,right:0,bottom:0,left:0}},
      interaction:{mode:'index', intersect:false},
      animation:{duration:0},
      scales:{ 
        x:{type:'category', labels: MONTHS_IT, offset:false},
        y:{ beginAtZero:false, grace:'5%', title:{display:false, text:''} } 
      },
      plugins:{ legend:{display:false}, tooltip:{enabled:true}, annotation:{annotations:{}} },
      elements:{ line:{tension:.3}, point:{radius:3} },
      onHover: function(e, active){ e.native && (e.native.target.style.cursor = active && active.length ? 'pointer' : 'default'); }
    }
  });

  histChart = new Chart(document.querySelector('#histChartHost canvas').getContext('2d'), {
    type:'bar',
    data:{ datasets:[{label:'Frequenza %', data:[], parsing:{xAxisKey:'x', yAxisKey:'y'}, backgroundColor:'rgba(2,132,199,.25)', borderColor:'#0284c7'}] },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      animation:{duration:0},
      scales:{ x:{type:'linear', title:{display:false, text:''}}, y:{beginAtZero:true, ticks:{callback:function(v){return v+'%';}}} },
      plugins:{ legend:{display:false}, tooltip:{enabled:true}, annotation:{annotations:{}} }
    }
  });
  // Equalize Y widths after initial render
  setTimeout(function(){ try{ prChart.update(); kpiChart.update(); equalizeY(); prChart.update(); kpiChart.update(); }catch(e){} }, 0);
}


// ---- Update routines ----
function updatePR(rows){
  var by = getYMMap(rows);
  // anni disponibili
  var yearsSet = new Set();
  by.forEach(function(_bucket, key){
    var y = Number(key.split('-')[0]);
    yearsSet.add(y);
  });
  var avail = yearsSet;

  [['yr2023',2023],['yr2024',2024],['yr2025',2025]].forEach(function(pair){
    var id = pair[0], y = pair[1];
    var el = document.getElementById(id);
    if (el){
      var has = avail.has(y);
      el.disabled = !has;
      if (!has) el.checked = false;
    }
  });

  var sels = [2023,2024,2025].filter(function(y){
    var el = document.getElementById('yr'+y);
    return el && el.checked && avail.has(y);
  });
  var colors = {2023:'#3b82f6', 2024:'#f59e0b', 2025:'#22c55e'};
  var trans = function(v){ return lowerIsBetter(state.currentKpi) ? -v : v; };

  var ds = [];
  for (var s=0;s<sels.length;s++){
    var y = sels[s];
    var arr = new Array(12).fill(null);
    for (var m=0;m<12;m++){
      var bucket = by.get(String(y)+'-'+String(m));
      if (!bucket) continue;
      var vals = Array.from(bucket.by.values()).map(trans);
      var v = bucket.by.get(state.azienda);
      var tv = (v!=null) ? trans(v) : null;
      arr[m] = percentileRank(vals, tv);
    }
    ds.push({ label:String(y), data:arr, borderColor:colors[y], backgroundColor:colors[y]+'22', spanGaps:true });
  
  // align y widths after initial render
  try { setTimeout(function(){ equalizeY(); }, 60); } catch(e){}
}
  prChart.data.datasets = ds;
  prChart.update();
  try { setTimeout(function(){ equalizeY(); }, 60); } catch(e){}
}

function updateKPI(rows){
  var by = getYMMap(rows);
  // anno più recente tra le chiavi
  var years = [];
  by.forEach(function(_b, k){ var y = Number(k.split('-')[0]); if (years.indexOf(y)===-1) years.push(y); });
  years.sort();
  var latest = years[years.length-1];
  var useYear = (state.currentYear && years.indexOf(state.currentYear)!==-1) ? state.currentYear : latest;
  var useYear = (state.currentYear && years.indexOf(state.currentYear)!==-1) ? state.currentYear : latest;

  var azi = new Array(12).fill(null), med = new Array(12).fill(null);
  for (var m=0;m<12;m++){
    var b = by.get(String(useYear)+'-'+String(m));
    if (!b) continue;
    var vals = Array.from(b.by.values());
    azi[m] = b.by.has(state.azienda) ? b.by.get(state.azienda) : null;
    med[m] = median(vals);
  }
  kpiChart.data.datasets[0].data = azi;
  kpiChart.data.datasets[1].data = med;

  // asse Y con unità
  var unit = KPI_UNITS[state.currentKpi] || '';
  kpiChart.options.scales.y.beginAtZero = false;
  kpiChart.options.scales.y.grace = '5%';
  kpiChart.options.scales.y.title = { display: !!unit, text: unit };

  // soglie disattivate per garantire scala corretta
kpiChart.options.plugins.annotation.annotations = {};

  kpiChart.update();
  try { setTimeout(function(){ equalizeY(); }, 60); } catch(e){}
}

function updateHistogram(rows){
  // Base: valori mensili aggregati per (anno, mese, azienda)
  var by = getYMMap(rows);
  var ymKeys = Array.from(by.keys()).map(function(k){ var p=k.split('-'); return {y:Number(p[0]), m:Number(p[1])}; })
                    .sort(function(a,b){ return (a.y-b.y) || (a.m-b.m); });
  if (!ymKeys.length){
    histChart.data.datasets[0].data = [];
    histChart.update();
    document.getElementById('posBadge').textContent = '—° percentile';
  } else {
    var lastYM = ymKeys[ymKeys.length-1];
    var maxD = new Date(lastYM.y, lastYM.m, 1);

    // mesi nel periodo selezionato
    var inRangeMonths = [];
    if (state.histPeriod.type==='months'){
      var minD = new Date(maxD.getFullYear(), maxD.getMonth()-(state.histPeriod.value-1), 1);
      for (var t=0;t<ymKeys.length;t++){
        var d = new Date(ymKeys[t].y, ymKeys[t].m, 1);
        if (d>=minD && d<=maxD) inRangeMonths.push(ymKeys[t]);
      }
    } else {
      for (var u=0;u<ymKeys.length;u++){
        var d2 = new Date(ymKeys[u].y, ymKeys[u].m, 1);
        if (d2>=state.histPeriod.from && d2<=state.histPeriod.to) inRangeMonths.push(ymKeys[u]);
      }
    }

    // per-azienda: lista di valori mensili -> aggregazione sul periodo
    var perAz = new Map();
    for (var a=0;a<inRangeMonths.length;a++){
      var ym = inRangeMonths[a];
      var bucket = by.get(String(ym.y)+'-'+String(ym.m));
      if (!bucket) continue;
      bucket.by.forEach(function(val, az){
        if (!isFinite(val)) return;
        if (!perAz.has(az)) perAz.set(az, []);
        perAz.get(az).push(val);
      });
    }

    var useGeo = isLogKPI(state.currentKpi);
    var vals = [];
    var aziAgg = null;
    perAz.forEach(function(list, az){
      var agg = useGeo ? aggGeometric(list) : aggArithmetic(list);
      if (agg!=null){
        vals.push(agg);
        if (az===state.azienda) aziAgg = agg;
      }
    });

    if (!vals.length){
      histChart.data.datasets[0].data = [];
      histChart.update();
      document.getElementById('posBadge').textContent = '—° percentile';
    } else {
      // bins su valori aggregati
      var bins = freedmanBins(vals);
      var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
      var step = (mx-mn)/bins; if (!isFinite(step) || step<=0) step = 1;
      var centers = []; for (var b=0;b<bins;b++) centers.push(mn + (b+0.5)*step);
      var counts = new Array(bins).fill(0);
      for (var q=0;q<vals.length;q++){
        var v = vals[q];
        var idx = Math.floor((v-mn)/step);
        if (idx>=bins) idx=bins-1;
        if (idx<0) idx=0;
        counts[idx]++;
      }
      var total = 0; for (var c=0;c<counts.length;c++) total += counts[c];
      if (total<=0) total = 1;
      var data = [];
      for (var d=0;d<centers.length;d++){
        data.push({ x: centers[d], y: Math.round((counts[d]/total)*1000)/10 });
      }

      // percentile su valori aggregati con direzione normalizzata
      var valsT = lowerIsBetter(state.currentKpi) ? vals.map(function(v){return -v;}) : vals.slice();
      var aziT = (aziAgg!=null) ? (lowerIsBetter(state.currentKpi) ? -aziAgg : aziAgg) : null;
      var pr = percentileRank(valsT, aziT);

      var unit = KPI_UNITS[state.currentKpi] || '';
      histChart.data.datasets[0].data = data;
      histChart.options.scales.x = { type:'linear', min:mn, max:mx, title:{display: !!unit, text: unit} };
      histChart.options.plugins.annotation.annotations = (aziAgg!=null) ? {
        azi: { type:'line', xMin:aziAgg, xMax:aziAgg, borderColor:'#ef4444', borderWidth:2,
               label:{enabled:true, content:'Azienda: ' + aziAgg.toFixed(2) + (unit?(' '+unit):'') + ' (PR ' + pr + ')',
                      rotation:90, backgroundColor:'rgba(239,68,68,0.15)', color:'#ef4444'} }
      } : {};
      histChart.update();
      document.getElementById('posBadge').textContent = (pr!=null) ? (pr + '° percentile') : '—° percentile';
    }
  }
}

// ---- Wiring ----

  // Click on "demo" shows credit
  var demoEl = document.getElementById('demo') || document.querySelector('[data-credit=\"demo\"]');
  if(!demoEl){
    // fallback: any element whose text is exactly "demo"
    var candidates = Array.prototype.slice.call(document.querySelectorAll('a, span, div, button, h1, h2, h3'));
    for(var i=0;i<candidates.length;i++){
      var tx = (candidates[i].textContent || '').trim().toLowerCase();
      if(tx === 'demo'){ demoEl = candidates[i]; break; }
    }
  }
  if(demoEl){
    demoEl.style.cursor = 'pointer';
    demoEl.addEventListener('click', function(e){ e.preventDefault && e.preventDefault(); showCredit(); });
    demoEl.setAttribute('title','Credit');
  }

function refresh(){
  cache.ymByKpi.delete(state.currentKpi); // rebuild YM map for KPI
  var rows = rowsForKpi(RAW, state.currentKpi);
  updatePR(rows);
  updateKPI(rows);
  updateHistogram(rows);
  var header = document.getElementById('aziendaHeader');
  if (header) header.textContent = state.azienda;
}

function bindOnce(){

  // --- credit toast ---
  function showCredit(){
    var t = document.getElementById('creditToast');
    if(!t){
      t = document.createElement('div');
      t.id = 'creditToast';
      t.style.position = 'fixed';
      t.style.right = '16px';
      t.style.bottom = '16px';
      t.style.padding = '10px 14px';
      t.style.background = 'rgba(17,24,39,0.9)';
      t.style.color = '#fff';
      t.style.borderRadius = '10px';
      t.style.boxShadow = '0 6px 20px rgba(0,0,0,0.25)';
      t.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      t.style.zIndex = 9999;
      document.body.appendChild(t);
    }
    t.textContent = 'Credit: Giannicola Spezzigu';
    t.style.opacity = '1';
    t.style.transition = 'opacity 0.4s ease';
    setTimeout(function(){ t.style.opacity = '0'; }, 2500);
  }

  var sel = document.getElementById('indicatore');
  if (sel){
    sel.addEventListener('change', function(e){ state.currentKpi = e.target.value; refresh(); });
  }
  ['yr2023','yr2024','yr2025'].forEach(function(id){
    var el = document.getElementById(id);
    if (el){
      el.addEventListener('change', function(){
        if (el.checked){ state.currentYear = Number(id.replace('yr','')); }
        refresh();
      });
    }
  });

  var vt = document.getElementById('viewToggle');
  var inMine = document.getElementById('miei-dati');
  var inConf = document.getElementById('confronto');
  function setView(which){
    if (!vt) return;
    if (which==='miei'){
      vt.setAttribute('data-active','miei');
      document.getElementById('view-miei').classList.add('active');
      document.getElementById('view-conf').classList.remove('active');
    } else {
      vt.setAttribute('data-active','conf');
      document.getElementById('view-conf').classList.add('active');
      document.getElementById('view-miei').classList.remove('active');
    }
  }
  if (inMine){ inMine.addEventListener('change', function(){ setView('miei'); }); }
  if (inConf){ inConf.addEventListener('change', function(){ setView('conf'); }); }
  if (vt){
    vt.addEventListener('click', function(e){
      var t = e.target || e.srcElement;
      var lblFor = t.htmlFor || (t.getAttribute ? t.getAttribute('for') : null);
      if (lblFor==='miei-dati' && inMine){ inMine.checked = true; setView('miei'); }
      if (lblFor==='confronto' && inConf){ inConf.checked = true; setView('conf'); }
    });
  }

  var preset = document.getElementById('distPreset');
  var wrap = document.getElementById('customPeriod');
  var apply = document.getElementById('applyCustom');
  if (preset){
    preset.addEventListener('change', function(){
      if (preset.value==='custom'){
        if (wrap) wrap.style.display='flex';
      } else {
        if (wrap) wrap.style.display='none';
        state.histPeriod = { type:'months', value:Number(preset.value) };
        refresh();
      }
    });
  }
  if (apply){
    apply.addEventListener('click', function(){
      var f = document.getElementById('fromMonth').value;
      var t = document.getElementById('toMonth').value;
      if (!f || !t) return;
      var fy = Number(f.split('-')[0]), fm = Number(f.split('-')[1]);
      var ty = Number(t.split('-')[0]), tm = Number(t.split('-')[1]);
      state.histPeriod = { type:'custom', from:new Date(fy,fm-1,1), to:new Date(ty,tm-1,1) };
      refresh();
    });
  }

  // --- delegation: handle clicks on #demo, [data-credit="demo"], or elements with text "demo"
  document.addEventListener('click', function(e){
    var el = e.target && (e.target.closest ? e.target.closest('[data-credit="demo"], #demo, .credit-demo') : null);
    if(!el){
      var tx = (e.target && e.target.textContent ? e.target.textContent : '').trim().toLowerCase();
      if(tx === 'demo'){ el = e.target; }
    }
    if(el){
      if (e.preventDefault) e.preventDefault();
      showCredit();
    }
  });

}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', function(){
  ensureCharts();
  bindOnce();

  function loadFromSeed(){
    var seedEl = document.getElementById('seed');
    try {
      RAW = seedEl ? JSON.parse(seedEl.textContent) : [];
    } catch(err){
      RAW = [];
    }
    refresh();
  }

  try {
    fetch('data.json', {cache:'no-store'}).then(function(resp){
      if (resp && resp.ok) return resp.json();
      throw new Error('HTTP '+ (resp ? resp.status : 'noresp'));
    }).then(function(json){
      RAW = json || [];
      refresh();
    }).catch(function(){
      loadFromSeed();
    });
  } catch(e){
    loadFromSeed();
  }
});
// ================== end ==================