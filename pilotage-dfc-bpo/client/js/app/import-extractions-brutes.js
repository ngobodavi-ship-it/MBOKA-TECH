/* =======================================================================
   app/import-extractions-brutes.js — Import — extractions Hermès brutes
   Contenu    : convertirRapportBrut() : « Agents production report » et « Agents report » → tableau par agent
   Dépend de  : partage/regles-metier.js (consolidation côté moteur)
   ======================================================================= */
/* ---------- lecture des extractions BRUTES (exports Hermès non consolidés) ----------
   Reconnaît deux formats d'export brut et les convertit automatiquement en tableau
   « extraction par agent » (une ligne par personne), que le pipeline de consolidation
   existant (validerTableau → consoliderParAgent → renderConsolidation) sait déjà traiter.
   1) « Agents production report » : volumes (appels, présence, travail, temps par argu.)
   2) « Agents report »            : répartition du temps par agent (attente, traitement,
      appel entrant, post-travail, pauses…) — alimente t_comm_h / t_attente_h / t_acw_h. */
function tempsEnHeures(s){
  const m=/^(\d+)h(\d{2})'(\d{2})$/.exec(String(s||'').trim());
  if(!m)return 0;
  return (+m[1])+(+m[2])/60+(+m[3])/3600;
}
function tempsEnSecondes(s){
  const m=/^(\d+)h(\d{2})'(\d{2})$/.exec(String(s||'').trim());
  if(!m)return 0;
  return (+m[1])*3600+(+m[2])*60+(+m[3]);
}
function numBrut(v){
  /* Ces exports bruts utilisent la virgule comme séparateur de milliers et le point
     comme séparateur décimal (ex. « 1,024 » = 1024) — à ne pas confondre avec le
     gabarit consolidé (français) qui utilise la virgule comme décimale. */
  const n=parseFloat(String(v??'').replace(/[\u00A0\s]/g,'').replace(/,/g,''));
  return Number.isFinite(n)?n:NaN;
}
function isoSemaine(d){
  const dt=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  const jour=(dt.getUTCDay()+6)%7;
  dt.setUTCDate(dt.getUTCDate()-jour+3);
  const jeudi1=new Date(Date.UTC(dt.getUTCFullYear(),0,4));
  const ecart=dt-jeudi1;
  const semaine=1+Math.round(ecart/(7*24*3600*1000));
  return {annee:dt.getUTCFullYear(),semaine};
}
function periodeDepuisPlage(tableau){
  for(let i=0;i<Math.min(20,tableau.length);i++){
    for(const cell of (tableau[i]||[])){
      const m=/Du\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+au\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(String(cell??''));
      if(m){
        const debut=new Date(+m[3],+m[2]-1,+m[1]);
        const fin=new Date(+m[6],+m[5]-1,+m[4]);
        const jours=Math.round((fin-debut)/86400000);
        if(jours<=8){
          const {annee,semaine}=isoSemaine(debut);
          return {type_periode:'hebdo',periode:annee+'-S'+String(semaine).padStart(2,'0')};
        }
        return {type_periode:'mensuel',periode:debut.getFullYear()+'-'+String(debut.getMonth()+1).padStart(2,'0')};
      }
    }
  }
  return null;
}
function convertirRapportBrut(tableau){
  if(!Array.isArray(tableau)||tableau.length<5)return null;
  const texte=v=>String(v??'').trim();
  const contientTitre=t=>tableau.slice(0,6).some(r=>(r||[]).some(c=>texte(c).toLowerCase()===t));
  const periode=periodeDepuisPlage(tableau);
  if(!periode)return null;

  /* Format 1 : « Agents production report » — une ligne de volumes par agent */
  if(contientTitre('agents production report')){
    let iEnt=-1;
    for(let i=0;i<tableau.length;i++){if(texte((tableau[i]||[])[0])==='Agents'){iEnt=i;break}}
    if(iEnt<0)return null;
    const ent=tableau[iEnt].map(texte);
    const idx=n=>ent.indexOf(n);
    const iAppels=idx('Appels'), iTpsArgu=idx('Tps Argu.'), iTravail=idx('Travail'), iPresence=idx('Présence');
    if(iAppels<0||iTravail<0||iPresence<0)return null;
    const ENT=['type_periode','periode','filiale','activite','agents','heures_loguees','heures_productives',
      'appels_traites','fiches_traitees','dmt_sec'];
    const lignes=[];
    for(let i=iEnt+1;i<tableau.length;i++){
      const r=tableau[i]||[];
      const nom=texte(r[0]);
      if(!nom||nom==='Résumé')continue;
      const appels=numBrut(r[iAppels]);
      if(!Number.isFinite(appels))continue;
      const presence=tempsEnHeures(r[iPresence]), travail=tempsEnHeures(r[iTravail]);
      const dmt=iTpsArgu>=0?tempsEnSecondes(r[iTpsArgu]):0;
      lignes.push([periode.type_periode,periode.periode,'','',nom,
        String(Math.round(presence*100)/100),String(Math.round(Math.min(travail,presence)*100)/100),
        String(appels),'0',dmt?String(dmt):'']);
    }
    return lignes.length?[ENT,...lignes]:null;
  }

  /* Format 2 : « Agents report » — répartition du temps par activité, par agent */
  if(contientTitre('agents report')){
    const ENT=['type_periode','periode','filiale','activite','agents','heures_loguees','heures_productives',
      'appels_traites','fiches_traitees','dmt_sec','t_comm_h','t_attente_h','t_acw_h'];
    const lignes=[];
    let i=0;
    while(i<tableau.length){
      const r=tableau[i]||[];
      const c0=texte(r[0]);
      const mAgent=/^Agent\s+(.+)$/.exec(c0);
      if(mAgent){
        const nom=mAgent[1];
        let presence=0;
        for(const c of r){const m=/Temps total de présence\s*:\s*(\d+h\d{2}'\d{2})/.exec(texte(c));if(m){presence=tempsEnHeures(m[1]);break}}
        let j=i+1,tAttente=0,tComm=0,tAcw=0,tPause=0,appels=0,dmtSec=0;
        while(j<tableau.length&&!/^Agent\s+/.test(texte((tableau[j]||[])[0]))&&texte((tableau[j]||[])[0])!=='Résumé'){
          const rr=tableau[j]||[];
          const cat=texte(rr[1]);
          if(cat){
            const occ=numBrut(rr[4]);
            const total=tempsEnHeures(rr[6]);
            if(cat.toLowerCase().includes('pause'))tPause+=total;
            else if(cat==='Attente')tAttente+=total;
            else if(cat==='Traitement')tComm+=total;
            else if(cat==='Appel entrant'){if(Number.isFinite(occ))appels+=occ;dmtSec=tempsEnSecondes(rr[8]);}
            else if(cat==='Post-travail')tAcw+=total;
          }
          j++;
        }
        const productives=Math.max(0,presence-tPause);
        lignes.push([periode.type_periode,periode.periode,'','',nom,
          String(Math.round(presence*100)/100),String(Math.round(productives*100)/100),
          String(appels),'0',dmtSec?String(dmtSec):'',
          String(Math.round(tComm*100)/100),String(Math.round(tAttente*100)/100),String(Math.round(tAcw*100)/100)]);
        i=j;
      }else i++;
    }
    return lignes.length?[ENT,...lignes]:null;
  }
  return null;
}
