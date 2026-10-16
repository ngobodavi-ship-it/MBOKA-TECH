/* =======================================================================
   app/donnees.js — Modèle de données et agrégation
   Contenu    : mapProd() (API → modèle interne), agg()/emptyAgg() (calcul des indicateurs), libellés de période, sélection filtrée
   Dépend de  : etat.js
   ======================================================================= */
function mapProd(l){return{id:l.id,type:l.type_periode,periode:l.periode,filiale:l.filiale,activite:l.activite,
  agents:l.agents,hLog:l.heures_loguees,hProd:l.heures_productives,appels:l.appels_traites,fiches:l.fiches_traitees,
  dmtDecl:l.dmt_sec,ca:l.ca_facture||0,ms:l.masse_salariale||0,
  tComm:l.t_comm_h,tAtt:l.t_attente_h,tAcw:l.t_acw_h}}


function emptyAgg(){return{agents:0,hLog:0,hProd:0,occ:0,vol:0,volAppels:0,volFiches:0,dmt:0,appelsH:0,ca:0,ms:0,marge:0,caH:0,coutH:0,tComm:null,tAtt:null,tAcw:null,tPause:0}}
function agg(rows){
  if(!rows||!rows.length)return null;
  const s=k=>rows.reduce((t,r)=>t+(+r[k]||0),0);
  const hLog=s('hLog'),hProd=s('hProd'),ca=s('ca'),ms=s('ms');
  const appels=s('appels'),fiches=s('fiches');
  const rA=rows.filter(r=>+r.appels>0);
  const hProdAppels=rA.reduce((t,r)=>t+(+r.hProd||0),0);
  const wd=rA.reduce((t,r)=>t+(+r.dmtDecl||0)*(+r.appels||0),0);
  const hasT=rows.length>0&&rows.every(r=>r.tComm!=null&&r.tComm!=='');
  return {
    agents:s('agents'), hLog, hProd, occ:hLog?hProd/hLog:0,
    vol:appels+fiches, volAppels:appels, volFiches:fiches,
    dmt:appels?wd/appels:0, appelsH:hProdAppels?appels/hProdAppels:0,
    ca, ms, marge:ca-ms, caH:hProd?ca/hProd:0, coutH:hProd?ms/hProd:0,
    tComm:hasT?s('tComm'):null, tAtt:hasT?s('tAtt'):null, tAcw:hasT?s('tAcw'):null,
    tPause:hLog-hProd
  };
}

const MOIS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
function periodKeys(type){return [...new Set(DB.rows.filter(r=>r.type===type).map(r=>r.periode))].sort()}
function periodLabel(type,p){
  if(!p)return '—';
  if(type==='hebdo'){const m=p.match(/^(\d{4})-S(\d{2})$/);return m?`Semaine ${+m[2]} · ${m[1]}`:p}
  const m=p.match(/^(\d{4})-(\d{2})$/);return m?(MOIS[+m[2]-1]+' '+m[1]):p;
}
function periodShort(type,p){
  if(type==='hebdo'){const m=p.match(/^\d{4}-S(\d{2})$/);return m?('S'+ +m[1]):p}
  const m=p.match(/^(\d{4})-(\d{2})$/);return m?(m[2]+'/'+m[1].slice(2)):p;
}


/* ---------- listes actives + sélection selon la source ---------- */
function filialesList(){
  return [...new Set(DB.rows.map(r=>r.filiale))].sort().map(n=>({id:n,nom:n}));
}
function activitesList(){
  return [...new Set(DB.rows.map(r=>r.activite))].sort().map(n=>({id:n,nom:n}));
}
function freqsDisponibles(){
  return ['hebdo','mensuel'].filter(t=>DB.rows.some(r=>r.type===t));
}
function ensureFreq(){
  const av=freqsDisponibles();
  if(!av.includes(state.freq))state.freq=av[0]||'hebdo';
}
function selectionAt(back){
  const keys=periodKeys(state.freq);
  const p=keys[keys.length-1-back];
  if(!p)return [];
  return DB.rows.filter(r=>r.type===state.freq&&r.periode===p
    &&(state.filiale==='all'||r.filiale===state.filiale)
    &&(state.activite==='all'||r.activite===state.activite));
}
const selection=()=>selectionAt(0);
const selectionBack=k=>agg(selectionAt(k))||emptyAgg();
