/* =======================================================================
   app/import-modele-excel.js — Import — modèle Excel « modele-import-pilotage »
   Contenu    : lireModeleImport(), recalcul depuis extractions, complétion des champs manquants, classeur rempli
   Dépend de  : vendor/xlsx.full.min.js
   ======================================================================= */
/* ---------- MODÈLE D'IMPORT EXCEL (classeur « modele-import-pilotage ») ----------
   Classeur à plusieurs feuilles : donnees · notice · correspondance · detail_agents ·
   extraction_production · extraction_detaille. Seule la feuille « donnees » alimente
   l'application (une ligne = période × filiale × activité). Ses cellules sont des
   formules qui lisent « correspondance » : on prend les valeurs calculées par Excel.
   Si le classeur n'a jamais été recalculé (formules sans valeur), on refait le calcul
   ici à partir des deux extractions Hermès collées dans le classeur, avec les mêmes
   règles que la feuille « correspondance ». */
const mdlCle=h=>String(h).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
function mdlPeriode(type,p){const t=String(p).trim().toUpperCase();
  if(type==='hebdo'){const m=t.match(/^(\d{4})[-\s]?S(\d{1,2})$/);return m?m[1]+'-S'+String(+m[2]).padStart(2,'0'):null}
  const m=t.match(/^(\d{4})[-\/](\d{1,2})$/);return m?m[1]+'-'+String(+m[2]).padStart(2,'0'):null}
function feuilleParNom(wb,nom){
  const n=wb.SheetNames.find(s=>mdlCle(s)===nom);
  return n?wb.Sheets[n]:null;
}
function feuilleEnTableau(ws){
  return XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''});
}
function celluleTexte(v){
  if(v==null)return '';
  if(typeof v==='number')return String(Math.round(v*1e6)/1e6);
  return String(v).trim();
}
function periodeExcel(v,type){
  /* « 2026-05 » saisi dans Excel peut devenir une date (numéro de série) */
  if(typeof v==='number'&&v>20000&&type==='mensuel'&&XLSX.SSF&&XLSX.SSF.parse_date_code){
    const d=XLSX.SSF.parse_date_code(v);
    if(d&&d.y)return d.y+'-'+String(d.m).padStart(2,'0');
  }
  return celluleTexte(v);
}
function formulesSansValeur(ws){
  if(!ws||!ws['!ref'])return false;
  for(const k in ws){if(k[0]==='!')continue;const c=ws[k];
    if(c&&c.f&&(c.v===undefined||c.v===null||c.v==='')&&XLSX.utils.decode_cell(k).r>0)return true}
  return false;
}
function recalculerDepuisExtractions(wb,params){
  const prod=feuilleParNom(wb,'extraction_production');
  const det=feuilleParNom(wb,'extraction_detaille');
  if(!prod)return {erreur:'Feuille « extraction_production » introuvable : impossible de recalculer « donnees ». Ouvrez le classeur dans Excel, laissez-le se recalculer, enregistrez, puis réimportez.'};
  const tp=feuilleEnTableau(prod);
  const t=v=>String(v??'').trim();
  const iEnt=tp.findIndex(r=>t((r||[])[0])==='Agents');
  const iRes=tp.findIndex(r=>t((r||[])[0])==='Résumé');
  if(iEnt<0||iRes<0||iRes<iEnt)return {erreur:'Extraction de production illisible (ligne « Agents » ou « Résumé » absente).'};
  const ent=tp[iEnt].map(t), res=tp[iRes];
  const col=n=>ent.indexOf(n);
  let agents=0;for(let i=iEnt+1;i<iRes;i++)if(t((tp[i]||[])[0]))agents++;
  const r2=v=>Math.round(v*100)/100;
  const out={agents,
    heures_loguees:col('Présence')>=0?r2(tempsEnHeures(res[col('Présence')])):'',
    heures_productives:col('Travail')>=0?r2(tempsEnHeures(res[col('Travail')])):'',
    appels_traites:col('Nb. Argu.')>=0?numBrut(res[col('Nb. Argu.')]):'',
    dmt_sec:col('Tps Argu.')>=0?tempsEnSecondes(res[col('Tps Argu.')]):'',
    t_comm_h:'',t_attente_h:'',t_acw_h:''};
  if(det){
    const td=feuilleEnTableau(det);
    const j=td.findIndex(r=>t((r||[])[0])==='Résumé');
    if(j>=0){
      const cherche=lib=>{for(let k=j;k<Math.min(td.length,j+41);k++){if(t((td[k]||[])[1])===lib)return r2(tempsEnHeures((td[k]||[])[6]))}return ''};
      out.t_comm_h=cherche('Traitement');out.t_attente_h=cherche('Attente');out.t_acw_h=cherche('Post-travail');
    }
  }
  if(!params.type_periode||!params.periode){
    const p=periodeDepuisPlage(tp);
    if(p){params.type_periode=params.type_periode||p.type_periode;params.periode=params.periode||p.periode}
  }
  const ENT=['type_periode','periode','filiale','activite','agents','heures_loguees','heures_productives',
    'appels_traites','fiches_traitees','dmt_sec','ca_facture','masse_salariale','t_comm_h','t_attente_h','t_acw_h'];
  const L=[params.type_periode||'',params.periode||'',params.filiale||'',params.activite||'',out.agents,
    out.heures_loguees,out.heures_productives,out.appels_traites,'',out.dmt_sec,'','',out.t_comm_h,out.t_attente_h,out.t_acw_h].map(celluleTexte);
  return {tableau:[ENT,L]};
}
function lireModeleImport(wb){
  const ws=feuilleParNom(wb,'donnees');
  if(!ws)return null;                                  /* pas le modèle : lecture classique */
  const notes=[];
  /* paramètres jaunes de « correspondance » (B5:B8) et contrôles calculés */
  const params={};
  const corr=feuilleParNom(wb,'correspondance');
  if(corr){
    const tc=feuilleEnTableau(corr);
    for(const r of tc){const k=mdlCle((r||[])[0]||'');
      if(['type_periode','periode','filiale','activite'].includes(k)&&params[k]===undefined)
        params[k]=k==='periode'?periodeExcel(r[1],celluleTexte(params.type_periode).toLowerCase()):celluleTexte(r[1]);}
    let dansCtrl=false;
    for(const r of tc){const a=celluleTexte((r||[])[0]),b=celluleTexte((r||[])[1]);
      if(/^4\.\s*CONTR/i.test(a)){dansCtrl=true;continue}
      if(dansCtrl&&a&&/^(ÉCART|ECART)$/i.test(b))notes.push('Contrôle du classeur en écart : '+a+'.');}
  }
  let brut=feuilleEnTableau(ws);
  const entetes=(brut[0]||[]).map(celluleTexte);
  if(!entetes.length)return {erreur:'La feuille « donnees » est vide (ligne d\'en-têtes absente).'};
  const iPer=entetes.map(mdlCle).indexOf('periode'), iType=entetes.map(mdlCle).indexOf('type_periode');
  let lignes=brut.slice(1).map(r=>entetes.map((_,j)=>{
      const v=(r||[])[j];
      return j===iPer?periodeExcel(v,celluleTexte((r||[])[iType]).toLowerCase()):celluleTexte(v)}))
    .filter(r=>r.some(v=>v!==''));
  let tableau=[entetes,...lignes];
  let recalcule=false;
  if(!lignes.length&&(formulesSansValeur(ws)||feuilleParNom(wb,'extraction_production'))){
    const rc=recalculerDepuisExtractions(wb,params);
    if(rc.erreur)return rc;
    tableau=rc.tableau;recalcule=true;
    notes.push('Classeur non recalculé par Excel : « donnees » a été recalculée par l\'application à partir des deux extractions Hermès.');
  }
  if(tableau.length<2)return {erreur:'La feuille « donnees » ne contient aucune ligne de données.'};
  /* cohérence période saisie ↔ période réellement couverte par les extractions */
  const prod=feuilleParNom(wb,'extraction_production')||feuilleParNom(wb,'extraction_detaille');
  if(prod){
    const p=periodeDepuisPlage(feuilleEnTableau(prod));
    const ent=tableau[0].map(mdlCle),it=ent.indexOf('type_periode'),ip=ent.indexOf('periode');
    if(p&&it>=0&&ip>=0){
      const autres=tableau.slice(1).filter(r=>String(r[it]).toLowerCase()===p.type_periode&&mdlPeriode(p.type_periode,r[ip])!==p.periode);
      if(autres.length)notes.push('Période saisie ('+autres[0][ip]+') différente de celle des extractions Hermès ('+p.periode+') — vérifiez la cellule jaune « periode ».');
    }
  }
  return {tableau,notes,recalcule};
}
/* ---------- DEUX EXTRACTIONS HERMÈS BRUTES → une ligne « donnees » ----------
   Reproduit le copier-coller manuel dans le modèle : « Production par agent » (Agents
   production report) et « Rapport détaillé par agent » (Agents report) sont lus tels
   quels (comme collés en A1 des feuilles extraction_production / extraction_detaille),
   puis la ligne est calculée avec les règles de l'onglet « correspondance ». */
function typeExtractionBrute(ws){
  const t=feuilleEnTableau(ws).slice(0,8).flat().map(v=>String(v??'').trim().toLowerCase());
  if(t.includes('agents production report'))return 'prod';
  if(t.includes('agents report'))return 'det';
  return null;
}
function construireDepuisExtractions(src){
  const notes=[],t=v=>String(v??'').trim();
  const wb={SheetNames:[],Sheets:{}};
  if(src.prod){wb.SheetNames.push('extraction_production');wb.Sheets.extraction_production=src.prod.ws}
  if(src.det){wb.SheetNames.push('extraction_detaille');wb.Sheets.extraction_detaille=src.det.ws}
  const tp=src.prod?feuilleEnTableau(src.prod.ws):null, td=src.det?feuilleEnTableau(src.det.ws):null;
  const pp=tp?periodeDepuisPlage(tp):null, pd=td?periodeDepuisPlage(td):null;
  const plage=tab=>{for(const r of (tab||[]).slice(0,20))for(const c of (r||[])){const m=/Du\s+\d{1,2}\/\d{1,2}\/\d{4}\s+au\s+\d{1,2}\/\d{1,2}\/\d{4}/i.exec(t(c));if(m)return m[0]}return ''};
  const plP=plage(tp),plD=plage(td);
  if(plP&&plD&&plP!==plD)notes.push('Les deux extractions ne couvrent pas la même période (production : '+plP+' · détaillé : '+plD+').');
  if(!src.prod)return {tableau:null,notes,sources:src,brut:true,plage:plD,periodeAuto:pd};
  if(!src.det)notes.push('Rapport détaillé non fourni : la décomposition conversation / attente / post-appel restera vide.');
  const params={type_periode:(src.periode||{}).type_periode||'',periode:(src.periode||{}).periode||''};
  if(!params.periode&&(pp||pd)){params.type_periode=(pp||pd).type_periode;params.periode=(pp||pd).periode}
  const rc=recalculerDepuisExtractions(wb,params);
  if(rc.erreur)return {erreur:rc.erreur};
  /* contrôles de l'onglet « correspondance » */
  const ent=rc.tableau[0],L=rc.tableau[1],v=k=>parseFloat(L[ent.indexOf(k)])||0;
  if(v('heures_productives')>v('heures_loguees'))notes.push('Contrôle en écart : heures productives supérieures aux heures loguées.');
  if(td){
    const nbAg=td.filter(r=>/^Agent\s+/.test(t((r||[])[0]))).length;
    if(nbAg!==v('agents'))notes.push('Contrôle en écart : '+v('agents')+' agents dans la production, '+nbAg+' dans le rapport détaillé.');
    const j=td.findIndex(r=>t((r||[])[0])==='Résumé');
    if(j>=0){const m=/(\d+h\d{2}'\d{2})/.exec((td[j]||[]).map(t).join(' '));
      if(m&&Math.abs(Math.round(tempsEnHeures(m[1])*100)/100-v('heures_loguees'))>=0.01)
        notes.push('Contrôle en écart : présence différente entre les deux extractions ('+m[1]+' dans le rapport détaillé).');}
  }
  return {tableau:rc.tableau,notes,sources:src,brut:true,plage:plP||plD,periodeAuto:pp||pd};
}
function champsAComp(tableau){
  const ent=tableau[0].map(mdlCle);
  const iF=ent.indexOf('filiale'),iA=ent.indexOf('activite');
  return tableau.slice(1).some(r=>iF<0||iA<0||!String(r[iF]??'').trim()||!String(r[iA]??'').trim());
}
function renderCompletionModele(zone){
  const m=WIZ.modele,brut=!!m.brut;
  const tab=m.tableau||[['type_periode','periode','filiale','activite','agents','heures_loguees','heures_productives','appels_traites','dmt_sec']];
  const ent=tab[0].map(mdlCle);
  const g=(r,k)=>{const i=ent.indexOf(k);return i>=0?r[i]:''};
  const unSeul=tab.length===2;
  const caVide=tab.slice(1).every(r=>!String(g(r,'ca_facture')||'').trim());
  const msVide=tab.slice(1).every(r=>!String(g(r,'masse_salariale')||'').trim());
  const opts=k=>[...new Set(DB.rows.map(r=>r[k]))].filter(Boolean).sort().map(v=>`<option value="${esc(v)}">`).join('');
  const nbF=s=>{const n=parseFloat(String(s).replace(',','.'));return Number.isFinite(n)?n:0};
  const sa=WIZ.saisie||{};
  const val=(k,d)=>esc(sa[k]!==undefined?sa[k]:(d||''));
  const src=m.sources||{};
  const etatSrc=brut?`<div class="chips">
      <span class="chip ${src.prod?'ok':'err'}">Production par agent : ${src.prod?esc(src.prod.nom):'manquante'}</span>
      <span class="chip ${src.det?'ok':'warn'}">Rapport détaillé par agent : ${src.det?esc(src.det.nom):'manquant'}</span>
      ${m.plage?`<span class="chip">${esc(m.plage)}</span>`:''}</div>`
    :`<div class="chips"><span class="chip ok">${tab.length-1} ligne${tab.length>2?'s':''} lue${tab.length>2?'s':''}</span>
      ${m.recalcule?'<span class="chip warn">recalculée depuis les extractions</span>':''}</div>`;
  const manque=brut&&(!src.prod||!src.det);
  const typeCur=sa.type_periode!==undefined?sa.type_periode:(g(tab[1]||[],'type_periode')||(m.periodeAuto||{}).type_periode||'mensuel');
  zone.innerHTML=`<h4 class="mini">${brut?'Extractions Hermès brutes → consolidation (règles du modèle d\'import)':'Modèle d\'import Excel — feuille « donnees » — '+esc(WIZ.fichier)}</h4>
    ${etatSrc}
    ${m.notes.length?`<div class="wiz-liste">${m.notes.map(n=>`<div class="l-warn">${esc(n)}</div>`).join('')}</div>`:''}
    ${manque?`<div class="wiz-actions" style="margin:6px 0"><button class="btn ghost" id="wmAjouter">Ajouter ${!src.prod?'la production par agent':'le rapport détaillé par agent'} (.xls)</button></div>`:''}
    <div class="cap" style="margin:4px 0 8px">${brut
      ?'Les deux extractions sont lues comme si elles étaient collées en A1 des feuilles du modèle ; la ligne est calculée sur le bloc « Résumé » (présence, travail, Nb. Argu., Tps Argu., traitement, attente, post-travail). Vérifiez la période, complétez la filiale et l\'activité.'
      :'La filiale et/ou l\'activité ne sont pas renseignées dans le classeur (cellules jaunes de l\'onglet « correspondance »). Complétez-les ici : elles s\'appliquent aux lignes où elles sont vides.'}
      Le contrôle habituel suit — rien n'est importé sans votre confirmation.</div>
    ${m.tableau?`<div class="tablewrap"><table class="tbl-sm">
      <thead><tr><th style="text-align:left">Période</th><th style="text-align:left">Filiale</th><th style="text-align:left">Activité</th><th>Agents</th><th>H. loguées</th><th>H. productives</th><th>Appels</th><th>DMT</th>${brut?'<th>Conv. h</th><th>Attente h</th><th>Post-app. h</th>':''}</tr></thead>
      <tbody>${tab.slice(1).map(r=>`<tr><td style="text-align:left">${esc(g(r,'type_periode'))} ${esc(g(r,'periode'))}</td>
        <td style="text-align:left">${esc(g(r,'filiale')||'—')}</td><td style="text-align:left">${esc(g(r,'activite')||'—')}</td>
        <td>${nf(nbF(g(r,'agents')))}</td><td>${nf(nbF(g(r,'heures_loguees')),1)}</td><td>${nf(nbF(g(r,'heures_productives')),1)}</td>
        <td>${nf(nbF(g(r,'appels_traites')))}</td><td>${nbF(g(r,'dmt_sec'))?mmss(nbF(g(r,'dmt_sec'))):'—'}</td>
        ${brut?`<td>${g(r,'t_comm_h')!==''?nf(nbF(g(r,'t_comm_h')),1):'—'}</td><td>${g(r,'t_attente_h')!==''?nf(nbF(g(r,'t_attente_h')),1):'—'}</td><td>${g(r,'t_acw_h')!==''?nf(nbF(g(r,'t_acw_h')),1):'—'}</td>`:''}</tr>`).join('')}</tbody></table></div>`
      :`<div class="cap" style="color:var(--alert)">La production par agent est indispensable (agents, heures, appels, DMT). Ajoutez-la pour continuer.</div>`}
    <div class="frm" style="margin-top:10px">
      ${brut?`<div class="form-grid">
        <div><label for="wmType">Type de période</label><select id="wmType" class="role-sel" style="width:100%;padding:9px 8px">
          <option value="mensuel"${typeCur==='mensuel'?' selected':''}>mensuel</option><option value="hebdo"${typeCur==='hebdo'?' selected':''}>hebdo</option></select></div>
        <div><label for="wmPeriode">Période (2026-08 ou 2026-S36)</label><input id="wmPeriode" value="${val('periode',g(tab[1]||[],'periode')||(m.periodeAuto||{}).periode)}"></div>
      </div>`:''}
      <div class="form-grid">
        <div><label for="wmFiliale">Filiale (obligatoire)</label><input id="wmFiliale" list="wmFilList" placeholder="ex. Congo" value="${droits().filiale?esc(droits().filiale):val('filiale')}"${droits().filiale?' readonly title="Fixée par votre périmètre"':''}><datalist id="wmFilList">${opts('filiale')}</datalist></div>
        <div><label for="wmActivite">Activité (obligatoire)</label><input id="wmActivite" list="wmActList" placeholder="ex. Service Client" value="${val('activite')}"><datalist id="wmActList">${opts('activite')}</datalist></div>
      </div>
      ${unSeul&&(caVide||msVide)&&droits().fin?`<div class="form-grid">
        ${caVide?`<div><label for="wmCa">CA facturé (FCFA, facultatif)</label><input id="wmCa" inputmode="numeric" placeholder="0" value="${val('ca')}"></div>`:''}
        ${msVide?`<div><label for="wmMs">Masse salariale (FCFA, facultatif)</label><input id="wmMs" inputmode="numeric" placeholder="0" value="${val('ms')}"></div>`:''}
      </div>`:''}
      <div class="err" id="wmErr"></div>
    </div>
    <div class="wiz-actions">
      <button class="btn" id="wmControler"${m.tableau?'':' disabled'}>Compléter et contrôler</button>
      ${brut?`<button class="btn ghost" id="wmExcel"${m.tableau?'':' disabled'}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 1v9M4.5 6.5L8 10l3.5-3.5M2 13.5h12"/></svg>Classeur Excel rempli</button>`:''}
      <button class="btn ghost" id="wizAnnuler">Fermer</button>
    </div>`;
  const lireSaisie=()=>{const o={};for(const [k,id] of [['filiale','wmFiliale'],['activite','wmActivite'],['ca','wmCa'],['ms','wmMs'],['periode','wmPeriode'],['type_periode','wmType']]){
    const el=document.getElementById(id);if(el)o[k]=el.value.trim()}return o};
  document.getElementById('wizAnnuler').onclick=()=>{WIZ=null;renderWizard()};
  const bAj=document.getElementById('wmAjouter');
  if(bAj)bAj.onclick=()=>{WIZ.saisie=lireSaisie();document.getElementById('fileInput').click()};
  const construire=s=>{
    const num=v=>{const x=parseFloat(String(v||'').replace(/\s/g,'').replace(',','.'));return isNaN(x)||x<0?'':String(x)};
    const ENT=tab[0].slice();
    const assure=k=>{let i=ENT.map(mdlCle).indexOf(k);if(i<0){ENT.push(k);i=ENT.length-1}return i};
    const iF=assure('filiale'),iA=assure('activite'),iCa=assure('ca_facture'),iMs=assure('masse_salariale');
    const iT=assure('type_periode'),iP=assure('periode');
    const ca=num(s.ca),ms=num(s.ms);
    const lignes=tab.slice(1).map(r=>{const x=ENT.map((_,j)=>r[j]??'');
      if(brut){x[iT]=s.type_periode;x[iP]=mdlPeriode(s.type_periode,s.periode)}
      if(!String(x[iF]).trim())x[iF]=s.filiale;
      if(!String(x[iA]).trim())x[iA]=s.activite;
      if(unSeul&&ca&&!String(x[iCa]).trim())x[iCa]=ca;
      if(unSeul&&ms&&!String(x[iMs]).trim())x[iMs]=ms;
      return x});
    return [ENT,...lignes];
  };
  document.getElementById('wmControler').onclick=async()=>{
    const err=document.getElementById('wmErr');err.textContent='';
    const s=lireSaisie();
    if(!s.filiale||!s.activite){err.textContent='Renseignez la filiale et l\'activité.';return}
    if(brut&&!mdlPeriode(s.type_periode,s.periode)){err.textContent='Période invalide pour le type « '+s.type_periode+' » (ex. 2026-08 ou 2026-S36).';return}
    await previsualiserTableau(WIZ.fichier,construire(s));
  };
  const bX=document.getElementById('wmExcel');
  if(bX)bX.onclick=()=>{
    const err=document.getElementById('wmErr');err.textContent='';
    const s=lireSaisie();
    if(!mdlPeriode(s.type_periode,s.periode)){err.textContent='Période invalide pour le type « '+s.type_periode+' » (ex. 2026-08 ou 2026-S36).';return}
    try{telechargerClasseurRempli(m,s,construire(s));bandeau('Classeur Excel rempli téléchargé.')}
    catch(e){err.textContent='Création du classeur impossible : '+e.message}
  };
}
function telechargerClasseurRempli(m,s,tab){
  const nombre=v=>{const t=String(v??'').trim();if(t==='')return '';const n=Number(t);return Number.isFinite(n)?n:t};
  const ent=tab[0].map(mdlCle),L=tab[1]||[];
  const ORDRE=['type_periode','periode','filiale','activite','agents','heures_loguees','heures_productives',
    'appels_traites','fiches_traitees','dmt_sec','ca_facture','masse_salariale','t_comm_h','t_attente_h','t_acw_h'];
  const val=k=>{const i=ent.indexOf(k);return i>=0?L[i]:''};
  const ligne=ORDRE.map(k=>['type_periode','periode','filiale','activite'].includes(k)?String(val(k)??''):nombre(val(k)));
  const wb=XLSX.utils.book_new();
  const wsD=XLSX.utils.aoa_to_sheet([ORDRE,ligne]);
  wsD['!cols']=ORDRE.map(k=>({wch:Math.max(12,k.length+2)}));
  XLSX.utils.book_append_sheet(wb,wsD,'donnees');
  const g=k=>ligne[ORDRE.indexOf(k)];
  const corr=[
    ['CORRESPONDANCE EXTRACTIONS HERMES → MODÈLE D’IMPORT PILOTAGE'],
    ['Classeur généré par l’application Pilotage DFC × BPO le '+new Date().toLocaleString('fr-FR')+' — valeurs calculées (pas de formules).'],
    [],
    ['1. PARAMÈTRES'],
    ['type_periode',g('type_periode')],['periode',g('periode')],['filiale',g('filiale')],['activite',g('activite')],
    ['Période lue dans les extractions',m.plage||''],
    [],
    ['2. CORRESPONDANCES (bloc « Résumé » de chaque extraction)'],
    ['Champ du modèle (donnees)','Extraction source','Intitulé lu','Valeur retenue','Règle de conversion'],
    ['agents','Production par agent','Nombre de lignes agents',g('agents'),'Comptage des agents listés'],
    ['heures_loguees','Production par agent','Présence',g('heures_loguees'),'h:min:s → heures décimales'],
    ['heures_productives','Production par agent','Travail',g('heures_productives'),'h:min:s → heures décimales'],
    ['appels_traites','Production par agent','Nb. Argu.',g('appels_traites'),'Nombre argumenté (total)'],
    ['dmt_sec','Production par agent','Tps Argu.',g('dmt_sec'),'Temps argumenté moyen → secondes'],
    ['t_comm_h','Rapport détaillé','Traitement (Temps total)',g('t_comm_h'),'h:min:s → heures décimales'],
    ['t_attente_h','Rapport détaillé','Attente (Temps total)',g('t_attente_h'),'h:min:s → heures décimales'],
    ['t_acw_h','Rapport détaillé','Post-travail (Temps total)',g('t_acw_h'),'h:min:s → heures décimales'],
    ['Non alimentés par Hermès : fiches_traitees, ca_facture, masse_salariale.'],
    [],
    ['3. CONTRÔLES'],
    ...(m.notes.length?m.notes.map(n=>[n]):[['Tous les contrôles sont OK (présence, nombre d’agents, heures productives ≤ heures loguées, même plage de dates).']])
  ];
  const wsC=XLSX.utils.aoa_to_sheet(corr);
  wsC['!cols']=[{wch:34},{wch:24},{wch:28},{wch:16},{wch:34}];
  XLSX.utils.book_append_sheet(wb,wsC,'correspondance');
  if(m.sources&&m.sources.prod)XLSX.utils.book_append_sheet(wb,m.sources.prod.ws,'extraction_production');
  if(m.sources&&m.sources.det)XLSX.utils.book_append_sheet(wb,m.sources.det.ws,'extraction_detaille');
  const morceau=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9-]+/g,'_').replace(/^_|_$/g,'');
  const nom='modele-import-pilotage_HERMES_'+[g('periode'),g('filiale'),g('activite')].map(morceau).filter(Boolean).join('_')+'.xlsx';
  XLSX.writeFile(wb,nom);
}
