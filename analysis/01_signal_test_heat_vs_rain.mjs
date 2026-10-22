import fs from 'fs'; import readline from 'readline';
const NAMES={PH015518000:'Dagupan',PH034919000:'Palayan',PH050506000:'Legazpi',PH063022000:'Iloilo',PH072230000:'Mandaue',PH083747000:'Tacloban',PH097332000:'Zamboanga',PH104305000:'Cagayan de Oro',PH112402000:'Davao',PH137401000:'Mandaluyong',PH137503000:'Navotas',PH137603000:'Muntinlupa'};
const monday=s=>{const d=new Date(s+'T00:00:00Z');const k=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-k);return d.toISOString().slice(0,10)};
const addDays=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
// ---- climate -> city-week
const clim={}; // city -> week -> {n,tmax,hi,pr}
let cache=fs.existsSync('clim_week.json')?JSON.parse(fs.readFileSync('clim_week.json')):null;
if(!cache){
  const rl=readline.createInterface({input:fs.createReadStream('climate_atmosphere.csv')});let first=true;
  for await(const line of rl){ if(first){first=false;continue}
    const p=line.split(',');const city=p[1].slice(0,8)+'000';const w=monday(p[2]);
    const c=(clim[city]??={});const o=(c[w]??={n:0,tmax:0,hi:0,pr:0});
    o.n++;o.tmax+=+p[6];o.hi+=+p[7];o.pr+=+p[8]; }
  for(const c in clim)for(const w in clim[c]){const o=clim[c][w];clim[c][w]={tmax:o.tmax/o.n,hi:o.hi/o.n,pr:o.pr/o.n*7}}
  fs.writeFileSync('clim_week.json',JSON.stringify(clim));cache=clim;
}
const C=cache;
// ---- outcomes
function load(file,valIdx,pick){const out={};const rows=fs.readFileSync(file,'utf8').split('\n');
  for(let i=1;i<rows.length;i++){const p=rows[i].split(',');if(p.length<9)continue;const g=pick(p[6],p[7]);if(!g)continue;
    const v=+p[valIdx];if(!isFinite(v))continue;const w=monday(p[2]);((out[g]??={})[p[5]]??={})[w]=((out[g][p[5]][w])||0)+v}return out}
const deaths=load('disease_psa_totals.csv',8,(code)=>['I21-I22','I11','I20-I25'].includes(code)?'cvd':code==='T67'?'heatstroke':code==='E08-E14'?'diabetes':code==='J45'?'asthma':null);
const cases=load('disease_pidsr_totals.csv',8,(code,name)=>/LEPTO/.test(name)?'lepto':/BLOODY/.test(name)?'abd':/TYPHOID/.test(name)?'typhoid':/CHOLERA/.test(name)?'cholera':null);
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const pearson=(x,y)=>{const mx=mean(x),my=mean(y);let a=0,b=0,c=0;for(let i=0;i<x.length;i++){a+=(x[i]-mx)*(y[i]-my);b+=(x[i]-mx)**2;c+=(y[i]-my)**2}return a/Math.sqrt(b*c)};
const tstat=(r,n)=>r*Math.sqrt((n-2)/(1-r*r));
const woy=w=>Math.min(52,Math.floor((new Date(w+'T00:00:00Z')-new Date(w.slice(0,4)+'-01-01T00:00:00Z'))/6048e5));
// build per-city weekly series with deseasonalised anomalies
function series(city,outcome,y0,y1,xfn,transform){
  const cw=C[city];if(!cw)return[];const rows=[];
  for(const w of Object.keys(cw).sort()){const y=+w.slice(0,4);if(y<y0||y>y1)continue;rows.push({w,y,k:woy(w),x:xfn(cw,w),d:(outcome[city]?.[w])||0})}
  const ym={};rows.forEach(r=>{(ym[r.y]??=[]).push(r.d)});
  rows.forEach(r=>{const m=mean(ym[r.y]);r.v=transform==='log'?Math.log(1+r.d):(m>0?r.d/m:NaN)});
  const ok=rows.filter(r=>isFinite(r.v)&&isFinite(r.x));
  const kx={},kv={};ok.forEach(r=>{(kx[r.k]??=[]).push(r.x);(kv[r.k]??=[]).push(r.v)});
  ok.forEach(r=>{r.xa=r.x-mean(kx[r.k]);r.va=r.v-mean(kv[r.k])});return ok}
function report(title,outcome,key,y0,y1,xfn,transform,minTotal){
  console.log('\n=== '+title);let px=[],pv=[],praw=[];
  for(const city of Object.keys(NAMES)){const tot=Object.entries(outcome[key]?.[city]||{}).filter(([w])=>+w.slice(0,4)>=y0&&+w.slice(0,4)<=y1).reduce((s,[,v])=>s+v,0);
    if(tot<minTotal)continue;const s=series(city,outcome[key],y0,y1,xfn,transform);if(s.length<100)continue;
    const r=pearson(s.map(r=>r.xa),s.map(r=>r.va));
    // top decile of x anomaly vs rest, effect on raw outcome ratio
    const thr=[...s.map(r=>r.xa)].sort((a,b)=>a-b)[Math.floor(s.length*.9)];
    const hot=s.filter(r=>r.xa>=thr),rest=s.filter(r=>r.xa<thr);
    const eff=transform==='log'?(mean(hot.map(r=>r.d))/mean(rest.map(r=>r.d))):(1+mean(hot.map(r=>r.va))-mean(rest.map(r=>r.va)));
    console.log(`${NAMES[city].padEnd(15)} total=${String(Math.round(tot)).padStart(6)} weeks=${s.length} r=${r.toFixed(3)} t=${tstat(r,s.length).toFixed(1)}  top-decile weeks vs rest: x${eff.toFixed(2)}`);
    // standardise anomalies per city before pooling
    const sx=Math.sqrt(mean(s.map(r=>r.xa**2))),sv=Math.sqrt(mean(s.map(r=>r.va**2)));s.forEach(r=>{px.push(r.xa/sx);pv.push(r.va/sv)})}
  if(px.length){const r=pearson(px,pv);console.log(`POOLED          n=${px.length} r=${r.toFixed(3)} t=${tstat(r,px.length).toFixed(1)}`)}}
const lagx=(f,l)=>(cw,w)=>{const o=cw[addDays(w,-7*l)];return o?o[f]:NaN};
const rainsum=(from,to)=>(cw,w)=>{let s=0;for(let l=from;l<=to;l++){const o=cw[addDays(w,-7*l)];if(!o)return NaN;s+=o.pr}return s};
console.log('Heat stroke deaths recorded 2006-2021, all 12 cities:',Object.values(deaths.heatstroke||{}).reduce((s,c)=>s+Object.values(c).reduce((a,b)=>a+b,0),0));
report('HEAT: heart-disease deaths vs heat index, same week (2006-2019, deseasonalised)',deaths,'cvd',2006,2019,lagx('hi',0),'ratio',3000);
report('HEAT: heart-disease deaths vs max temperature, same week',deaths,'cvd',2006,2019,lagx('tmax',0),'ratio',3000);
report('HEAT: heart-disease deaths vs heat index, 1 week earlier',deaths,'cvd',2006,2019,lagx('hi',1),'ratio',3000);
report('HEAT: diabetes deaths vs heat index, same week',deaths,'diabetes',2006,2019,lagx('hi',0),'ratio',2000);
report('FLOOD: leptospirosis cases vs rainfall summed over the 1-2 weeks before (2008-2022, deseasonalised)',cases,'lepto',2008,2022,rainsum(1,2),'log',150);
report('FLOOD: leptospirosis cases vs rainfall summed over the 2-4 weeks before',cases,'lepto',2008,2022,rainsum(2,4),'log',150);
report('FLOOD: acute bloody diarrhea cases vs rainfall 1-2 weeks before',cases,'abd',2008,2022,rainsum(1,2),'log',150);
report('FLOOD: typhoid cases vs rainfall 1-2 weeks before',cases,'typhoid',2008,2022,rainsum(1,2),'log',300);
// raw seasonal view: CVD death ratio by heat-index quintile within city
console.log('\n=== RAW (not deseasonalised): heart-disease death ratio by heat-index quintile, pooled cities');
{const q=[[],[],[],[],[]];for(const city of Object.keys(NAMES)){const s=series(city,deaths.cvd,2006,2019,lagx('hi',0),'ratio');if(s.length<100)continue;const xs=[...s.map(r=>r.x)].sort((a,b)=>a-b);s.forEach(r=>{const i=Math.min(4,Math.floor(xs.findIndex(v=>v>=r.x)/xs.length*5));q[i].push(r.v)})}
 console.log(q.map((a,i)=>`Q${i+1}: ${mean(a).toFixed(3)} (n=${a.length})`).join('  '))}
console.log('\n=== RAW: leptospirosis mean weekly cases by quintile of rainfall 1-2 weeks before, pooled cities');
{const q=[[],[],[],[],[]];for(const city of Object.keys(NAMES)){const s=series(city,cases.lepto,2008,2022,rainsum(1,2),'log');if(s.length<100)continue;const xs=[...s.map(r=>r.x)].sort((a,b)=>a-b);s.forEach(r=>{const i=Math.min(4,Math.floor(xs.findIndex(v=>v>=r.x)/xs.length*5));q[i].push(r.d)})}
 console.log(q.map((a,i)=>`Q${i+1}: ${mean(a).toFixed(2)} (n=${a.length})`).join('  '))}
