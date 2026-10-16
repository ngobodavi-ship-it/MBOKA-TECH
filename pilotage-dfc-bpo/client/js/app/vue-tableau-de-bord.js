/* =======================================================================
   app/vue-tableau-de-bord.js — Vue « Tableau de bord »
   Contenu    : renderContext(), renderKPI() (6 indicateurs), renderCharts() (4 graphiques), renderTable() (ventilation)
   Dépend de  : etat.js, donnees.js, lib/graphiques.js
   ======================================================================= */
/* =======================================================================
   Rendu — tableau de bord
   ======================================================================= */
function groupRows(){
  const rows=selection();
  if(state.niveau==='groupe')return [{k:'Groupe',a:agg(rows)}];
  if(state.niveau==='filiale')return [...new Set(rows.map(r=>r.filiale))].map(f=>({k:f,a:agg(rows.filter(r=>r.filiale===f))}));
  return [...new Set(rows.map(r=>r.activite))].map(x=>({k:x,a:agg(rows.filter(r=>r.activite===x))}));
}
function byFiliale(){return [...new Set(selection().map(r=>r.filiale))].map(f=>({k:f,a:agg(selection().filter(r=>r.filiale===f))}))}
function byActivite(){return [...new Set(selection().map(r=>r.activite))].map(x=>({k:x,a:agg(selection().filter(r=>r.activite===x))}))}

function renderContext(){
  const d=droits();
  let left;
  if(state.source==='demo'){
    const f=FREQ[state.freq];
    left=`<b>${f.periode}</b><span class="dot"></span>Usage : ${f.usage}<span class="dot"></span>Destinataires : <b>${f.dest}</b>`;
  }else{
    const keys=periodKeys(state.freq);
    const last=keys[keys.length-1];
    left=`<b>${periodLabel(state.freq,last)}</b><span class="dot"></span>${keys.length} période${keys.length>1?'s':''} en base<span class="dot"></span>${DB.rows.filter(r=>r.type===state.freq).length} lignes`;
  }
  document.getElementById('context').innerHTML=left+`<span class="dot"></span>${d.note}`;
}

function renderKPI(){
  const cur=agg(selection())||emptyAgg(), prev=selectionBack(1), d=droits();
  const delta=(a,b,inv=false)=>{
    if(!b)return {c:'flat',t:'—'};
    const p=(a-b)/b*100, good=inv?p<0:p>0;
    return {c:Math.abs(p)<0.4?'flat':(good?'up':'down'), t:(p>0?'+':'')+nf(p,1)+' %'};
  };
  const defs=[
    {n:1,name:'DMT',sub:'Durée moyenne de traitement',v:cur.dmt?mmss(cur.dmt):'—',d:delta(cur.dmt,prev.dmt,true),src:'Hermès',todo:false,fin:false},
    {n:2,name:'Appels traités / h',sub:'par activité · filiale',v:cur.appelsH?nf(cur.appelsH,1):'—',u:cur.appelsH?'/h agent':'',d:delta(cur.appelsH,prev.appelsH),src:'Hermès',todo:true,fin:false},
    {n:3,name:'Fiches traitées',sub:'Back Office',v:nf(cur.volFiches),d:delta(cur.volFiches,prev.volFiches),src:'Hermès',todo:true,fin:false},
    {n:4,name:'CA horaire',sub:'CA facturé / heures productives',v:fcfa(cur.caH),u:'FCFA/h',d:delta(cur.caH,prev.caH),src:'Finance',todo:false,fin:true},
    {n:5,name:'Agents staffés',sub:'par activité · filiale',v:nf(cur.agents),d:delta(cur.agents,prev.agents),src:'WFM',todo:true,fin:false},
    {n:6,name:'Masse salariale directe',sub:'sur la période',v:fcfa(cur.ms),u:'FCFA',d:delta(cur.ms,prev.ms,true),src:'RH / Finance',todo:true,fin:true}
  ];
  document.getElementById('kpis').innerHTML=defs.map(k=>{
    const locked=k.fin&&!d.fin;
    return `<div class="kpi ${locked?'locked':''}">
      <span class="idx">${String(k.n).padStart(2,'0')}</span>
      <div class="name">${k.name}</div>
      <div class="rule">${k.sub}</div>
      ${locked
        ?`<div class="lockmsg"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#666C74" stroke-width="1.6"><path d="M4 7V5a4 4 0 018 0v2M3 7h10v7H3z"/></svg>Réservé DFC / Direction</div>`
        :`<div class="val">${k.v}${k.u?`<small>${k.u}</small>`:''}</div>
          <div class="foot">
            <span class="delta ${k.d.c}">${k.d.t}</span>
            <span class="src">${k.src}</span>
            ${k.todo?'<span class="todo">règle à valider</span>':''}
          </div>`}
    </div>`;
  }).join('');
  const prevLab=state.freq==='reel'?'heure précédente':state.freq==='hebdo'?'semaine précédente':'mois précédent';
  document.getElementById('kpiNote').textContent='Variation vs '+prevLab;
}

function renderCharts(){
  const g=groupRows(), d=droits();
  const nivLab={groupe:'Consolidé groupe',filiale:'Par filiale',activite:'Par activité'}[state.niveau];

  // 1 — DMT
  const dmtRows=(state.niveau==='groupe'?byActivite():g).filter(r=>r.a&&r.a.dmt>0);
  hbar(document.getElementById('chart1'),dmtRows.map(r=>({k:r.k,v:r.a.dmt})),{fmt:v=>mmss(v),color:'#0E8C8C',ref:300,refLab:'objectif 5\'00"'});
  document.getElementById('chart1Cap').textContent=(state.niveau==='groupe'?'Par activité':nivLab)+' — moyenne pondérée par les appels traités · Hermès';

  // 2 — décomposition du temps
  const tRows=(state.niveau==='groupe'?byFiliale():g).filter(r=>r.a);
  const hasT=tRows.length&&tRows.every(r=>r.a.tComm!=null);
  if(hasT){
    stack(document.getElementById('chart2'),
      tRows.map(r=>({k:r.k,tComm:r.a.tComm,tAtt:r.a.tAtt,tAcw:r.a.tAcw,tPause:r.a.tPause})),
      ['tComm','tAtt','tAcw','tPause'],['#0E8C8C','#8CC7D9','#5163C9',cv('--chart-pause','#D5DEE2')]);
    document.getElementById('chart2Legend').style.display='';
    document.getElementById('chart2Cap').textContent='Heures loguées ventilées — conversation, attente, post-appel, pause · Hermès';
  }else{
    document.getElementById('chart2').innerHTML='<div style="padding:36px 0;text-align:center;font-family:var(--mono);font-size:11.5px;color:var(--slate)">Décomposition du temps non disponible<br><span style="color:#9A9A9A">Ajoutez les colonnes t_comm_h, t_attente_h, t_acw_h aux imports pour l\'activer.</span></div>';
    document.getElementById('chart2Legend').style.display='none';
    document.getElementById('chart2Cap').textContent='Nécessite les colonnes de temps dans l\'import';
  }

  // 3 — rentabilité (financier)
  const panel=document.getElementById('panelRenta');
  if(!d.fin){
    panel.querySelector('#chart3').innerHTML='<div style="padding:36px 0;text-align:center;font-family:var(--mono);font-size:11.5px;color:var(--slate)">Accès restreint — profil BPO<br><span style="color:#9A9A9A">Les vues de rentabilité sont ouvertes à la DFC et à la Direction.</span></div>';
    panel.querySelectorAll('.legend')[0].style.display='none';
  }else{
    panel.querySelectorAll('.legend')[0].style.display='';
    const gr=(state.niveau==='groupe'?byFiliale():g).filter(r=>r.a);
    group2(document.getElementById('chart3'),gr.map(r=>({k:r.k,a:r.a.caH,b:r.a.coutH})));
  }
  document.getElementById('rentaCap').textContent='FCFA par heure productive · Finance & RH';

  // 4 — tendance
  const labels=[],sa=[],sb=[];
  let n;
  if(state.source==='demo'){n=FREQ[state.freq].n}
  else{n=Math.min(12,periodKeys(state.freq).length)}
  const keys=periodKeys(state.freq);
  for(let i=n-1;i>=0;i--){
    const a=selectionBack(i);
    if(state.source==='demo')labels.push(FREQ[state.freq].pref+i);
    else labels.push(periodShort(state.freq,keys[keys.length-1-i]||''));
    sa.push(a.volAppels);
    sb.push(d.fin?a.caH:a.dmt);
  }
  lines(document.getElementById('chart4'),{labels,a:sa,b:sb},v=>nf(v),v=>d.fin?fcfa(v):mmss(v));
  document.getElementById('trendTitle').textContent=d.fin?'Volume traité vs CA horaire':'Volume traité vs DMT';
  document.getElementById('trendCap').textContent=(state.source==='demo'?FREQ[state.freq].pasLab:n+' dernières périodes en base')+' — '+nivLab;
  document.getElementById('trendLegend').innerHTML=
    `<span><i style="background:var(--chart-a)"></i>Appels traités</span>
     <span><i style="background:#0E8C8C"></i>${d.fin?'CA horaire (FCFA)':'DMT'}</span>`;
  document.getElementById('anaNote').textContent=nivLab+' · '+(state.source==='demo'?FREQ[state.freq].lab.toLowerCase():FREQ[state.freq].lab.toLowerCase()+' (production)');
}

const COLS=[
  {k:'lib',t:'',fin:false,f:r=>esc(r.k),raw:r=>r.k},
  {k:'ag',t:'Agents staffés',fin:false,f:r=>nf(r.a.agents),raw:r=>r.a.agents},
  {k:'hl',t:'Heures loguées',fin:false,f:r=>nf(r.a.hLog),raw:r=>Math.round(r.a.hLog)},
  {k:'occ',t:'Occupation',fin:false,f:r=>nf(r.a.occ*100,1)+' %',raw:r=>+(r.a.occ*100).toFixed(1)},
  {k:'vol',t:'Appels traités',fin:false,f:r=>nf(r.a.volAppels),raw:r=>r.a.volAppels},
  {k:'fic',t:'Fiches BO',fin:false,f:r=>r.a.volFiches?nf(r.a.volFiches):'—',raw:r=>r.a.volFiches},
  {k:'dmt',t:'DMT',fin:false,f:r=>r.a.dmt?mmss(r.a.dmt):'—',raw:r=>Math.round(r.a.dmt)},
  {k:'aph',t:'Appels / h',fin:false,f:r=>nf(r.a.appelsH,1),raw:r=>+r.a.appelsH.toFixed(2)},
  {k:'ca',t:'CA facturé',fin:true,f:r=>fcfa(r.a.ca),raw:r=>Math.round(r.a.ca)},
  {k:'cah',t:'CA horaire',fin:true,f:r=>fcfa(r.a.caH),raw:r=>Math.round(r.a.caH)},
  {k:'ms',t:'Masse salariale',fin:true,f:r=>fcfa(r.a.ms),raw:r=>Math.round(r.a.ms)},
  {k:'mrg',t:'Marge directe',fin:true,f:r=>fcfa(r.a.marge),raw:r=>Math.round(r.a.marge),neg:r=>r.a.marge<0},
  {k:'txm',t:'Taux de marge',fin:true,f:r=>r.a.ca?nf(r.a.marge/r.a.ca*100,1)+' %':'—',raw:r=>r.a.ca?+(r.a.marge/r.a.ca*100).toFixed(1):0,neg:r=>r.a.marge<0}
];

function tableRows(){
  return state.niveau==='groupe'?byFiliale():groupRows();
}
function renderTable(){
  const d=droits();
  const niv={groupe:'Groupe',filiale:'Filiale',activite:'Activité'}[state.niveau];
  const rows=tableRows().filter(r=>r.a);
  const cols=COLS.map(c=>({...c,hidden:c.fin&&!d.fin}));
  document.getElementById('thead').innerHTML=cols.map(c=>`<th>${c.k==='lib'?(state.niveau==='groupe'?'Filiale':niv):c.t}${c.hidden?' 🔒':''}</th>`).join('');
  document.getElementById('tbody').innerHTML=rows.map(r=>
    '<tr>'+cols.map(c=>{
      if(c.hidden)return '<td class="mask">—</td>';
      const neg=c.neg&&c.neg(r);
      return `<td class="${neg?'neg':''}">${c.f(r)}</td>`;
    }).join('')+'</tr>').join('');
  const tot={k:'Total',a:agg(selection())||emptyAgg()};
  document.getElementById('tfoot').innerHTML=cols.map(c=>c.hidden?'<td class="mask">—</td>':`<td>${c.f(tot)}</td>`).join('');
  document.getElementById('tblNote').textContent=
    (state.niveau==='groupe'?'Ventilation par filiale':'Ventilation par '+niv.toLowerCase())+
    (state.source==='demo'?' · '+FREQ[state.freq].periode:' · '+periodLabel(state.freq,periodKeys(state.freq).slice(-1)[0]));
}
