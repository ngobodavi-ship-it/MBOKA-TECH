/* =======================================================================
   app/vue-donnees.js — Vue « Données »
   Contenu    : rafraichirProduction() (GET /donnees), résumé de la base, connecteurs, journal des imports, corbeille
   Dépend de  : lib/api.js, navigation.js
   ======================================================================= */
/* ---------- vue Données : état, connecteurs, journal, corbeille ---------- */
async function rafraichirProduction(){
  CHARGE=true;renderChrome();
  if(state.source!=='demo')document.getElementById('context').textContent='Chargement des données de production…';
  try{const rep=await api('/donnees');DB.rows=rep.lignes.map(mapProd)}
  catch(e){DB.rows=[];if(e.statut!==401)bandeau(e.message,true)}
  CHARGE=false;
  ensureFreq();rebuildSelects();renderAll();
}
function renderData(){
  const d=droits();
  document.getElementById('importPanel').style.display=d.imp?'':'none';
  document.getElementById('importLocked').style.display=d.imp?'none':'';
  document.getElementById('btnArchiverTout').style.display=d.purge?'':'none';
  document.getElementById('corbSection').style.display=d.imp?'':'none';
  document.getElementById('sauvSection').style.display=d.sauv?'':'none';
  renderResume();
}
function renderResume(){
  const el=document.getElementById('dataSummary');
  if(CHARGE){el.textContent='Chargement…';return}
  if(!DB.rows.length){el.innerHTML='La base centrale est vide.<br>Téléchargez le « Modèle Excel à remplir » ci-contre, complétez-le avec vos chiffres, puis déposez-le dans la zone d\'import.';return}
  const par=t=>{const rs=DB.rows.filter(r=>r.type===t);if(!rs.length)return '';
    const ps=[...new Set(rs.map(r=>r.periode))].sort();
    return `<b>${t==='hebdo'?'Hebdomadaire':'Mensuel'}</b> — ${ps.length} période${ps.length>1?'s':''} · ${rs.length} lignes · ${esc(ps[0])} → ${esc(ps[ps.length-1])}`};
  el.innerHTML=[par('hebdo'),par('mensuel'),
    `<b>Filiales</b> — ${[...new Set(DB.rows.map(r=>r.filiale))].sort().map(esc).join(', ')}`,
    `<b>Activités</b> — ${[...new Set(DB.rows.map(r=>r.activite))].sort().map(esc).join(', ')}`
  ].filter(Boolean).join('<br>');
}
async function chargerConnecteurs(){
  try{const r=await api('/connecteurs');
    document.getElementById('connecteursListe').innerHTML=r.connecteurs.map(c=>
      `<b>${esc(c.nom)}</b> — <span style="color:${c.connecte?'var(--live)':'#9A9A9A'}">${c.connecte?'connecté':'non branché'}</span><br><span style="color:var(--slate)">${esc(c.statut)}</span>`
    ).join('<br>')+`<br><span style="color:#9A9A9A">${esc(r.note)}</span>`;
  }catch(e){}
}
async function chargerJournal(){
  try{const r=await api('/imports/journal');
    document.getElementById('logBody').innerHTML=r.journal.length?r.journal.map(l=>`<tr>
      <td style="text-align:left">${esc(String(l.date).slice(0,16).replace('T',' '))}</td>
      <td style="text-align:left">${esc(l.utilisateur)}</td>
      <td style="text-align:left">${esc(l.fichier)}</td>
      <td>${l.lignes_integrees}</td><td>${l.lignes_remplacees}</td><td>${l.lignes_rejetees}</td>
      <td style="text-align:left">${l.statut==='refuse'?'<span style="color:var(--alert)">refusé</span>':'validé'}${l.details?' · '+esc(l.details):''}</td></tr>`).join('')
      :'<tr><td colspan="7" style="text-align:left;color:var(--slate)">Aucun import pour le moment.</td></tr>';
    document.getElementById('logNote').textContent=r.journal.length?r.journal.length+' opération(s) — les plus récentes en premier':'';
  }catch(e){}
}
async function chargerCorbeille(){
  if(!droits().imp)return;
  try{const r=await api('/corbeille');
    document.getElementById('corbBody').innerHTML=r.lignes.length?r.lignes.map(l=>{
      const cle=`${l.type_periode} ${l.periode} · ${l.filiale} · ${l.activite}`;
      return `<tr><td style="text-align:left">${esc(cle)}</td><td>${nf(l.agents)}</td><td>${nf(l.heures_loguees)}</td>
        <td>${nf((l.appels_traites||0)+(l.fiches_traitees||0))}</td><td>${esc(String(l.date_import).slice(0,10))}</td>
        <td style="text-align:left">${esc(l.utilisateur_import)}</td>
        <td style="text-align:left">${!droits().filiale||String(l.filiale).toLowerCase()===droits().filiale.toLowerCase()?`<button class="linkbtn" data-act="rest" data-id="${l.id}">restaurer</button>`:'<span class="perim">hors périmètre</span>'}
        ${droits().purge?`<button class="linkbtn danger" data-act="purge" data-id="${l.id}">supprimer définitivement</button>`:''}</td></tr>`}).join('')
      :'<tr><td colspan="7" style="text-align:left;color:var(--slate)">Corbeille vide.</td></tr>';
    document.getElementById('corbNote').textContent=r.lignes.length
      ?r.lignes.length+' ligne(s) archivée(s) — restaurables; suppression définitive réservée à l\'administrateur'
      :'Corbeille vide';
  }catch(e){}
}
document.getElementById('corbBody').addEventListener('click',async e=>{
  const b=e.target.closest('button[data-act]');if(!b)return;
  try{
    if(b.dataset.act==='rest'){
      await api('/corbeille/'+b.dataset.id+'/restaurer',{methode:'POST'});
      bandeau('Donnée restaurée.');
    }else{
      if(!confirm('Suppression DÉFINITIVE de cette ligne archivée — elle ne pourra plus être restaurée.\nConfirmer ?'))return;
      await api('/corbeille/'+b.dataset.id,{methode:'DELETE',entetes:{'X-Confirmation':'SUPPRIMER'}});
      bandeau('Ligne supprimée définitivement.');
    }
    chargerCorbeille();await rafraichirProduction();
  }catch(err){bandeau(err.message,true)}
});
