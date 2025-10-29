
const KPI_ALIASES = {
  cellule:['cellule','scc','cellule somatiche','cellule somatiche (scc)'],
  carica:['carica','cbt','carica batterica','carica batterica (cbt)'],
  urea:['urea'],
  grassi:['grassi','fat','% fat'],
  proteine:['proteine','protein','% prot']
};
const MONTHS_IT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
const state = { currentKpi:'cellule', azienda:'GOIA SILVIA', histPeriod:{type:'months', value:12} };
let RAW = [];
let prChart, kpiChart, histChart;

const HoverLine = {
  id: 'hoverLine',
  afterDatasetsDraw(chart) {
    const active = chart.getActiveElements();
    if (!active || !active.length) return;
    const {left, right} = chart.chartArea;
    const y = active[0].element.y;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(51,65,85,0.8)';
    ctx.setLineDash([4,4]);
    ctx.stroke();
    ctx.restore();
  }
};
Chart.register(window['chartjs-plugin-annotation'], HoverLine);

function rowsForKpi(raw, k){
  const aliases = KPI_ALIASES[k] || [k];
  return raw.filter(r => aliases.includes(String(r.KPI).toLowerCase()))
            .map(r => ({Azienda:r.Azienda, date:new Date(r.Data), year:+r.Anno, month:+r.Mese-1, value:+r.Valore}))
            .filter(r => Number.isFinite(r.value) && !isNaN(r.year) && !isNaN(r.month));
}
function groupYM(rows){
  const map = new Map();
  rows.forEach(r=>{
    const key = `${r.year}-${r.month}`;
    if(!map.has(key)) map.set(key, {year:r.year, month:r.month, by:new Map()});
    map.get(key).by.set(r.Azienda, r.value);
  });
  return map;
}
function percentileRank(arr, v){
  const nums = arr.filter(x=>typeof x==='number'&&!isNaN(x)).sort((a,b)=>a-b);
  if(nums.length===0 || typeof v!=='number' || isNaN(v)) return null;
  let count=0, ties=0;
  for(const x of nums){ if(x<v) count++; else if(x===v) ties++; }
  return Math.round(((count + 0.5*ties)/nums.length)*100);
}
function median(arr){
  const a = arr.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y);
  const n = a.length; if(!n) return null; const m = Math.floor(n/2);
  return n%2 ? a[m] : (a[m-1]+a[m])/2;
}
const lowerIsBetter = k => (k==='cellule' || k==='carica');

const cache = { ymByKpi:new Map(), histKey:'' };
function getYMMap(rows){ const k = state.currentKpi; if(cache.ymByKpi.has(k)) return cache.ymByKpi.get(k); const m=groupYM(rows); cache.ymByKpi.set(k,m); return m; }

function ensureCharts(){
  prChart = new Chart(document.querySelector('#prChartHost canvas').getContext('2d'), {
    type:'line', data:{labels:MONTHS_IT, datasets:[]},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      animation:{duration:0},
      transitions:{ active:{ animation:{ duration:0 } } },
      scales:{y:{min:0,max:100,ticks:{stepSize:20}}},
      plugins:{legend:{display:false}, tooltip:{enabled:true}, annotation:{annotations:{
        low:{type:'box', yMin:0, yMax:39, backgroundColor:'rgba(239,68,68,.12)', borderWidth:0},
        mid:{type:'box', yMin:40, yMax:74, backgroundColor:'rgba(245,158,11,.12)', borderWidth:0},
        high:{type:'box', yMin:75, yMax:100, backgroundColor:'rgba(34,197,94,.12)', borderWidth:0},
        t40:{type:'line', yMin:40, yMax:40, borderColor:'rgba(15,23,42,.35)', borderDash:[6,6]},
        t75:{type:'line', yMin:75, yMax:75, borderColor:'rgba(15,23,42,.35)', borderDash:[6,6]}
      }}}, elements:{line:{tension:.3}, point:{radius:3}}
  });
  kpiChart = new Chart(document.querySelector('#kpiChartHost canvas').getContext('2d'), {
    type:'line', data:{labels:MONTHS_IT, datasets:[
      {label:'Azienda', borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,.12)', data:[], spanGaps:true},
      {label:'Mediana gruppo', borderColor:'#0ea5e9', backgroundColor:'rgba(14,165,233,.12)', data:[], spanGaps:true}
    ]},
    options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, animation:{duration:0}, plugins:{legend:{display:false}, tooltip:{enabled:true}}, elements:{line:{tension:.3}, point:{radius:3}}});
  histChart = new Chart(document.querySelector('#histChartHost canvas').getContext('2d'), {
    type:'bar', data:{datasets:[{label:'Frequenza %', data:[], parsing:{xAxisKey:'x', yAxisKey:'y'}, backgroundColor:'rgba(2,132,199,.25)', borderColor:'#0284c7'}]},
    options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, animation:{duration:0}, scales:{x:{type:'linear'}, y:{beginAtZero:true,ticks:{callback:v=>v+'%'}}}, plugins:{legend:{display:false}, tooltip:{enabled:true}, annotation:{annotations:{}}}});
}

function updatePR(rows){
  const by = getYMMap(rows);
  const years = Array.from(new Set(rows.map(r=>r.year))).sort();
  const avail = new Set(years);
  [['yr2023',2023],['yr2024',2024],['yr2025',2025]].forEach(([id,y])=>{
    const el=document.getElementById(id); if(el){ el.disabled=!avail.has(y); if(!avail.has(y)) el.checked=false; }
  });
  const sels = [2023,2024,2025].filter(y=>{ const el=document.getElementById('yr'+y); return el && el.checked && avail.has(y); });
  const colors = {2023:'#3b82f6', 2024:'#f59e0b', 2025:'#22c55e'};
  const trans = v => lowerIsBetter(state.currentKpi) ? -v : v;

  const ds = sels.map(y=>{
    const arr = new Array(12).fill(null);
    for(let m=0;m<12;m++){
      const b=by.get(`${y}-${m}`); if(!b) continue;
      const vals = Array.from(b.by.values()).map(trans);
      const v = b.by.get(state.azienda); const tv = (v!=null)? trans(v) : null;
      arr[m] = percentileRank(vals, tv);
    }
    return {label:String(y), data:arr, borderColor:colors[y], backgroundColor:colors[y]+'22', spanGaps:true};
  });
  prChart.data.datasets = ds; prChart.update();
}

function updateKPI(rows){
  const by = getYMMap(rows);
  const years = Array.from(new Set(rows.map(r=>r.year))).sort();
  const latest = years[years.length-1];
  const azi = new Array(12).fill(null), med = new Array(12).fill(null);
  for(let m=0;m<12;m++){
    const b=by.get(`${latest}-${m}`); if(!b) continue;
    const vals = Array.from(b.by.values());
    azi[m] = b.by.get(state.azienda) ?? null;
    med[m] = median(vals);
  }
  kpiChart.data.datasets[0].data = azi;
  kpiChart.data.datasets[1].data = med;
  kpiChart.update();
}

function freedmanBins(values){
  const n=values.length; if(n<2) return 6;
  const s=values.slice().sort((a,b)=>a-b);
  const q1=s[Math.floor(0.25*(n-1))], q3=s[Math.floor(0.75*(n-1))];
  const iqr=(q3-q1) || (s[n-1]-s[0])/4 || 1;
  const h=2*iqr*Math.pow(n,-1/3);
  const bins=Math.ceil((s[n-1]-s[0])/(h||1))||6;
  return Math.max(6,Math.min(15,bins));
}

let lastHistKey = '';
function updateHistogram(rows){
  const dates = rows.map(r=>new Date(r.year, r.month, 1)).sort((a,b)=>a-b);
  if(!dates.length){ histChart.data.datasets[0].data=[]; histChart.update(); return; }
  const maxD = dates[dates.length-1];

  let inPeriod = rows, key;
  if(state.histPeriod.type==='months'){
    const minD = new Date(maxD); minD.setMonth(minD.getMonth()-(state.histPeriod.value-1));
    inPeriod = rows.filter(r=>{ const d=new Date(r.year,r.month,1); return d>=minD && d<=maxD; });
    key = `${state.currentKpi}|m${state.histPeriod.value}`;
  }else{
    inPeriod = rows.filter(r=>{ const d=new Date(r.year,r.month,1); return d>=state.histPeriod.from && d<=state.histPeriod.to; });
    key = `${state.currentKpi}|c${state.histPeriod.from?.toISOString().slice(0,7)}_${state.histPeriod.to?.toISOString().slice(0,7)}`;
  }
  if(key === lastHistKey) return;
  lastHistKey = key;

  const vals = inPeriod.map(r=>r.value);
  if(!vals.length){ histChart.data.datasets[0].data=[]; histChart.update(); document.getElementById('posBadge').textContent='—° percentile'; return; }

  const bins = freedmanBins(vals);
  const min=Math.min(...vals), max=Math.max(...vals), step=(max-min)/bins or 1;
  const centers = Array.from({length:bins}, (_,i)=>min+(i+0.5)*step);
  const counts = Array(bins).fill(0);
  vals.forEach(v=>{ let idx=Math.floor((v-min)/(step||1)); if(idx>=bins) idx=bins-1; if(idx<0) idx=0; counts[idx]++; });
  const total = counts.reduce((a,b)=>a+b,0) || 1;
  const data = centers.map((c,i)=>({x:c, y: Math.round((counts[i]/total)*1000)/10 }));

  const aziVals = inPeriod.filter(r=>r.Azienda===state.azienda).sort((a,b)=> (a.year-b.year)||(a.month-b.month)).map(r=>r.value);
  const last = aziVals[aziVals.length-1];
  const pr = percentileRank(vals, last);

  histChart.data.datasets[0].data = data;
  histChart.options.scales.x = {type:'linear', min:min, max:max};
  histChart.options.plugins.annotation.annotations = last!=null ? {
    azi: {type:'line', xMin:last, xMax:last, borderColor:'#ef4444', borderWidth:2,
      label:{enabled:true, content:`Azienda: ${last?.toFixed(2)} (PR ${pr})`, rotation:90, backgroundColor:'rgba(239,68,68,.15)', color:'#ef4444'}}
  } : {};
  histChart.update();

  document.getElementById('posBadge').textContent = pr!=null? `${pr}° percentile` : '—° percentile';
}

function refresh(){
  cache.ymByKpi.delete(state.currentKpi);
  lastHistKey = '';
  const rows = rowsForKpi(RAW, state.currentKpi);
  updatePR(rows); updateKPI(rows); updateHistogram(rows);
  document.getElementById('aziendaHeader').textContent = state.azienda;
}

function bindOnce(){
  document.getElementById('indicatore').addEventListener('change', e=>{ state.currentKpi=e.target.value; refresh(); });
  ['yr2023','yr2024','yr2025'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('change', refresh); });

  const vt = document.getElementById('viewToggle');
  vt?.addEventListener('click', (e)=>{
    if(e.target.htmlFor==='miei-dati'){ vt.dataset.active='miei'; document.getElementById('view-miei').classList.add('active'); document.getElementById('view-conf').classList.remove('active'); }
    if(e.target.htmlFor==='confronto'){ vt.dataset.active='conf'; document.getElementById('view-conf').classList.add('active'); document.getElementById('view-miei').classList.remove('active'); }
  });

  const preset=document.getElementById('distPreset');
  const wrap=document.getElementById('customPeriod');
  const apply=document.getElementById('applyCustom');
  preset.addEventListener('change',()=>{
    if(preset.value==='custom') wrap.style.display='flex';
    else{ wrap.style.display='none'; state.histPeriod={type:'months', value:Number(preset.value)}; refresh(); }
  });
  apply.addEventListener('click',()=>{
    const f=document.getElementById('fromMonth').value, t=document.getElementById('toMonth').value;
    if(!f||!t) return;
    const [fy,fm]=f.split('-').map(Number), [ty,tm]=t.split('-').map(Number);
    state.histPeriod={type:'custom', from:new Date(fy,fm-1,1), to:new Date(ty,tm-1,1)};
    refresh();
  });
}

document.addEventListener('DOMContentLoaded', async ()=>{
  ensureCharts(); bindOnce();
  try{
    const resp = await fetch('data.json', {cache:'no-store'});
    RAW = await resp.json();
  }catch(e){ console.error('Errore nel caricamento dei dati', e); RAW = []; }
  refresh();
});
