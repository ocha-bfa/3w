// Présence opérationnelle (3W) — rendu des feuilles. Données lues dans Supabase (vue v_3w_app), voir sql/.
// Une ligne de la vue = période × organisation × cluster × zone (commune, ou province quand la commune n'est pas connue).
// Règle de comptage (identique au produit PDF) : une organisation = un acronyme distinct, qu'elle soit organisation
// principale ou partenaire de mise en œuvre ; jamais d'addition entre périodes ou entre régions (toujours des ensembles distincts).
// Régions, provinces et communes : découpage 2025 (data/geo_bfa.js), codes nettoyés en base (voir CLAUDE.md).

/* ---------- accès Supabase (clé publique, lecture seule) ---------- */
const SB_URL='https://vshnatreclfntadwcyhy.supabase.co';
const SB_KEY='sb_publishable_aNoGyj5YIlLWE9N8d0O07g_gn73kTc1';
async function sb(path){
  const r=await fetch(`${SB_URL}/rest/v1/${path}`,{headers:{apikey:SB_KEY,Authorization:'Bearer '+SB_KEY}});
  if(!r.ok) throw new Error(`${path.split('?')[0]} → HTTP ${r.status}`);
  return r.json();
}
async function sbAll(path){
  const out=[];for(let off=0;;off+=1000){const p=await sb(`${path}${path.includes('?')?'&':'?'}limit=1000&offset=${off}`);out.push(...p);if(p.length<1000)return out}
}

/* ---------- référentiels ---------- */
const BIM=['','janvier-février','mars-avril','mai-juin','juillet-août','septembre-octobre','novembre-décembre'];
const BIM_SHORT=['','Jan–fév','Mar–avr','Mai–juin','Juil–août','Sep–oct','Nov–déc'];
// clusters dans l'ordre du produit imprimé
const CLUSTERS=[
  {k:'WASH',n:'Eau, hygiène et assainissement',s:'EHA',h:'EHA'},
  {k:'ABRIS',n:'Abris et articles ménagers essentiels',s:'Abris/AME',h:'Abris'},
  {k:'SECAL',n:'Sécurité alimentaire',s:'Sécurité alim.',h:'SECAL'},
  {k:'PRO',n:'Protection',s:'Protection',h:'Prot.'},
  {k:'SANTE',n:'Santé',s:'Santé',h:'Santé'},
  {k:'NUT',n:'Nutrition',s:'Nutrition',h:'Nut.'},
  {k:'EDU',n:'Éducation',s:'Éducation',h:'Éduc.'},
  {k:'GSAT',n:"Gestion des sites d'accueil temporaires",s:'GSAT',h:'GSAT'}];
const CL=Object.fromEntries(CLUSTERS.map(c=>[c.k,c]));
const TYPES=['ONG nationale','ONG internationale','Nations Unies','Gouvernement','Consortium','Mouvement Croix-Rouge','Autre','Non renseigné'];
const ART={BF47:"du ",BF60:"de la ",BF58:"de la ",BF55:"de l'"};
const regionTitle=p=>{const r=GEO.R.find(x=>x.p===p);return r?`région ${ART[p]||'du '}${r.n}`:''};
const RNAME=p=>(GEO.R.find(x=>x.p===p)||{}).n||p;
const PNAME=p=>(GEO.P.find(x=>x.p===p)||{}).n||p;
const CBY={};GEO.C.forEach(c=>CBY[c.p]=c);
const MAPW_NAT=360, MAPW_REG=330, MAPW_ORG=400;

/* ---------- état ---------- */
let S={p:null,lens:'national',region:null,org:null,q:''};
let ROWS=[], PERIODS=[]; // PERIODS = [{key:'2026-3', annee, ordre, label}]

/* ---------- helpers ---------- */
const f=v=>Math.round(v).toLocaleString('fr-FR');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pkey=r=>`${r.annee}-${r.bimestre_ordre}`;
const rowsP=(p,fn)=>ROWS.filter(r=>pkey(r)===p&&(!fn||fn(r)));
const orgs=rows=>new Set(rows.map(r=>r.org));
const nOrgs=rows=>orgs(rows).size;
const distinct=(rows,k)=>new Set(rows.map(r=>r[k]).filter(Boolean)).size;
const activites=rows=>rows.filter(r=>r.principal).reduce((s,r)=>s+(+r.activites||0),0);
const prevOf=p=>{const i=PERIODS.findIndex(x=>x.key===p);return i>0?PERIODS[i-1]:null};
const plabel=p=>{const x=PERIODS.find(x=>x.key===p);return x?`${x.label} ${x.annee}`:''};
// organisations par commune : la commune de la ligne, ou les communes citées quand la ligne couvre plusieurs communes
function byCommune(rows){const o={};rows.forEach(r=>{const cs=r.adm3_pcode?[r.adm3_pcode]:(r.communes_citees||[]);cs.forEach(c=>{(o[c]=o[c]||new Set()).add(r.org)})});return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v.size]))}
function byKeySet(rows,key){const o={};rows.forEach(r=>{const k=key(r);if(!k)return;(o[k]=o[k]||new Set()).add(r.org)});return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v.size]))}
const clsC=v=>v<=0?'c0':v<=5?'c1':v<=20?'c2':'c3';            // communes : 1–5, 6–20, 21+
const clsR=v=>v<=0?'c0':v<=5?'c1':v<=20?'c2':v<=40?'c3':'c4';  // régions : 1–5, 6–20, 21–40, 41+
const clsT=v=>v<=0?'c0':v<=5?'c1':v<=10?'c2':v<=20?'c3':'c4';  // cellules des tableaux
const LEG_C=`<span><i style="background:var(--none)"></i>0</span><span><i style="background:var(--b1)"></i>1 – 5</span><span><i style="background:var(--b2)"></i>6 – 20</span><span><i style="background:var(--b3)"></i>21 et plus</span>`;
const LEG_R=`<span><i style="background:var(--b1)"></i>1 – 5</span><span><i style="background:var(--b2)"></i>6 – 20</span><span><i style="background:var(--b3)"></i>21 – 40</span><span><i style="background:var(--b4)"></i>41 et plus</span>`;
const ICON_ORG=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V9l9-6 9 6v12h-6v-6H9v6H3z" fill="currentColor"/></svg>`;
const ICON_PIN=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>`;
const delta=(a,b)=>b==null?'':`<small class="${a>b?'up':a<b?'dn':''}">${a>b?'+':''}${f(a-b)}</small>`;

/* ---------- composants ---------- */
function kbox(el,items){el.classList.toggle('one',items.length===1);el.innerHTML=items.map(i=>`<div class="kpi ${i.cls||''}">${i.icon||ICON_ORG}<div class="v">${i.v}${i.d||''}</div><div class="l">${i.l}</div></div>`).join('')}
function kmini(el,items){el.innerHTML=items.map(i=>`<div><div class="v">${i.v}${i.d!==undefined&&i.d!==null?`<small class="d ${i.d>0?'up':i.d<0?'dn':''}">${i.d>0?'+':''}${f(i.d)}${i.dl?' '+i.dl:''}</small>`:''}</div><div class="l">${i.l}</div></div>`).join('')}
function hbars(el,items,opt={}){const max=Math.max(1,...items.map(i=>i.v));if(opt.lw)el.style.setProperty('--lw',opt.lw);
  el.innerHTML=items.length?items.map(i=>`<div class="r ${i.k?'hit':''}" ${i.k?`data-k="${esc(i.k)}"`:''}><span class="n" title="${esc(i.l)}">${esc(i.l)}</span><span class="b ${i.p?'p':''}" style="--w:${(i.v/max).toFixed(3)}"><i></i><span>${i.v?f(i.v):'–'}</span></span></div>`).join(''):`<div class="na">Aucune organisation</div>`;
  if(opt.onClick)el.querySelectorAll('.r.hit').forEach(r=>r.addEventListener('click',()=>opt.onClick(r.dataset.k)))}
// tableau croisé zones × clusters ; rows = [{k, l, cells:{cluster:n}, tot}]
function xtable(el,rows,opt={}){
  const tot={};CLUSTERS.forEach(c=>tot[c.k]=opt.totals?opt.totals[c.k]||0:0);
  el.innerHTML=`<table><thead><tr><th>${esc(opt.first||'Région')}</th>${CLUSTERS.map(c=>`<th title="${esc(c.n)}">${esc(c.h)}</th>`).join('')}<th class="t">Total</th></tr></thead><tbody>
    ${rows.map(r=>`<tr class="${opt.onClick?'hit':''}" data-k="${esc(r.k)}"><td title="${esc(r.l)}">${esc(r.l)}</td>${CLUSTERS.map(c=>{const v=r.cells[c.k]||0;return `<td class="${clsT(v)}">${v||''}</td>`}).join('')}<td class="t">${r.tot}</td></tr>`).join('')}</tbody>
    ${opt.totals?`<tfoot><tr><td>Total</td>${CLUSTERS.map(c=>`<td>${tot[c.k]||''}</td>`).join('')}<td class="t">${opt.grand}</td></tr></tfoot>`:''}</table>`;
  if(opt.onClick)el.querySelectorAll('tr.hit').forEach(tr=>tr.addEventListener('click',()=>opt.onClick(tr.dataset.k)));
}

/* ---------- cartes ---------- */
function bbox(d){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;d.replace(/(-?[\d.]+),(-?[\d.]+)/g,(m,x,y)=>{x=+x;y=+y;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y});return[x0,y0,x1,y1]}
// carte nationale par région : choroplèthe + nombre d'organisations dans chaque région
function mapRegions(el,byReg,width,height,onClick){
  const vb=[0,0,GEO.W,GEO.H], scale=Math.min(width/vb[2],height/vb[3]), fl=6.5/scale, fn=10/scale;
  const paths=GEO.R.map(r=>{const v=byReg[r.p]||0;return `<path class="${clsR(v)} hit" d="${r.d}" data-k="${r.p}"><title>${r.n} — ${v} organisation${v>1?'s':''}</title></path>`}).join('');
  const labels=GEO.R.map(r=>{const v=byReg[r.p]||0;const [x0,y0,x1,y1]=bbox(r.d);const small=(y1-y0)<fl*4||(x1-x0)<r.n.length*fl*1.0;
    return `${small?'':`<text x="${r.c[0]}" y="${r.c[1]-fl*0.55}" font-size="${fl.toFixed(2)}" ${v>20?'fill="#fff" style="stroke:#1F4E79"':''}>${r.n}</text>`}<text class="c ${v>20?'dk':''}" x="${r.c[0]}" y="${r.c[1]+(small?fn*0.35:fn*0.8)}" font-size="${fn.toFixed(2)}" font-weight="700"><title>${r.n}</title>${v||''}</text>`}).join('');
  el.innerHTML=`<svg class="map" style="height:${height}px" viewBox="${vb.join(' ')}" preserveAspectRatio="xMidYMid meet" role="img">${paths}<path class="a0" d="${GEO.A0}"/>${labels}</svg>`;
  if(onClick)el.querySelectorAll('path.hit').forEach(p=>p.addEventListener('click',()=>onClick(p.dataset.k)));
}
// carte nationale par commune (petites cartes par cluster, fiche organisation)
function mapCommunes(el,byCom,width,height,opt={}){
  const vb=[0,0,GEO.W,GEO.H], scale=Math.min(width/vb[2],height/vb[3]), fl=7/scale, fc=6/scale;
  const paths=GEO.C.map(c=>{const v=byCom[c.p]||0;return `<path class="${opt.binary?(v?'c3':'c0'):clsC(v)} hit" d="${c.d}" data-k="${c.p}"><title>${c.n} (${PNAME(c.v)}) — ${v?v+' organisation'+(v>1?'s':''):'aucune'}</title></path>`}).join('');
  const rl=opt.labels?GEO.R.map(r=>`<text x="${r.c[0]}" y="${r.c[1]}" font-size="${fl.toFixed(2)}">${r.n}</text>`).join(''):'';
  const cl=opt.communeLabels?GEO.C.filter(c=>byCom[c.p]>0).map(c=>`<text class="c" x="${c.c[0]}" y="${c.c[1]+fc*0.35}" font-size="${fc.toFixed(2)}">${c.n}</text>`).join(''):'';
  el.innerHTML=`<svg class="map" style="height:${height}px" viewBox="${vb.join(' ')}" preserveAspectRatio="xMidYMid meet" role="img">${paths}${GEO.R.map(r=>`<path class="r" d="${r.d}"/>`).join('')}<path class="a0" d="${GEO.A0}"/>${rl}${cl}</svg>`;
  el.querySelectorAll('path.hit').forEach(p=>p.addEventListener('click',()=>{const c=CBY[p.dataset.k];if(c){S.region=c.r;setLens('region')}}));
}
// carte régionale : communes de la région en bleus, provinces en pointillé, voisines en gris clair
function mapRegion(el,reg,byCom,width,height){
  const R=GEO.R.find(r=>r.p===reg);if(!R){el.innerHTML='';return}
  let [x0,y0,x1,y1]=bbox(R.d);const pad=Math.max(x1-x0,y1-y0)*0.05;
  let vb=[x0-pad,y0-pad,x1-x0+2*pad,y1-y0+2*pad];
  const ratio=width/height;if(vb[2]/vb[3]<ratio){const w=vb[3]*ratio;vb[0]-=(w-vb[2])/2;vb[2]=w}else{const h=vb[2]/ratio;vb[1]-=(h-vb[3])/2;vb[3]=h}
  const scale=width/vb[2], k=1/scale, fl=10*k, fc=7*k, fp=7.5*k;
  const inside=c=>c.r===reg;
  const vis=c=>{const [a,b,c2,d]=bbox(c.d);return c2>=vb[0]&&a<=vb[0]+vb[2]&&d>=vb[1]&&b<=vb[1]+vb[3]};
  const paths=GEO.C.filter(vis).map(c=>{const v=inside(c)?(byCom[c.p]||0):0;
    return `<path class="${inside(c)?clsC(v):'out'}" d="${c.d}"><title>${c.n} — ${v?v+' organisation'+(v>1?'s':''):'aucune'}</title></path>`}).join('');
  const prov=GEO.P.filter(p=>p.r===reg);
  const labels=GEO.C.filter(inside).map(c=>{const v=byCom[c.p]||0;return `<text class="c ${v>20?'dk':v?'':'mute'}" x="${c.c[0]}" y="${c.c[1]+fc*0.35}" font-size="${fc.toFixed(2)}">${c.n}${v?' '+v:''}</text>`}).join('');
  const nb=GEO.R.filter(r=>r.p!==reg&&vis(r)).map(r=>`<text class="nb" x="${r.c[0]}" y="${r.c[1]}" font-size="${fl.toFixed(2)}">${r.n}</text>`).join('');
  el.innerHTML=`<svg class="map" style="height:${height}px;--k:${k.toFixed(3)}" viewBox="${vb.map(v=>v.toFixed(1)).join(' ')}" preserveAspectRatio="xMidYMid meet" role="img">
    ${paths}${prov.map(p=>`<path class="pv" d="${p.d}"/>`).join('')}${GEO.R.map(r=>`<path class="r ${r.p===reg?'sel':''}" d="${r.d}"/>`).join('')}${nb}${prov.map(p=>`<text x="${p.c[0]}" y="${p.c[1]-fp*1.2}" font-size="${fp.toFixed(2)}" fill="#6B7785">${p.n}</text>`).join('')}${labels}</svg>
    <svg class="locator" viewBox="0 0 ${GEO.W} ${GEO.H}">${GEO.R.map(r=>`<path class="${r.p===reg?'sel':''}" d="${r.d}"/>`).join('')}</svg>`;
}

/* ---------- blocs communs ---------- */
function typeBars(el,rows,lw){const c=byKeySet(rows,r=>r.type_org);hbars(el,TYPES.filter(t=>c[t]).map(t=>({l:t,v:c[t]})),{lw})}
function clusterBars(el,rows){const c=byKeySet(rows,r=>r.cluster_code);hbars(el,CLUSTERS.map(x=>({l:x.s,v:c[x.k]||0,k:x.k})),{lw:'78px'})}
function changeBlock(el,cur,prev,scope){
  if(!prev){el.innerHTML=`<p><b>Évolution :</b> première période disponible.</p>`;return}
  const a=orgs(cur),b=orgs(prev);const nw=[...a].filter(o=>!b.has(o)).sort(),gone=[...b].filter(o=>!a.has(o)).sort();
  const lim=(l,n)=>l.length>n?l.slice(0,n).join(', ')+` … (+${l.length-n})`:l.join(', ');
  el.innerHTML=`<p><b>Par rapport à ${plabel(prev[0]?pkey(prev[0]):'')}${scope?' ('+scope+')':''} :</b> ${a.size-b.size>=0?'<span class="up">+'+(a.size-b.size)+'</span>':'<span class="dn">'+(a.size-b.size)+'</span>'} organisation${Math.abs(a.size-b.size)>1?'s':''}.</p>
    <p><b>${nw.length} nouvelle${nw.length>1?'s':''} :</b> ${nw.length?esc(lim(nw,18)):'—'}</p><p><b>${gone.length} absente${gone.length>1?'s':''} :</b> ${gone.length?esc(lim(gone,18)):'—'}</p>`;
}

/* ---------- feuille nationale ---------- */
function renderNational(){
  const cur=rowsP(S.p), pv=prevOf(S.p), prev=pv?rowsP(pv.key):[];
  const N=nOrgs(cur), NP=pv?nOrgs(prev):null;
  kbox(document.getElementById('n-kpis'),[
    {v:f(N),d:delta(N,NP),l:`Organisations<br><b>${plabel(S.p)}</b>`},
    ...(pv?[{v:f(NP),l:`Organisations<br><b>${plabel(pv.key)}</b>`,cls:'prev'}]:[])]);
  const bc=byCommune(cur);
  kmini(document.getElementById('n-mini'),[
    {v:f(activites(cur)),l:'Activités rapportées',d:pv?activites(cur)-activites(prev):null},
    {v:f(distinct(cur,'adm1_pcode')),l:'Régions'},{v:f(distinct(cur,'adm2_pcode')),l:'Provinces'},
    {v:f(Object.keys(bc).length),l:'Communes',d:pv?Object.keys(bc).length-Object.keys(byCommune(prev)).length:null}]);
  const br=byKeySet(cur,r=>r.adm1_pcode);
  mapRegions(document.getElementById('n-map'),br,MAPW_NAT,205,p=>{S.region=p;setLens('region')});
  document.getElementById('n-map-note').textContent='cliquer une région → sa feuille';
  document.getElementById('n-legend').innerHTML=LEG_R;
  mapCommunes(document.getElementById('n-cmap'),bc,MAPW_NAT,192,{labels:false});
  document.getElementById('n-clegend').innerHTML=LEG_C;
  // évolution : organisations, activités et communes par période
  hbars(document.getElementById('n-periods'),PERIODS.map(p=>{const rr=rowsP(p.key);return {l:`${p.label} ${p.annee}`,v:nOrgs(rr),p:p.key!==S.p}}),{lw:'112px'});
  // tableau région × cluster
  const rows=GEO.R.map(r=>{const rr=cur.filter(x=>x.adm1_pcode===r.p);const cells=byKeySet(rr,x=>x.cluster_code);return {k:r.p,l:r.n,cells,tot:nOrgs(rr)}}).filter(r=>r.tot).sort((a,b)=>a.l.localeCompare(b.l));
  xtable(document.getElementById('n-table'),rows,{totals:byKeySet(cur,x=>x.cluster_code),grand:N,onClick:p=>{S.region=p;setLens('region')}});
  typeBars(document.getElementById('n-types'),cur,'110px');
  clusterBars(document.getElementById('n-clusters'),cur);
  changeBlock(document.getElementById('n-change'),cur,prev);
}

/* ---------- feuille clusters ---------- */
function renderClusters(){
  const cur=rowsP(S.p);const el=document.getElementById('v-cl');
  el.innerHTML=CLUSTERS.map(c=>`<div class="clmap" data-k="${c.k}"><div class="t"><span>${esc(c.n)}</span><b></b></div><div class="m"></div><div class="legend">${LEG_C}</div></div>`).join('');
  CLUSTERS.forEach(c=>{const box=el.querySelector(`.clmap[data-k="${c.k}"]`);const rr=cur.filter(r=>r.cluster_code===c.k);
    box.querySelector('b').innerHTML=`${nOrgs(rr)} <small>org.</small>`;
    mapCommunes(box.querySelector('.m'),byCommune(rr),240,252,{labels:false})});
}

/* ---------- feuille région (el = article.paper) ---------- */
function renderRegion(el,reg){
  const q=k=>el.querySelector(`[data-r="${k}"]`);
  const cur=rowsP(S.p,r=>r.adm1_pcode===reg), pv=prevOf(S.p), prev=pv?rowsP(pv.key,r=>r.adm1_pcode===reg):[];
  const N=nOrgs(cur), NP=pv?nOrgs(prev):null, bc=byCommune(cur);
  kbox(q('kpis'),[{v:f(N),d:delta(N,NP),l:`Organisations<br><b>${plabel(S.p)}</b>`},...(pv?[{v:f(NP),l:`Organisations<br><b>${plabel(pv.key)}</b>`,cls:'prev'}]:[])]);
  kmini(q('mini'),[{v:f(activites(cur)),l:'Activités rapportées',d:pv?activites(cur)-activites(prev):null},{v:f(distinct(cur,'cluster_code')),l:'Clusters'},
    {v:f(distinct(cur,'adm2_pcode')),l:'Provinces'},{v:f(Object.keys(bc).length),l:'Communes'}]);
  mapRegion(q('map'),reg,bc,MAPW_REG,430);
  const nProv=cur.filter(r=>!r.adm3_pcode&&!(r.communes_citees||[]).length).length;
  q('note').textContent=nProv?`${nProv} ligne${nProv>1?'s':''} connue${nProv>1?'s':''} au niveau province seulement`:'';
  q('legend').innerHTML=LEG_C;
  const prov=GEO.P.filter(p=>p.r===reg).map(p=>{const rr=cur.filter(x=>x.adm2_pcode===p.p);return {k:p.p,l:p.n,cells:byKeySet(rr,x=>x.cluster_code),tot:nOrgs(rr)}}).filter(r=>r.tot);
  xtable(q('table'),prov,{first:'Province',totals:byKeySet(cur,x=>x.cluster_code),grand:N});
  typeBars(q('types'),cur,'110px');
  hbars(q('top'),Object.entries(bc).map(([p,v])=>({l:(CBY[p]||{}).n||p,v})).sort((a,b)=>b.v-a.v||a.l.localeCompare(b.l)).slice(0,12),{lw:'92px'});
  // organisations par cluster (principales en noir, partenaires de mise en œuvre uniquement en gris)
  q('orgs').innerHTML=CLUSTERS.map(c=>{const rr=cur.filter(r=>r.cluster_code===c.k);if(!rr.length)return'';
    const m={};rr.forEach(r=>{m[r.org]=m[r.org]||r.principal;if(r.principal)m[r.org]=true});
    const names=Object.keys(m).sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
    return `<div class="g"><div class="h">${esc(c.n)}<small>${names.length} organisation${names.length>1?'s':''}</small></div><div class="o">${names.map(n=>`<span class="${m[n]?'':'moe'}">${esc(n)}</span>`).join(' ')}</div></div>`}).join('')||`<div class="na">Aucune organisation</div>`;
}

/* ---------- fiche organisation ---------- */
function renderOrg(){
  const org=S.org;const all=ROWS.filter(r=>r.org===org), cur=all.filter(r=>pkey(r)===S.p);
  const q=id=>document.getElementById(id);
  if(!org||!all.length){kbox(q('o-kpis'),[{v:'—',l:'Choisir une organisation dans la barre du haut'}]);q('o-mini').innerHTML='';q('o-map').innerHTML='';q('o-table').innerHTML='';q('o-periods').innerHTML='';q('o-partners').innerHTML='';q('o-communes').innerHTML='';q('o-legend').innerHTML='';return}
  const bc=byCommune(cur), type=all[0].type_org, nom=all[0].nom_complet;
  kbox(q('o-kpis'),[{v:esc(org),l:`${esc(nom||'')}<br><b>${esc(type)}</b>`},{v:f(Object.keys(bc).length),icon:ICON_PIN,l:`Communes d'intervention<br><b>${plabel(S.p)}</b>`}]);
  kmini(q('o-mini'),[{v:f(distinct(cur,'cluster_code')),l:'Clusters'},{v:f(distinct(cur,'adm1_pcode')),l:'Régions'},{v:f(distinct(cur,'adm2_pcode')),l:'Provinces'},{v:f(activites(cur)),l:'Activités rapportées'}]);
  mapCommunes(q('o-map'),bc,MAPW_ORG,420,{labels:true,communeLabels:false,binary:true});
  q('o-note').textContent=cur.length?'':'absente sur cette période';
  q('o-legend').innerHTML=`<span><i style="background:var(--b3)"></i>Commune d'intervention</span>`;
  // cluster × région : nombre de communes
  const regs=GEO.R.filter(r=>cur.some(x=>x.adm1_pcode===r.p));
  q('o-table').innerHTML=`<table><thead><tr><th>Région</th>${CLUSTERS.map(c=>`<th title="${esc(c.n)}">${esc(c.h)}</th>`).join('')}<th class="t">Total</th></tr></thead><tbody>
    ${regs.map(r=>{const rr=cur.filter(x=>x.adm1_pcode===r.p);const cells=CLUSTERS.map(c=>{const v=Object.keys(byCommune(rr.filter(x=>x.cluster_code===c.k))).length;const any=rr.some(x=>x.cluster_code===c.k);return `<td class="${any?(v?clsT(v):'c1'):''}">${v||(any?'●':'')}</td>`}).join('');
      return `<tr><td>${esc(r.n)}</td>${cells}<td class="t">${Object.keys(byCommune(rr)).length}</td></tr>`}).join('')}</tbody></table>`;
  hbars(q('o-periods'),PERIODS.map(p=>{const rr=all.filter(r=>pkey(r)===p.key);return {l:`${p.label} ${p.annee}`,v:Object.keys(byCommune(rr)).length,p:p.key!==S.p}}),{lw:'120px'});
  // partenaires & bailleurs (depuis la vue des paires)
  const pr=PAIRS.filter(x=>pkey(x)===S.p&&(x.organisation===org||x.partenaire_moe===org));
  const moe=[...new Set(pr.filter(x=>x.organisation===org&&x.partenaire_moe&&x.partenaire_moe!==org).map(x=>x.partenaire_moe))].sort();
  const lead=[...new Set(pr.filter(x=>x.partenaire_moe===org&&x.organisation!==org).map(x=>x.organisation))].sort();
  const bail=[...new Set(pr.flatMap(x=>(x.bailleur||'').split('|').map(s=>s.trim()).filter(Boolean)))].sort();
  const byReg={};Object.keys(bc).forEach(c=>{const g=CBY[c];if(g)(byReg[g.r]=byReg[g.r]||[]).push(g.n)});
  q('o-communes').innerHTML=Object.keys(byReg).length?GEO.R.filter(r=>byReg[r.p]).map(r=>`<p><b>${esc(r.n)} :</b> ${esc(byReg[r.p].sort().join(', '))}</p>`).join(''):'';
  q('o-partners').innerHTML=`<p><b>Met en œuvre via :</b> ${moe.length?esc(moe.join(', ')):'—'}</p><p><b>Partenaire de mise en œuvre de :</b> ${lead.length?esc(lead.join(', ')):'—'}</p><p><b>Bailleurs :</b> ${bail.length?esc(bail.join(', ')):'—'}</p>`;
}

/* ---------- répertoire ---------- */
function renderRepertoire(){
  const cur=rowsP(S.p);const q=S.q.trim().toLowerCase();
  const m={};ROWS.forEach(r=>{const o=m[r.org]=m[r.org]||{org:r.org,type:r.type_org,nom:r.nom_complet,periods:new Set(),cl:new Set(),reg:new Set()};o.periods.add(pkey(r));if(pkey(r)===S.p){o.cl.add(r.cluster_code);o.reg.add(r.adm1_pcode)}});
  let list=Object.values(m).filter(o=>o.periods.has(S.p));
  kmini(document.getElementById('r-mini'),[{v:f(list.length),l:`Organisations · ${plabel(S.p)}`},{v:f(Object.keys(m).length),l:'Organisations toutes périodes'},{v:f(list.filter(o=>o.type==='ONG nationale').length),l:'ONG nationales'},{v:f(list.filter(o=>o.type==='ONG internationale').length),l:'ONG internationales'}]);
  if(q)list=list.filter(o=>[o.org,o.nom,o.type,...[...o.cl].map(c=>CL[c]?CL[c].n:c),...[...o.reg].map(RNAME)].join(' ').toLowerCase().includes(q));
  list.sort((a,b)=>TYPES.indexOf(a.type)-TYPES.indexOf(b.type)||a.org.localeCompare(b.org,'fr',{sensitivity:'base'}));
  let out='',last=null;
  list.forEach(o=>{if(o.type!==last){last=o.type;out+=`<tr class="grp"><td colspan="6">${esc(o.type)} · ${list.filter(x=>x.type===o.type).length}</td></tr>`}
    out+=`<tr><td class="acr" data-k="${esc(o.org)}">${esc(o.org)}</td><td>${esc(o.nom||'')}</td><td class="cl">${CLUSTERS.filter(c=>o.cl.has(c.k)).map(c=>c.s).join(', ')}</td><td>${[...o.reg].map(RNAME).sort().join(', ')}</td><td class="n">${o.reg.size}</td><td class="n">${PERIODS.map(p=>`<i class="dot ${o.periods.has(p.key)?'':'off'}" title="${p.label}"></i>`).join('')}</td></tr>`});
  document.getElementById('r-table').innerHTML=list.length?`<table><thead><tr><th>Sigle</th><th>Nom de l'organisation</th><th>Clusters</th><th>Régions</th><th class="n">Nb</th><th class="n">${PERIODS.map(p=>BIM_SHORT[p.ordre]).join(' · ')}</th></tr></thead><tbody>${out}</tbody></table>`:`<div class="na">Aucune organisation ne correspond</div>`;
  document.querySelectorAll('#r-table td.acr').forEach(td=>td.addEventListener('click',()=>{S.org=td.dataset.k;setLens('org')}));
}

/* ---------- chrome / état ---------- */
function setLens(l){S.lens=l;document.querySelectorAll('.lens button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.lens===l));render()}
function heads(){
  document.querySelectorAll('.paper').forEach(p=>{
    const reg=p.dataset.region||S.region;
    p.querySelector('.head h1').innerHTML=p.dataset.lens==='region'?`BURKINA FASO<small> : ${regionTitle(reg)}</small>`:p.dataset.lens==='org'&&S.org?`BURKINA FASO<small> : ${esc(S.org)}</small>`:'BURKINA FASO';
    p.querySelector('.lensname').textContent=p.dataset.title;
    p.querySelector('.period').textContent=plabel(S.p);
    p.querySelector('.foot .src').innerHTML=`<b>Date de création :</b> ${new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})} &nbsp; <b>Sources :</b> 3W clusters (collecte bimestrielle) &nbsp; <b>Feedback :</b> ocha-burkinafaso@un.org &nbsp; www.unocha.org/burkina-faso`;
  });
}
function render(){
  document.querySelectorAll('#sheets .paper').forEach(p=>p.classList.toggle('on',p.dataset.lens===S.lens));
  document.getElementById('pick-region').hidden=S.lens!=='region';
  document.getElementById('pick-org').hidden=S.lens!=='org';
  document.getElementById('pick-search').hidden=S.lens!=='repertoire';
  document.querySelectorAll('#periods button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.p===S.p));
  const br=byKeySet(rowsP(S.p),r=>r.adm1_pcode);
  const opts=[...GEO.R].sort((a,b)=>(br[b.p]||0)-(br[a.p]||0)||a.n.localeCompare(b.n));
  if(!S.region||!GEO.R.find(r=>r.p===S.region))S.region=opts[0].p;
  document.getElementById('sel-region').innerHTML=opts.map(r=>`<option value="${r.p}">${r.n}${br[r.p]?` (${br[r.p]})`:''}</option>`).join('');
  document.getElementById('sel-region').value=S.region;
  document.getElementById('in-org').value=S.org||'';
  heads();
  if(S.lens==='national')renderNational();
  else if(S.lens==='clusters')renderClusters();
  else if(S.lens==='region')renderRegion(document.getElementById('paper-region'),S.region);
  else if(S.lens==='org')renderOrg();
  else renderRepertoire();
  location.hash=`p=${S.p}&vue=${S.lens}&region=${S.region}${S.org?'&org='+encodeURIComponent(S.org):''}`;
  fit();
}
function readHash(){const h=new URLSearchParams(location.hash.slice(1));
  if(h.get('p')&&PERIODS.find(x=>x.key===h.get('p')))S.p=h.get('p');
  if(h.get('vue'))S.lens=h.get('vue');if(h.get('region'))S.region=h.get('region');if(h.get('org'))S.org=h.get('org');
  document.querySelectorAll('.lens button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.lens===S.lens));}

/* ---------- squelette des feuilles ---------- */
function dressPaper(p){
  p.insertAdjacentHTML('afterbegin',`<div class="head"><div><h1>BURKINA FASO</h1><div class="sub">Présence opérationnelle (3W) — Qui fait quoi, où</div></div><div class="right"><div class="lensname"></div><div class="period"></div></div></div>`);
  p.insertAdjacentHTML('beforeend',`<div class="foot"><span>Les organisations répertoriées sont celles qui ont rapporté des activités au cours de la période (organisations principales et partenaires de mise en œuvre). Les désignations et limites administratives n'impliquent pas une reconnaissance officielle par l'Organisation des Nations Unies. Découpage 2025.</span><span class="src"></span></div>`);
}
document.querySelectorAll('.paper').forEach(dressPaper);
document.querySelectorAll('.lens button').forEach(b=>b.addEventListener('click',()=>setLens(b.dataset.lens)));
document.getElementById('sel-region').addEventListener('change',e=>{S.region=e.target.value;render()});
document.getElementById('in-org').addEventListener('change',e=>{const v=e.target.value.trim();const hit=ORGNAMES.find(o=>o.toLowerCase()===v.toLowerCase());if(hit){S.org=hit;render()}});
document.getElementById('in-search').addEventListener('input',e=>{S.q=e.target.value;renderRepertoire();fit()});
window.addEventListener('beforeprint',()=>{const ps=[...document.querySelectorAll('.paper')];ps.forEach(p=>p.classList.remove('last'));
  const vis=ps.filter(p=>getComputedStyle(p).display!=='none'||document.body.classList.contains('all'));if(vis.length)vis[vis.length-1].classList.add('last')});
document.getElementById('btn-print').addEventListener('click',()=>window.print());
// Tout imprimer : national + clusters + une feuille par région (ordre décroissant du nombre d'organisations) + répertoire
document.getElementById('btn-print-all').addEventListener('click',()=>{
  const br=byKeySet(rowsP(S.p),r=>r.adm1_pcode);const regs=Object.keys(br).sort((a,b)=>br[b]-br[a]);
  const tpl=document.getElementById('paper-region'), sheets=document.getElementById('sheets'), rep=document.querySelector('.paper[data-lens="repertoire"]');
  const clones=regs.map(p=>{const c=tpl.cloneNode(true);c.id='';c.dataset.region=p;c.classList.add('on','clone');sheets.insertBefore(c,rep);return c});
  tpl.classList.add('skip');document.querySelector('.paper[data-lens="org"]').classList.add('skip');
  renderNational();renderClusters();clones.forEach(c=>renderRegion(c,c.dataset.region));renderRepertoire();heads();
  document.body.classList.add('all');fitCols();
  setTimeout(()=>window.print(),120);
});
window.addEventListener('afterprint',()=>{if(!document.body.classList.contains('all'))return;document.body.classList.remove('all');document.querySelectorAll('.paper.clone').forEach(c=>c.remove());document.querySelectorAll('.paper.skip').forEach(p=>p.classList.remove('skip'));render()});
// les colonnes doivent tenir dans la feuille : on réduit la hauteur des lignes des tableaux si besoin
function fitCols(){document.querySelectorAll('.paper .col').forEach(col=>{
  if(!col.offsetParent&&!document.body.classList.contains('all'))return;col.style.setProperty('--rh','21px');
  for(let h=21;h>=12&&col.scrollHeight>col.clientHeight+1;h--)col.style.setProperty('--rh',h+'px')})}
function fit(){fitCols();const st=document.getElementById('stage'),sh=document.getElementById('sheets');const w=st.clientWidth-32;const s=Math.min(1,w/1123);sh.style.transform=`scale(${s})`;
  const on=[...document.querySelectorAll('.paper.on')];const h=on.reduce((a,p)=>a+p.offsetHeight,0)+18*(on.length-1);st.style.height=(h*s+44)+'px'}
addEventListener('resize',fit);

/* ---------- démarrage ---------- */
let PAIRS=[], ORGNAMES=[];
async function boot(){
  const st=document.getElementById('status');st.textContent='Chargement…';
  try{
    [ROWS,PAIRS]=await Promise.all([
      sbAll('v_3w_app?select=annee,bimestre_ordre,org,type_org,nom_complet,cluster_code,adm1_pcode,adm2_pcode,adm3_pcode,niveau_geo,principal,mise_en_oeuvre,activites,personnes,communes_citees&order=org'),
      sbAll('v_3w_pairs?select=annee,bimestre_ordre,organisation,partenaire_moe,bailleur,cluster_code,activites')]);
    ROWS.forEach(r=>{r.annee=r.annee||2026});PAIRS.forEach(r=>{r.annee=r.annee||2026});
    const pm={};ROWS.forEach(r=>{pm[pkey(r)]={key:pkey(r),annee:r.annee,ordre:r.bimestre_ordre,label:BIM[r.bimestre_ordre]}});
    PERIODS=Object.values(pm).sort((a,b)=>a.annee-b.annee||a.ordre-b.ordre);
    S.p=PERIODS[PERIODS.length-1].key;
    document.getElementById('periods').innerHTML=PERIODS.map(p=>`<button data-p="${p.key}">${p.label} ${p.annee}</button>`).join('');
    document.querySelectorAll('#periods button').forEach(b=>b.addEventListener('click',()=>{S.p=b.dataset.p;render()}));
    ORGNAMES=[...new Set(ROWS.map(r=>r.org))].sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
    document.getElementById('dl-org').innerHTML=ORGNAMES.map(o=>`<option value="${esc(o)}">`).join('');
    readHash();render();st.textContent='';
  }catch(e){st.textContent='Erreur de chargement : '+e.message;console.error(e)}
}
boot();
