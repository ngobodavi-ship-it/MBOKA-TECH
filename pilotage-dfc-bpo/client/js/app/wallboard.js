/* =======================================================================
   app/wallboard.js — Wallboard plein écran
   Contenu    : renderWallboard(), ouverture / fermeture, horloge, rafraîchissement
   Dépend de  : donnees.js
   ======================================================================= */
/* ---------- wallboard plein écran ---------- */
let WB_T=null,WB_R=null;
function renderWallboard(){
  const d=droits(),cur=agg(selection())||emptyAgg(),prev=selectionBack(1);
  const keys=periodKeys(state.freq),last=keys[keys.length-1];
  const filtres=[state.filiale==='all'?'Toutes filiales':state.filiale,state.activite==='all'?'toutes activités':state.activite].join(' · ');
  document.getElementById('wbScope').textContent=filtres+' · '+(state.freq==='hebdo'?'hebdomadaire':'mensuel');
  document.getElementById('wbPeriode').textContent=periodLabel(state.freq,last);
  const delta=(a,b,inv)=>{if(!b)return '<span class="flat">—</span>';const p=(a-b)/b*100,good=inv?p<0:p>0;
    const c=Math.abs(p)<0.4?'flat':good?'up':'down';return `<span class="${c}">${p>0?'▲ +':p<0?'▼ ':''}${nf(p,1)} %</span>`};
  const T=[
    {k:'DMT',v:cur.dmt?mmss(cur.dmt):'—',d:delta(cur.dmt,prev.dmt,true)},
    {k:'Appels traités / h',v:cur.appelsH?nf(cur.appelsH,1):'—',u:'/h agent',d:delta(cur.appelsH,prev.appelsH)},
    {k:'Appels traités',v:nf(cur.volAppels),d:delta(cur.volAppels,prev.volAppels)},
    d.fin?{k:'CA horaire',v:fcfa(cur.caH),u:'FCFA/h',d:delta(cur.caH,prev.caH)}:{k:'Occupation',v:nf(cur.occ*100,1),u:'%',d:delta(cur.occ,prev.occ)},
    {k:'Agents staffés',v:nf(cur.agents),d:delta(cur.agents,prev.agents)},
    d.fin?{k:'Taux de marge directe',v:cur.ca?nf(cur.marge/cur.ca*100,1):'—',u:'%',d:delta(cur.ca?cur.marge/cur.ca:0,prev.ca?prev.marge/prev.ca:0)}
         :{k:'Fiches traitées',v:nf(cur.volFiches),d:delta(cur.volFiches,prev.volFiches)}
  ];
  const lab=state.freq==='hebdo'?'vs semaine précédente':'vs mois précédent';
  document.getElementById('wbKpis').innerHTML=T.map(t=>`<div class="wb-kpi"><div class="k">${t.k}</div>
    <div class="v">${t.v}${t.u?`<small>${t.u}</small>`:''}</div><div class="d">${t.d}<span class="lab">${lab}</span></div></div>`).join('');
  const parFil=state.niveau==='activite'?byActivite():byFiliale();
  const rows=parFil.filter(r=>r.a).sort((x,y)=>y.a.volAppels-x.a.volAppels);
  const max=Math.max(1,...rows.map(r=>r.a.volAppels));
  document.getElementById('wbBoardTitle').textContent=state.niveau==='activite'?'Par activité':'Par filiale';
  document.getElementById('wbRows').innerHTML=`<div class="wb-row h"><span>${state.niveau==='activite'?'Activité':'Filiale'}</span><span>Appels traités</span><span class="num">DMT</span><span class="num">Occupation</span><span class="num">${d.fin?'CA horaire':'Appels / h'}</span></div>`
    +rows.map(r=>`<div class="wb-row"><span class="n">${esc(r.k)}</span>
      <div class="wb-bar"><i style="width:${(r.a.volAppels/max*100).toFixed(1)}%"></i><b>${nf(r.a.volAppels)}</b></div>
      <span class="num">${r.a.dmt?mmss(r.a.dmt):'—'}</span><span class="num">${nf(r.a.occ*100,1)} %</span>
      <span class="num">${d.fin?fcfa(r.a.caH):(r.a.appelsH?nf(r.a.appelsH,1):'—')}</span></div>`).join('');
  document.getElementById('wbMaj').textContent='Mis à jour à '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
}
function horlogeWallboard(){document.getElementById('wbClock').textContent=new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
function ouvrirWallboard(){
  if(!DB.rows.length){bandeau('Aucune donnée à afficher — importez d\'abord des extractions.',true);return}
  const w=document.getElementById('wallboard');w.hidden=false;
  renderWallboard();horlogeWallboard();
  WB_T=setInterval(horlogeWallboard,10000);
  WB_R=setInterval(async()=>{try{await rafraichirProduction();renderWallboard()}catch(e){}},120000);
  try{if(w.requestFullscreen)w.requestFullscreen().catch(()=>{})}catch(e){}
  document.getElementById('wbClose').focus();
}
function fermerWallboard(){
  const w=document.getElementById('wallboard');if(w.hidden)return;
  w.hidden=true;clearInterval(WB_T);clearInterval(WB_R);
  try{if(document.fullscreenElement)document.exitFullscreen()}catch(e){}
}
document.getElementById('btnWall').onclick=ouvrirWallboard;
document.getElementById('wbClose').onclick=fermerWallboard;
document.addEventListener('keydown',e=>{if(e.key==='Escape')fermerWallboard()});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)fermerWallboard()});
