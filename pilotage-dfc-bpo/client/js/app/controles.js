/* =======================================================================
   app/controles.js — Câblage des contrôles de l'interface
   Contenu    : filtres, zone de dépôt, téléchargements, archivage, sauvegarde / restauration, export CSV, impression
   Dépend de  : toutes les vues (chargé après elles)
   ======================================================================= */
/* ---------- câblage des contrôles ---------- */
function wireSeg(id,attr,key,after){
  document.getElementById(id).addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||b.disabled)return;
    state[key]=b.dataset[attr];
    if(after)after();
    renderAll();
  });
}
wireSeg('segFreq','f','freq');
wireSeg('segNiveau','n','niveau');
document.getElementById('selFiliale').onchange=e=>{state.filiale=e.target.value;renderAll()};
document.getElementById('selActivite').onchange=e=>{state.activite=e.target.value;renderAll()};

const drop=document.getElementById('drop'), fileInput=document.getElementById('fileInput');
drop.onclick=()=>fileInput.click();
drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fileInput.click()}};
fileInput.onchange=()=>{handleFiles([...fileInput.files]);fileInput.value=''};
['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over')}));
drop.addEventListener('drop',e=>{if(e.dataTransfer&&e.dataTransfer.files.length)handleFiles([...e.dataTransfer.files])});

document.getElementById('btnModele').onclick=()=>telechargerRessource('modele');
document.getElementById('btnGuide').onclick=()=>telechargerRessource('guide');
document.getElementById('btnGabarit').onclick=()=>{
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([GABARIT],{type:'text/csv;charset=utf-8'}));
  a.download='gabarit_pilotage_dfc_bpo.csv';
  a.click();URL.revokeObjectURL(a.href);
};
document.getElementById('btnArchiverTout').onclick=async()=>{
  if(!droits().purge)return;
  const c=prompt('Toutes les données actives partiront en corbeille (restaurables).\nTapez ARCHIVER pour confirmer :');
  if(c===null)return;
  try{
    const r=await api('/donnees/archiver-tout',{methode:'POST',corps:{confirmation:String(c).trim().toUpperCase()}});
    bandeau(r.archivees+' ligne(s) archivée(s) — récupérables dans la corbeille.');
    await rafraichirProduction();chargerCorbeille();
  }catch(e){bandeau(e.message,true)}
};
document.getElementById('btnSauvegarde').onclick=()=>{telechargerSauvegarde()};
document.getElementById('btnRestaurer').onclick=async()=>{
  const err=document.getElementById('restErr');err.textContent='';
  const f=(document.getElementById('restFile').files||[])[0];
  if(!f){err.textContent='Choisissez un fichier de sauvegarde (.json).';return}
  let s;try{s=JSON.parse(await f.text())}catch(e){err.textContent='Fichier illisible : ce n\'est pas un JSON valide.';return}
  if(!confirm('La restauration remplace TOUT le contenu actuel (comptes, données, journaux) par celui de la sauvegarde.\nContinuer ?'))return;
  try{
    const r=await api('/restauration',{methode:'POST',corps:{
      confirmation:document.getElementById('restConfirm').value.trim().toUpperCase(),sauvegarde:s}});
    document.getElementById('restConfirm').value='';document.getElementById('restFile').value='';
    bandeau('Restauration effectuée : '+r.donnees+' données, '+r.utilisateurs+' comptes. Les autres sessions ont été déconnectées.');
    await rafraichirProduction();chargerJournal();chargerCorbeille();chargerUsers();chargerAudit();
  }catch(e){err.textContent=e.message}
};
document.getElementById('btnVider').onclick=async()=>{
  const err=document.getElementById('viderErr');err.textContent='';
  const saisi=document.getElementById('viderConfirm').value.trim().toUpperCase();
  if(saisi!=='VIDER'){err.textContent='Tapez VIDER (en majuscules) dans le champ pour confirmer.';return}
  if(!confirm('Ceci supprime DÉFINITIVEMENT toutes les données, tous les journaux et tous les comptes (sauf le vôtre).\nCette action est irréversible. Continuer ?'))return;
  try{
    const r=await api('/administration/vider-tout',{methode:'POST',corps:{confirmation:saisi}});
    document.getElementById('viderConfirm').value='';
    bandeau('Base vidée : '+r.donnees+' donnée(s) et '+r.comptes+' compte(s) supprimés.');
    await rafraichirProduction();chargerJournal();chargerCorbeille();chargerUsers();chargerAudit();
  }catch(e){err.textContent=e.message}
};
document.getElementById('mainNav').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;switchView(b.dataset.v);
});
document.getElementById('btnGoData').onclick=()=>switchView('data');
document.getElementById('btnAuditRafraichir').onclick=chargerAudit;
document.getElementById('authBtn').onclick=submitAuth;
document.getElementById('authScreen').addEventListener('keydown',e=>{if(e.key==='Enter')submitAuth()});
document.getElementById('pwdSave').onclick=savePwd;
document.getElementById('pwdModal').addEventListener('keydown',e=>{if(e.key==='Enter')savePwd()});
document.getElementById('pwdCancel').onclick=()=>{if(!pwdForce)document.getElementById('pwdModal').hidden=true};
document.getElementById('btnCreateUser').onclick=creerCompte;


document.getElementById('btnCsv').onclick=()=>{
  const d=droits();
  const rows=tableRows().filter(r=>r.a);
  if(!rows.length)return;
  const cols=COLS.filter(c=>!(c.fin&&!d.fin));
  const head=cols.map(c=>c.k==='lib'?(state.niveau==='groupe'?'Filiale':state.niveau):c.t);
  const body=rows.map(r=>cols.map(c=>c.raw(r)));
  body.push(cols.map(c=>c.raw({k:'Total',a:agg(selection())||emptyAgg()})));
  const periode=state.source==='demo'?FREQ[state.freq].periode:periodLabel(state.freq,periodKeys(state.freq).slice(-1)[0]);
  const meta=[
    ['Tableau de bord de pilotage interne — DFC & BPO'],
    ['Profil',MOI?MOI.login+' ('+MOI.roleLabel+')':'—'],['Source',state.source==='demo'?'Données simulées (démo)':'Données de production (base centrale)'],
    ['Fréquence',FREQ[state.freq].lab],['Période',periode],
    ['Niveau',state.niveau],
    ['Filiale',state.filiale==='all'?'Toutes':(filialesList().find(f=>f.id===state.filiale)||{}).nom||state.filiale],
    ['Activité',state.activite==='all'?'Toutes':(activitesList().find(a=>a.id===state.activite)||{}).nom||state.activite],[]
  ];
  const csv='\uFEFF'+[...meta,head,...body].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(';')).join('\r\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  a.download=`pilotage_${MOI?MOI.role:'X'}_${state.freq}_${state.niveau}.csv`;
  a.click();URL.revokeObjectURL(a.href);
};
document.getElementById('btnPdf').onclick=()=>window.print();
