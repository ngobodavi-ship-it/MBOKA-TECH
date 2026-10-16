/* =======================================================================
   app/import-assistant.js — Import — assistant
   Contenu    : handleFiles() : lecture → contrôle → prévisualisation (POST /imports/previsualiser) → confirmation (POST /imports/confirmer)
   Dépend de  : csv.js, import-*.js, lib/api.js
   ======================================================================= */
/* ---------- assistant d'import : lecture → contrôle → prévisualisation → confirmation ---------- */
let WIZ=null;
async function handleFiles(files){
  if(!droits().imp||!files.length)return;
  /* extractions Hermès brutes (production / rapport détaillé), déposées ensemble ou l'une après l'autre */
  const lus=[];
  if(typeof XLSX!=='undefined'){
    try{for(const f of files)if(/\.(xlsx|xls)$/i.test(f.name))lus.push({f,wb:XLSX.read(await f.arrayBuffer(),{type:'array'})})}
    catch(e){bandeau('Fichier illisible : '+e.message,true);return}
  }
  const bruts=lus.filter(x=>!feuilleParNom(x.wb,'donnees'))
    .map(x=>({...x,type:typeExtractionBrute(x.wb.Sheets[x.wb.SheetNames[0]])})).filter(x=>x.type);
  if(bruts.length){
    const enAttente=!!(WIZ&&WIZ.modele&&WIZ.modele.brut&&!WIZ.rep);
    const src=enAttente?{...WIZ.modele.sources}:{};
    delete src.periode;
    for(const x of bruts)src[x.type]={nom:x.f.name,ws:x.wb.Sheets[x.wb.SheetNames[0]]};
    const m=construireDepuisExtractions(src);
    if(m.erreur){bandeau(m.erreur,true);return}
    if(bruts.filter(x=>x.type==='prod').length>1||bruts.filter(x=>x.type==='det').length>1)
      m.notes.unshift('Plusieurs fichiers du même type déposés : seul le dernier de chaque type est retenu.');
    const nom=[src.prod&&src.prod.nom,src.det&&src.det.nom].filter(Boolean).map(n=>n.replace(/\.(xlsx|xls)$/i,'')).join(' + ')+'-consolide.xlsx';
    WIZ={fichier:nom,modele:m,saisie:enAttente?WIZ.saisie:undefined};renderWizard();
    bandeau(src.prod&&src.det?'Extractions Hermès reconnues (production + rapport détaillé) — ligne consolidée calculée. Complétez la filiale et l\'activité.'
      :'Extraction Hermès reconnue ('+(src.prod?'production par agent':'rapport détaillé par agent')+'). Ajoutez '+(src.prod?'le rapport détaillé':'la production')+' pour un calcul complet.');
    return;
  }
  const f=files[0];
  let tableau;
  try{
    if(/\.(xlsx|xls)$/i.test(f.name)){
      if(typeof XLSX==='undefined'){bandeau('Lecture Excel indisponible (bibliothèque locale non chargée) — importez le CSV.',true);return}
      const wb=(lus.find(x=>x.f===f)||{}).wb||XLSX.read(await f.arrayBuffer(),{type:'array'});
      const modele=lireModeleImport(wb);
      if(modele){
        if(modele.erreur){bandeau(modele.erreur,true);return}
        const nomM=f.name.replace(/\.(xlsx|xls)$/i,'')+'-donnees.xlsx';
        if(champsAComp(modele.tableau)){
          WIZ={fichier:nomM,modele};renderWizard();
          bandeau('Modèle d\'import reconnu — feuille « donnees » lue. Complétez la filiale et l\'activité.');
          return;
        }
        bandeau('Modèle d\'import reconnu — feuille « donnees » lue'+(modele.notes.length?' · '+modele.notes.join(' '):'.'),false);
        await previsualiserTableau(nomM,modele.tableau);
        return;
      }
      tableau=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:false,defval:''});
    }else{
      tableau=parseCSV(await f.text());
    }
  }catch(e){bandeau('Fichier illisible : '+e.message,true);return}
  let nomFichier=f.name;
  const brut=convertirRapportBrut(tableau);
  if(brut){
    nomFichier=nomFichier.replace(/\.(xlsx|xls|csv)$/i,'')+'-converti.xlsx';
    tableau=brut;
    bandeau('Extraction brute reconnue ('+(f.name)+') — conversion automatique en tableau par agent.');
  }
  await previsualiserTableau(nomFichier, tableau);
}
async function previsualiserTableau(nomFichier, tableau){
  const zone=document.getElementById('wizZone');
  zone.innerHTML='<div class="datalist" style="margin-top:12px">Contrôle du fichier par le serveur…</div>';
  try{
    const rep=await api('/imports/previsualiser',{methode:'POST',corps:{fichier:nomFichier,tableau}});
    WIZ={fichier:nomFichier,rep};
    if(!rep.token&&!rep.consolidation){
      api('/imports/journaliser-refus',{methode:'POST',corps:{fichier:nomFichier,rejetees:rep.resume.erreurs,
        details:rep.erreurs.slice(0,3).map(e=>'L'+e.ligne+' : '+e.motif).join(' · ')}})
        .then(chargerJournal).catch(()=>{});
    }
    renderWizard();
  }catch(e){zone.innerHTML='';bandeau(e.message,true)}
}
function renderWizard(){
  const zone=document.getElementById('wizZone');
  if(!WIZ){zone.innerHTML='';return}
  if(WIZ.modele&&!WIZ.rep){renderCompletionModele(zone);return}
  const r=WIZ.rep,res=r.resume;
  if(!r.token&&r.consolidation){renderConsolidation(zone,r);return}
  const chips=`<div class="chips">
    <span class="chip ok">${res.valides} ligne${res.valides>1?'s':''} valide${res.valides>1?'s':''}</span>
    <span class="chip ${res.erreurs?'err':''}">${res.erreurs} erreur${res.erreurs>1?'s':''} bloquante${res.erreurs>1?'s':''}</span>
    <span class="chip ${res.avertissements?'warn':''}">${res.avertissements} avertissement${res.avertissements>1?'s':''}</span>
    <span class="chip ${res.doublons?'warn':''}">${res.doublons} doublon${res.doublons>1?'s':''} en base</span></div>`;
  const liste=(arr,cls,titre)=>arr.length
    ?`<h4 class="mini">${titre}</h4><div class="wiz-liste">${arr.map(e=>`<div class="${cls}">${e.ligne?`Ligne ${e.ligne} — `:''}${esc(e.motif)}</div>`).join('')}</div>`:'';
  let dbl='';
  if(r.doublons.length){
    const fmt=x=>`${nf(x.agents)} agents · ${nf(x.heures_loguees)} h loguées · ${nf((x.appels_traites||0)+(x.fiches_traitees||0))} vol · DMT ${x.dmt_sec?mmss(x.dmt_sec):'—'}`
      +(droits().fin?` · CA ${fcfa(x.ca_facture||0)}`:'');
    dbl=`<h4 class="mini">Doublons — même période × filiale × activité déjà en base</h4>
      <div class="wiz-liste">${r.doublons.map(d=>
        `<div><b>${esc(d.cle)}</b> (ligne ${d.ligne})<br>&nbsp;&nbsp;existante : ${fmt(d.existante)}<br>&nbsp;&nbsp;nouvelle&nbsp;&nbsp;: ${fmt(d.nouvelle)}</div>`).join('')}</div>
      <label class="check"><input type="checkbox" id="wizRemplacer">
        Remplacer ${r.doublons.length>1?'ces '+r.doublons.length+' données existantes':'la donnée existante'} — l'ancienne version part en corbeille (restaurable), l'opération est tracée dans l'audit</label>`;
  }
  const actions=r.token
    ?`<div class="wiz-actions"><button class="btn" id="wizConfirmer">Confirmer l'import — ${res.valides} ligne${res.valides>1?'s':''}</button>
       <button class="btn ghost" id="wizAnnuler">Annuler</button></div>
      <div class="cap" style="margin-top:8px">Rien n'est enregistré tant que vous n'avez pas confirmé. Les lignes en erreur ne seront pas importées.</div>`
    :`<div class="cap" style="margin-top:10px;color:var(--alert)">Fichier refusé : aucune ligne valide. Le refus a été journalisé.</div>
      <div class="wiz-actions"><button class="btn ghost" id="wizAnnuler">Fermer</button></div>`;
  zone.innerHTML=`<h4 class="mini">Prévisualisation — ${esc(WIZ.fichier)}</h4>${chips}
    ${liste(r.erreurs,'l-err','Erreurs bloquantes')}
    ${liste(r.avertissements,'l-warn','Avertissements (non bloquants)')}${dbl}${actions}`;
  const bA=document.getElementById('wizAnnuler');if(bA)bA.onclick=()=>{WIZ=null;renderWizard()};
  const bC=document.getElementById('wizConfirmer');
  if(bC)bC.onclick=async()=>{
    bC.disabled=true;bC.textContent='Import en cours…';
    const remplacer=!!(document.getElementById('wizRemplacer')||{}).checked;
    try{
      const out=await api('/imports/confirmer',{methode:'POST',corps:{token:WIZ.rep.token,remplacer}});
      bandeau(`Import terminé : ${out.integrees} intégrée(s), ${out.remplacees} remplacée(s)`
        +(out.ignorees?`, ${out.ignorees} doublon(s) conservé(s) tels quels`:'')+'.');
      WIZ=null;renderWizard();
      await rafraichirProduction();chargerJournal();chargerCorbeille();
    }catch(e){bC.disabled=false;bC.textContent='Confirmer l\'import';bandeau(e.message,true)}
  };
}



function renderConsolidation(zone,r){
  const c=r.consolidation;
  const unSeul=c.groupes.length===1;
  const lg=g=>`<tr><td style="text-align:left">${esc(g.type_periode)} ${esc(g.periode)}</td>
    <td>${nf(g.agents)}</td><td>${nf(g.heures_loguees,1)}</td><td>${nf(g.heures_productives,1)}</td>
    <td>${nf(g.appels_traites)}</td><td>${nf(g.fiches_traitees)}</td><td>${g.dmt_sec?mmss(g.dmt_sec):'—'}</td></tr>`;
  zone.innerHTML=`<h4 class="mini">Extraction par agent détectée — ${esc(WIZ.fichier)}</h4>
    <div class="chips">
      <span class="chip ok">${c.lignes_source} ligne${c.lignes_source>1?'s':''} agent lue${c.lignes_source>1?'s':''}</span>
      <span class="chip">${c.groupes.length} période${c.groupes.length>1?'s':''}</span>
      ${c.ignorees?`<span class="chip warn">${c.ignorees} ligne${c.ignorees>1?'s':''} illisible${c.ignorees>1?'s':''} ignorée${c.ignorees>1?'s':''}</span>`:''}
    </div>
    <div class="cap" style="margin:4px 0 8px">Ce fichier liste une ligne par personne. L'application a calculé la consolidation
    ci-dessous (agents = effectif, heures et appels = totaux, DMT = moyenne pondérée par les appels).
    Complétez la filiale et l'activité, puis lancez le contrôle habituel — rien n'est importé sans votre confirmation.</div>
    <div class="tablewrap"><table class="tbl-sm">
      <thead><tr><th style="text-align:left">Période</th><th>Agents</th><th>H. loguées</th><th>H. productives</th><th>Appels</th><th>Fiches</th><th>DMT</th></tr></thead>
      <tbody>${c.groupes.map(lg).join('')}</tbody></table></div>
    <div class="frm" style="margin-top:10px">
      <div class="form-grid">
        <div><label for="wcFiliale">Filiale (obligatoire)</label><input id="wcFiliale" placeholder="ex. Bénin"></div>
        <div><label for="wcActivite">Activité (obligatoire)</label><input id="wcActivite" placeholder="ex. Service Client"></div>
      </div>
      ${unSeul?`<div class="form-grid">
        <div><label for="wcCa">CA facturé (FCFA, facultatif)</label><input id="wcCa" inputmode="numeric" placeholder="0"></div>
        <div><label for="wcMs">Masse salariale (FCFA, facultatif)</label><input id="wcMs" inputmode="numeric" placeholder="0"></div>
      </div>`:`<div class="cap">Plusieurs périodes : CA et masse salariale seront laissés à 0 — complétez-les ensuite par un import de mise à jour (remplacement).</div>`}
      <div class="err" id="wcErr"></div>
    </div>
    <div class="wiz-actions">
      <button class="btn" id="wizConsolider">Consolider et contrôler</button>
      <button class="btn ghost" id="wizAnnuler">Fermer</button>
    </div>`;
  document.getElementById('wizAnnuler').onclick=()=>{WIZ=null;renderWizard()};
  document.getElementById('wizConsolider').onclick=async()=>{
    const err=document.getElementById('wcErr');err.textContent='';
    const fil=document.getElementById('wcFiliale').value.trim();
    const act=document.getElementById('wcActivite').value.trim();
    if(!fil||!act){err.textContent='Renseignez la filiale et l\'activité.';return}
    const num=id=>{const el=document.getElementById(id);if(!el)return 0;
      const v=parseFloat(el.value.replace(/\s/g,'').replace(',','.'));return isNaN(v)||v<0?0:v};
    const ca=num('wcCa'), ms=num('wcMs');
    const ENT=['type_periode','periode','filiale','activite','agents','heures_loguees','heures_productives',
      'appels_traites','fiches_traitees','dmt_sec','ca_facture','masse_salariale','t_comm_h','t_attente_h','t_acw_h'];
    const lignes=c.groupes.map(g=>[g.type_periode,g.periode,fil,act,String(g.agents),
      String(g.heures_loguees),String(g.heures_productives),String(g.appels_traites),String(g.fiches_traitees),
      g.dmt_sec?String(g.dmt_sec):'',String(unSeul?ca:0),String(unSeul?ms:0),
      String(g.t_comm_h),String(g.t_attente_h),String(g.t_acw_h)]);
    await previsualiserTableau(WIZ.fichier.replace(/\.(xlsx|xls|csv)$/i,'')+'-consolide.xlsx',[ENT,...lignes]);
  };
}
