import fs from 'fs'; import readline from 'readline';
const NAMES={PH015518000:'Dagupan',PH050506000:'Legazpi',PH063022000:'Iloilo',PH072230000:'Mandaue',PH083747000:'Tacloban',PH097332000:'Zamboanga',PH104305000:'Cagayan de Oro',PH112402000:'Davao',PH137401000:'Mandaluyong',PH137503000:'Navotas',PH137603000:'Muntinlupa'};
const monday=s=>{const d=new Date(s+'T00:00:00Z');const k=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-k);return d.toISOString().slice(0,10)};
const addDays=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const F=['no2','co','so2','o3','pm10','pm25'];
let A;
if(fs.existsSync('air_week.json'))A=JSON.parse(fs.readFileSync('air_week.json'));
else{A={};const rl=readline.createInterface({input:fs.createReadStream('climate_air_quality.csv')});let first=true;
  for await(const line of rl){if(first){first=false;continue}const p=line.split(',');const city=p[1].slice(0,8)+'000';const w=monday(p[2]);
    const o=((A[city]??={})[w]??={n:0,no2:0,co:0,so2:0,o3:0,pm10:0,pm25:0});o.n++;for(let i=0;i<6;i++)o[F[i]]+=+p[4+i]}
  for(const c in A)for(const w in A[c]){const o=A[c][w];for(const f of F)o[f]/=o.n}
  fs.writeFileSync('air_week.json',JSON.stringify(A))}
const out={};for(const row of fs.readFileSync('disease_psa_totals.csv','utf8').split('\n').slice(1)){const p=row.split(',');if(p.length<9)continue;
  const g=['I21-I22','I11','I20-I25'].includes(p[6])?'cvd':p[6]==='J45'?'asthma':null;if(!g)continue;const w=monday(p[2]);((out[g]??={})[p[5]]??={})[w]=((out[g][p[5]][w])||0)+(+p[8])}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const pearson=(x,y)=>{const mx=mean(x),my=mean(y);let a=0,b=0,c=0;for(let i=0;i<x.length;i++){a+=(x[i]-mx)*(y[i]-my);b+=(x[i]-mx)**2;c+=(y[i]-my)**2}return a/Math.sqrt(b*c)};
const woy=w=>Math.min(52,Math.floor((new Date(w+'T00:00:00Z')-new Date(w.slice(0,4)+'-01-01T00:00:00Z'))/6048e5));
function test(key,f,lag,y0=2006,y1=2019){let px=[],pv=[],per=[];
  for(const city of Object.keys(NAMES)){const cw=A[city];if(!cw)continue;const rows=[];
    for(const w of Object.keys(cw).sort()){const y=+w.slice(0,4);if(y<y0||y>y1)continue;const o=cw[addDays(w,-7*lag)];if(!o)continue;rows.push({y,k:woy(w),x:o[f],d:(out[key]?.[city]?.[w])||0})}
    const tot=rows.reduce((s,r)=>s+r.d,0);if(tot<(key==='asthma'?250:3000))continue;
    const ym={};rows.forEach(r=>(ym[r.y]??=[]).push(r.d));rows.forEach(r=>{const m=mean(ym[r.y]);r.v=m>0?r.d/m:NaN});
    const ok=rows.filter(r=>isFinite(r.v));const kx={},kv={};ok.forEach(r=>{(kx[r.k]??=[]).push(r.x);(kv[r.k]??=[]).push(r.v)});
    ok.forEach(r=>{r.xa=r.x-mean(kx[r.k]);r.va=r.v-mean(kv[r.k])});
    const r=pearson(ok.map(r=>r.xa),ok.map(r=>r.va));per.push(`${NAMES[city]} ${r.toFixed(2)}`);
    const sx=Math.sqrt(mean(ok.map(r=>r.xa**2))),sv=Math.sqrt(mean(ok.map(r=>r.va**2)));ok.forEach(r=>{px.push(r.xa/sx);pv.push(r.va/sv)})}
  const r=pearson(px,pv),t=r*Math.sqrt((px.length-2)/(1-r*r));
  console.log(`${key.padEnd(6)} vs ${f.padEnd(5)} lag ${lag}wk: pooled r=${r.toFixed(3)} t=${t.toFixed(1)} n=${px.length} | ${per.join(', ')}`)}
console.log('Asthma deaths total:',Object.values(out.asthma).reduce((s,c)=>s+Object.values(c).reduce((a,b)=>a+b,0),0));
for(const key of ['asthma','cvd'])for(const f of ['pm25','pm10','no2','o3','so2'])for(const lag of [0,1])test(key,f,lag);
// how bad is the air: share of city-weeks above WHO 24h PM2.5 guideline (15) and mean by city
console.log('\nMean weekly PM2.5 by city 2015-2022 (ug/m3):');for(const c of Object.keys(NAMES)){const v=Object.entries(A[c]).filter(([w])=>+w.slice(0,4)>=2015).map(([,o])=>o.pm25);console.log(' ',NAMES[c].padEnd(15),mean(v).toFixed(1),' weeks>15:',(100*v.filter(x=>x>15).length/v.length).toFixed(0)+'%')}
