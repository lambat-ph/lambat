import fs from 'fs';
const NAMES={PH015518000:'Dagupan',PH063022000:'Iloilo',PH137503000:'Navotas',PH137603000:'Muntinlupa',PH137401000:'Mandaluyong',PH112402000:'Davao',PH104305000:'Cagayan de Oro',PH097332000:'Zamboanga'};
const C=JSON.parse(fs.readFileSync('clim_week.json'));
const monday=s=>{const d=new Date(s+'T00:00:00Z');const k=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-k);return d.toISOString().slice(0,10)};
const addDays=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const lep={};for(const row of fs.readFileSync('disease_pidsr_totals.csv','utf8').split('\n').slice(1)){const p=row.split(',');if(p.length<9||!/LEPTO/.test(p[7]))continue;const w=monday(p[2]);(lep[p[5]]??={})[w]=((lep[p[5]][w])||0)+(+p[8])}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const woy=w=>Math.min(51,Math.floor((new Date(w+'T00:00:00Z')-new Date(w.slice(0,4)+'-01-01T00:00:00Z'))/6048e5));
// OLS via normal equations
function ols(X,y){const k=X[0].length,A=Array.from({length:k},()=>Array(k+1).fill(0));
  for(let i=0;i<X.length;i++)for(let a=0;a<k;a++){A[a][k]+=X[i][a]*y[i];for(let b=0;b<k;b++)A[a][b]+=X[i][a]*X[i][b]}
  for(let a=0;a<k;a++)A[a][a]+=1e-6;
  for(let c=0;c<k;c++){let p=c;for(let r=c+1;r<k;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;[A[c],A[p]]=[A[p],A[c]];
    for(let r=0;r<k;r++)if(r!==c){const f=A[r][c]/A[c][c];for(let j=c;j<=k;j++)A[r][j]-=f*A[c][j]}}
  return A.map((r,i)=>r[k]/r[i])}
console.log('Cases per year by city:');
for(const [c,n] of Object.entries(NAMES)){const y={};for(const [w,v] of Object.entries(lep[c]||{}))y[w.slice(0,4)]=(y[w.slice(0,4)]||0)+v;console.log(' ',n.padEnd(15),Object.entries(y).sort().map(([k,v])=>k.slice(2)+':'+v).join(' '))}
console.log('\nHold-out forecast test. Train 2008-2016, test 2017-2019. Target: weekly cases. Lead time = 2 weeks (uses only rain up to 2 weeks before).');
console.log('Baseline = average cases for that week of the year in the training years.');
for(const [c,n] of Object.entries(NAMES)){const cw=C[c];const rows=[];
  for(const w of Object.keys(cw).sort()){const y=+w.slice(0,4);if(y<2008||y>2019)continue;const r=[2,3,4,5].map(l=>cw[addDays(w,-7*l)]?.pr);if(r.some(v=>v===undefined))continue;rows.push({w,y,k:woy(w),r,d:(lep[c]?.[w])||0})}
  const tr=rows.filter(r=>r.y<=2016),te=rows.filter(r=>r.y>=2017);
  const clim=Array.from({length:52},(_,k)=>{const v=tr.filter(r=>r.k===k).map(r=>Math.log1p(r.d));return v.length?mean(v):0});
  const smooth=clim.map((_,k)=>mean([-2,-1,0,1,2].map(o=>clim[(k+o+52)%52])));
  const feat=r=>[1,smooth[r.k],...r.r.map(v=>Math.log1p(v)),Math.log1p(r.r[0]+r.r[1])*smooth[r.k]];
  const b=ols(tr.map(feat),tr.map(r=>Math.log1p(r.d)));
  const pred=r=>Math.max(0,Math.expm1(feat(r).reduce((s,x,i)=>s+x*b[i],0)));const base=r=>Math.expm1(smooth[r.k]);
  const mae=f=>mean(te.map(r=>Math.abs(f(r)-r.d)));
  // outbreak weeks: test weeks above the 90th percentile of training weekly cases
  const thr=[...tr.map(r=>r.d)].sort((a,b)=>a-b)[Math.floor(tr.length*.9)];const out=te.filter(r=>r.d>thr);
  const hit=f=>out.length?out.filter(r=>f(r)>thr).length:0;
  const corr=(f)=>{const x=te.map(f),y=te.map(r=>r.d),mx=mean(x),my=mean(y);let a=0,bb=0,cc=0;for(let i=0;i<x.length;i++){a+=(x[i]-mx)*(y[i]-my);bb+=(x[i]-mx)**2;cc+=(y[i]-my)**2}return a/Math.sqrt(bb*cc)};
  console.log(` ${n.padEnd(15)} test weeks=${te.length} cases=${te.reduce((s,r)=>s+r.d,0)}  MAE model=${mae(pred).toFixed(2)} baseline=${mae(base).toFixed(2)} (${(100*(1-mae(pred)/mae(base))).toFixed(0)}% better)  corr model=${corr(pred).toFixed(2)} baseline=${corr(base).toFixed(2)}  outbreak weeks(>${thr}) caught: model ${hit(pred)}/${out.length}, baseline ${hit(base)}/${out.length}`)}
