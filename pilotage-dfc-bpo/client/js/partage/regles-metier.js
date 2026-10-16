/* =======================================================================
   Pilotage DFC × BPO — RÈGLES MÉTIER PARTAGÉES (navigateur + serveur Node).
   Une seule source de vérité pour :
     · les rôles et leurs permissions ;
     · le périmètre filiale d'un compte ;
     · la normalisation et la validation des fichiers d'import ;
     · la consolidation automatique des extractions « par agent ».
   Chargé tel quel par le navigateur (window.PilotageRegles) et par le
   serveur (require). Aucune dépendance, aucun accès au stockage : les
   recherches en base sont injectées via le paramètre « base ».
   ======================================================================= */
(function(racine,fabrique){
  const module_=fabrique();
  if(typeof module==='object'&&module.exports)module.exports=module_;
  else racine.PilotageRegles=module_;
})(typeof self!=='undefined'?self:this,function(){
'use strict';

/* ---------- rôles & permissions ---------- */
const PERMISSIONS={
  ADMIN:{finance:true,importer:true,corriger:true,gerer_comptes:true,audit:true,sauvegarde:true,purger:true},
  DFC:{finance:true,importer:true,corriger:true,gerer_comptes:false,audit:false,sauvegarde:false,purger:false},
  DIRECTION:{finance:true,importer:false,corriger:false,gerer_comptes:false,audit:false,sauvegarde:false,purger:false},
  BPO:{finance:false,importer:false,corriger:false,gerer_comptes:false,audit:false,sauvegarde:false,purger:false},
  CONTRIBUTEUR:{finance:false,importer:true,corriger:true,gerer_comptes:false,audit:false,sauvegarde:false,purger:false}};
const ROLES_LABELS={ADMIN:'Administrateur',DFC:'DFC',DIRECTION:'Direction',BPO:'BPO',CONTRIBUTEUR:'Contributeur'};
const CHAMPS_FINANCIERS=['ca_facture','masse_salariale'];

/* ---------- aléa (Web Crypto, disponible en navigateur et en Node ≥ 19) ---------- */
const genJeton=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
/* code de récupération administrateur : 16 caractères sans ambiguïté, affiché une seule fois */
function genCodeRecup(){
  const c='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const x=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>c[b%c.length]).join('');
  return x.match(/.{4}/g).join('-');
}
const normCode=c=>String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
/* périmètre d'un compte : '' = groupe (toutes filiales), sinon une filiale */
const perim=u=>String((u&&u.filiale)||'').trim();
const dansPerim=(u,f)=>!perim(u)||String(f||'').trim().toLowerCase()===perim(u).toLowerCase();
function genMdpProvisoire(){
  const c='ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  return [...crypto.getRandomValues(new Uint8Array(10))].map(b=>c[b%c.length]).join('');
}


/* ---------- exposition des profils ---------- */
const profil=(u,prov)=>({nom:u.nom,login:u.login,role:u.role,roleLabel:ROLES_LABELS[u.role],filiale:String(u.filiale||''),
  provisoire:prov!==undefined?prov:!!u.provisoire,permissions:PERMISSIONS[u.role]});
const filtrerFinance=(l,p)=>{if(p.finance)return l;const c={...l};for(const k of CHAMPS_FINANCIERS)delete c[k];return c};

/* ---------- normalisation des imports ---------- */
const CORRESPONDANCE={type_periode:'type_periode',type:'type_periode',periode:'periode',semaine_ou_mois:'periode',
  filiale:'filiale',site:'filiale',activite:'activite',ligne:'activite',
  agents:'agents',agents_staffes:'agents',effectif:'agents',
  heures_loguees:'heures_loguees',h_loguees:'heures_loguees',heures_logees:'heures_loguees',
  heures_productives:'heures_productives',h_productives:'heures_productives',
  appels_traites:'appels_traites',appels:'appels_traites',
  fiches_traitees:'fiches_traitees',fiches:'fiches_traitees',
  dmt_sec:'dmt_sec',dmt:'dmt_sec',ca_facture:'ca_facture',ca:'ca_facture',chiffre_d_affaires:'ca_facture',
  masse_salariale:'masse_salariale',ms:'masse_salariale',
  t_comm_h:'t_comm_h',t_attente_h:'t_attente_h',t_acw_h:'t_acw_h',t_post_appel_h:'t_acw_h'};
const normEntete=h=>String(h).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
function parseNum(v){if(v==null)return null;
  const t=String(v).trim().replace(/\u00A0/g,'').replace(/ /g,'');
  if(t==='')return null;const n=parseFloat(t.replace(',','.'));return Number.isNaN(n)?NaN:n}
function normPeriode(type,p){const t=String(p).trim().toUpperCase();
  if(type==='hebdo'){const m=t.match(/^(\d{4})[-\s]?S(\d{1,2})$/);
    if(!m||+m[2]<1||+m[2]>53)return null;return m[1]+'-S'+String(+m[2]).padStart(2,'0')}
  const m=t.match(/^(\d{4})[-\/](\d{1,2})$/);
  if(!m||+m[2]<1||+m[2]>12)return null;return m[1]+'-'+String(+m[2]).padStart(2,'0')}
const nettoyer=v=>String(v??'').trim().replace(/\s+/g,' ');
const resume=d=>({agents:d.agents,heures_loguees:d.heures_loguees,heures_productives:d.heures_productives,
  appels_traites:d.appels_traites,fiches_traitees:d.fiches_traitees,dmt_sec:Math.round(d.dmt_sec),
  ca_facture:d.ca_facture,masse_salariale:d.masse_salariale});

/* ---------- consolidation d'une extraction PAR AGENT ---------- */
function consoliderParAgent(tableau,entetes){
  const idx={};for(const c of['type_periode','periode','heures_loguees','heures_productives','appels_traites',
    'fiches_traitees','dmt_sec','t_comm_h','t_attente_h','t_acw_h'])idx[c]=entetes.indexOf(c);
  const n0=v=>{const x=parseNum(v);return x==null||Number.isNaN(x)?0:x};
  const groupes=new Map();let lus=0,ignorees=0;
  for(let i=1;i<tableau.length;i++){const r=tableau[i]||[];
    if(!r.some(v=>String(v??'').trim()!==''))continue;
    const cell=c=>(idx[c]>=0&&idx[c]<r.length?r[idx[c]]:'');
    const type=String(cell('type_periode')??'').trim().toLowerCase();
    const periode=(type==='hebdo'||type==='mensuel')?normPeriode(type,cell('periode')??''):null;
    const hl=parseNum(cell('heures_loguees')),hp=parseNum(cell('heures_productives'));
    if(!periode||hl==null||Number.isNaN(hl)||hp==null||Number.isNaN(hp)||hl<0||hp<0){ignorees++;continue}
    const cle=type+'|'+periode;
    if(!groupes.has(cle))groupes.set(cle,{type_periode:type,periode,agents:0,heures_loguees:0,heures_productives:0,
      appels_traites:0,fiches_traitees:0,dmt_pond:0,t_comm_h:0,t_attente_h:0,t_acw_h:0});
    const g=groupes.get(cle);lus++;g.agents++;
    g.heures_loguees+=hl;g.heures_productives+=Math.min(hp,hl);
    const ap=n0(cell('appels_traites'));g.appels_traites+=ap;g.fiches_traitees+=n0(cell('fiches_traitees'));
    g.dmt_pond+=n0(cell('dmt_sec'))*ap;
    g.t_comm_h+=n0(cell('t_comm_h'));g.t_attente_h+=n0(cell('t_attente_h'));g.t_acw_h+=n0(cell('t_acw_h'));}
  const a1=v=>Math.round(v*10)/10;
  const sortie=[...groupes.values()].map(g=>{const dmt=g.appels_traites?a1(g.dmt_pond/g.appels_traites):0;
    delete g.dmt_pond;
    for(const k of['heures_loguees','heures_productives','appels_traites','fiches_traitees','t_comm_h','t_attente_h','t_acw_h'])g[k]=a1(g[k]);
    return {...g,dmt_sec:dmt}}).sort((a,b)=>(a.type_periode+a.periode).localeCompare(b.type_periode+b.periode));
  return sortie.length?{groupes:sortie,lignes_source:lus,ignorees}:null;
}

/* ---------- validation d'un tableau importé ----------
   base.existante(type,periode,filiale,activite) → ligne active de même clé ou null
   base.precedente(type,filiale,activite,periode) → ligne active de la période antérieure la plus proche ou null */
function validerTableau(tableau,base){
  const erreurs=[],avertissements=[],lignes=[];
  if(!Array.isArray(tableau)||tableau.length<2)
    return {lignes,erreurs:[{ligne:0,motif:'Fichier vide ou sans lignes de données.'}],avertissements,doublons:[],consolidation:null};
  const entetes=tableau[0].map(h=>CORRESPONDANCE[normEntete(h)]||null);
  for(const ob of['type_periode','periode','filiale','activite','agents','heures_loguees','heures_productives'])
    if(!entetes.includes(ob))erreurs.push({ligne:1,motif:'En-tête obligatoire manquant : '+ob+' — utilisez le gabarit.'});
  if(erreurs.length)return {lignes,erreurs,avertissements,doublons:[],consolidation:null};
  const idxAgents=entetes.indexOf('agents'),idxFiliale=entetes.indexOf('filiale');
  let parAgent=0,nb=0;
  for(let i=1;i<tableau.length;i++){const c=(tableau[i]||[]).map(v=>String(v??'').trim());
    if(!c.some(Boolean))continue;nb++;
    const va=c[idxAgents]||'',vf=c[idxFiliale]||'';
    if(/[A-Za-zÀ-ÿ]/.test(va)||(va&&!vf))parAgent++;}
  if(nb&&parAgent>=Math.max(3,nb*0.5)){
    return {lignes,erreurs:[{ligne:0,motif:'Ce fichier ressemble à une extraction PAR AGENT (une ligne par personne, colonne agents = « matricule - Nom »). L\'application attend une ligne CONSOLIDÉE par période × filiale × activité : agents = effectif (nombre), heures et appels = totaux, DMT = moyenne pondérée par les appels. Utilisez la consolidation automatique proposée ci-dessous, ou consolidez manuellement (guide PDF, chapitre 6).'}],
      avertissements,doublons:[],consolidation:consoliderParAgent(tableau,entetes)};
  }
  const vues=new Map();
  for(let i=1;i<tableau.length;i++){
    const no=i+1,brut={};entetes.forEach((k,j)=>{if(k)brut[k]=tableau[i][j]});
    if(Object.values(brut).every(v=>String(v??'').trim()===''))continue;
    const type=nettoyer(brut.type_periode).toLowerCase();
    if(type!=='hebdo'&&type!=='mensuel'){erreurs.push({ligne:no,motif:'type_periode invalide « '+(brut.type_periode??'')+' » (attendu : hebdo ou mensuel).'});continue}
    const periode=normPeriode(type,brut.periode??'');
    if(!periode){erreurs.push({ligne:no,motif:'periode invalide « '+(brut.periode??'')+' » (attendu : 2026-S33 ou 2026-07).'});continue}
    const filiale=nettoyer(brut.filiale),activite=nettoyer(brut.activite);
    if(!filiale){erreurs.push({ligne:no,motif:'Filiale vide.'});continue}
    if(!activite){erreurs.push({ligne:no,motif:'Activité vide.'});continue}
    const agents=parseNum(brut.agents),hLog=parseNum(brut.heures_loguees),hProd=parseNum(brut.heures_productives);
    if([agents,hLog,hProd].some(v=>v==null||Number.isNaN(v))){erreurs.push({ligne:no,motif:'agents / heures_loguees / heures_productives manquants ou non numériques.'});continue}
    if(agents<0||hLog<0||hProd<0){erreurs.push({ligne:no,motif:'Valeur négative sur agents ou heures.'});continue}
    if(hProd>hLog*1.001){erreurs.push({ligne:no,motif:'Heures productives ('+hProd+') supérieures aux heures loguées ('+hLog+').'});continue}
    const n0=v=>{const n=parseNum(v);return n==null||Number.isNaN(n)?0:n};
    const appels=n0(brut.appels_traites),fiches=n0(brut.fiches_traitees),ca=n0(brut.ca_facture),ms=n0(brut.masse_salariale);
    if(appels<0||fiches<0){erreurs.push({ligne:no,motif:'Volume négatif (appels ou fiches).'});continue}
    if(ca<0){erreurs.push({ligne:no,motif:'CA facturé négatif.'});continue}
    if(ms<0){erreurs.push({ligne:no,motif:'Masse salariale négative.'});continue}
    let dmt=n0(brut.dmt_sec),derivee=false;
    if(dmt<0){erreurs.push({ligne:no,motif:'DMT négative.'});continue}
    if(appels>0&&!dmt){dmt=hProd*3600/appels;derivee=true}
    const cle=type+'|'+periode+'|'+filiale.toLowerCase()+'|'+activite.toLowerCase();
    if(vues.has(cle)){erreurs.push({ligne:no,motif:'Doublon dans le fichier avec la ligne '+vues.get(cle)+' (même période × filiale × activité).'});continue}
    vues.set(cle,no);
    const opt=v=>{const n=parseNum(v);return n==null||Number.isNaN(n)?null:n};
    lignes.push({no,type_periode:type,periode,filiale,activite,agents,heures_loguees:hLog,heures_productives:hProd,
      appels_traites:appels,fiches_traitees:fiches,dmt_sec:dmt,ca_facture:ca,masse_salariale:ms,
      t_comm_h:opt(brut.t_comm_h),t_attente_h:opt(brut.t_attente_h),t_acw_h:opt(brut.t_acw_h)});
    const occ=hLog?hProd/hLog:0;
    if(occ>0.92)avertissements.push({ligne:no,motif:'Taux d\'occupation très élevé ('+Math.round(occ*100)+' %).'});
    if(derivee)avertissements.push({ligne:no,motif:'DMT absente — dérivée des heures productives et des appels.'});
    if(appels>0&&(dmt<60||dmt>1200))avertissements.push({ligne:no,motif:'DMT anormale ('+Math.round(dmt)+' s).'});
    if(appels===0&&fiches===0)avertissements.push({ligne:no,motif:'Activité sans volume (ni appels ni fiches).'});
    if(ca===0&&hProd>0)avertissements.push({ligne:no,motif:'CA nul malgré des heures productives.'});
    const prec=base.precedente(type,filiale,activite,periode);
    if(prec&&prec.ca_facture>0&&ca>0){
      const va=(ca-prec.ca_facture)/prec.ca_facture*100;
      if(Math.abs(va)>50)avertissements.push({ligne:no,motif:'Variation du CA de '+(va>0?'+':'')+Math.round(va)+' % vs '+prec.periode+'.'});}
  }
  const doublons=[];
  for(const l of lignes){const ex=base.existante(l.type_periode,l.periode,l.filiale,l.activite);
    if(ex)doublons.push({cle:l.type_periode+' '+l.periode+' · '+l.filiale+' · '+l.activite,ligne:l.no,
      existante:ex,nouvelle:{agents:l.agents,heures_loguees:l.heures_loguees,heures_productives:l.heures_productives,
        appels_traites:l.appels_traites,fiches_traitees:l.fiches_traitees,dmt_sec:l.dmt_sec,
        ca_facture:l.ca_facture,masse_salariale:l.masse_salariale}});}
  return {lignes,erreurs,avertissements,doublons,consolidation:null};
}

const validerLogin=l=>/^[a-z0-9._-]{3,}$/.test(l);
const normFiliale=v=>String(v||'').trim().replace(/\s+/g,' ').slice(0,60);

return {PERMISSIONS,ROLES_LABELS,CHAMPS_FINANCIERS,genJeton,genCodeRecup,normCode,perim,dansPerim,genMdpProvisoire,
  profil,filtrerFinance,CORRESPONDANCE,normEntete,parseNum,normPeriode,nettoyer,resume,consoliderParAgent,validerTableau,
  validerLogin,normFiliale};
});
