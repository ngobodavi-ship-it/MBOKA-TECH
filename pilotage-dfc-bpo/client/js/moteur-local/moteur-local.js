/* =======================================================================
   Pilotage DFC × BPO — moteur LOCAL (mode « autonome »).
   Reproduit le contrat de l'API serveur (mêmes chemins, mêmes réponses,
   mêmes contrôles d'import et consolidation) sur le stockage du navigateur
   (localStorage pour la base, sessionStorage pour la session de l'onglet).
   Limites assumées : poste unique, protection côté navigateur seulement.

   Actif uniquement si PILOTAGE_CONFIG.mode === 'autonome' (voir js/config.js).
   En mode « serveur », ce fichier ne fait rien : js/lib/api.js parle à /api.
   Dépend de : js/partage/regles-metier.js, js/lib/api.js (ErreurApi, bandeau).
   ======================================================================= */
(function(){
'use strict';
if((window.PILOTAGE_CONFIG||{}).mode!=='autonome')return;
const CLE='pilotage-standalone-v1';
const R=window.PilotageRegles;
const {PERMISSIONS,ROLES_LABELS,genCodeRecup,normCode,perim,dansPerim,genMdpProvisoire,profil,filtrerFinance,resume}=R;
const VERSION=(window.PILOTAGE_CONFIG||{}).version||'0.4.0';
const maintenant=()=>new Date().toISOString();

/* ---------- magasin ---------- */
function magasinVide(){return {utilisateurs:[],donnees:[],journal_imports:[],journal_audit:[],seq:{u:1,d:1,ji:1,ja:1}}}
function lireMagasin(){
  try{const b=localStorage.getItem(CLE);return b?JSON.parse(b):magasinVide()}
  catch(e){return magasinVide()}
}
function ecrireMagasin(m){try{localStorage.setItem(CLE,JSON.stringify(m))}catch(e){}}
let M=lireMagasin();

function audit(utilisateur,action,objet,anc,nouv){
  const s=v=>v==null?null:(typeof v==='string'?v:JSON.stringify(v));
  M.journal_audit.push({id:M.seq.ja++,date:maintenant(),utilisateur:utilisateur||'systeme',
    action,objet:objet??null,ancienne_valeur:s(anc),nouvelle_valeur:s(nouv)});
  if(M.journal_audit.length>3000)M.journal_audit=M.journal_audit.slice(-3000);
}

/* ---------- mots de passe (SHA-256 salé — limite de la version autonome) ---------- */
/* SHA-256 en JS pur : secours quand crypto.subtle est indisponible. */
/* Implémentation vérifiée (vecteurs testés contre Node) : */
function sha256pur(message){
  const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const octets=new TextEncoder().encode(message);
  const lg=octets.length, bits=lg*8;
  const total=(((lg+8)>>6)+1)<<6;
  const buf=new Uint8Array(total);
  buf.set(octets);buf[lg]=0x80;
  const dv=new DataView(buf.buffer);
  dv.setUint32(total-4,bits>>>0);dv.setUint32(total-8,Math.floor(bits/4294967296));
  const w=new Int32Array(64);
  const rot=(v,c)=>(v>>>c)|(v<<(32-c));
  for(let i=0;i<total;i+=64){
    for(let j=0;j<16;j++)w[j]=dv.getInt32(i+j*4);
    for(let j=16;j<64;j++){
      const s0=rot(w[j-15],7)^rot(w[j-15],18)^(w[j-15]>>>3);
      const s1=rot(w[j-2],17)^rot(w[j-2],19)^(w[j-2]>>>10);
      w[j]=(w[j-16]+s0+w[j-7]+s1)|0;}
    let[a,b,c,d,e,f,g,h]=H;
    for(let j=0;j<64;j++){
      const S1=rot(e,6)^rot(e,11)^rot(e,25);
      const ch=(e&f)^(~e&g);
      const t1=(h+S1+ch+K[j]+w[j])|0;
      const S0=rot(a,2)^rot(a,13)^rot(a,22);
      const maj=(a&b)^(a&c)^(b&c);
      const t2=(S0+maj)|0;
      h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}
    H=[(H[0]+a)|0,(H[1]+b)|0,(H[2]+c)|0,(H[3]+d)|0,(H[4]+e)|0,(H[5]+f)|0,(H[6]+g)|0,(H[7]+h)|0];
  }
  return H.map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
}
async function sha256(t){
  if(crypto&&crypto.subtle&&crypto.subtle.digest){
    const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  return sha256pur(t);
}
const genSel=R.genJeton;
async function hacherMdp(mdp){const sel=genSel();return 'sha256:'+sel+':'+await sha256(sel+String(mdp))}
async function verifierMdp(mdp,stocke){
  try{const[,sel,h]=String(stocke).split(':');return (await sha256(sel+String(mdp)))===h}catch(e){return false}
}
/* ---------- session (onglet) + tentatives ---------- */
let TENTATIVES={};
function bloquee(l){const t=TENTATIVES[l];return t&&t.jusqua>Date.now()?Math.ceil((t.jusqua-Date.now())/60000):0}
function echec(l){const t=TENTATIVES[l]=TENTATIVES[l]||{n:0,jusqua:0};t.n++;
  if(t.n>=5){t.jusqua=Date.now()+15*60000;t.n=0;audit(l,'blocage_connexion','compte '+l,null,'15 min')}}
function lireSession(){
  try{const s=JSON.parse(sessionStorage.getItem(CLE+'-session'));
    if(!s||s.expire<Date.now())return null;
    const u=M.utilisateurs.find(x=>x.login===s.login&&x.actif);
    if(!u)return null;
    s.expire=Date.now()+8*3600000;sessionStorage.setItem(CLE+'-session',JSON.stringify(s));
    return u;
  }catch(e){return null}
}
function ouvrirSession(u){sessionStorage.setItem(CLE+'-session',JSON.stringify({login:u.login,expire:Date.now()+8*3600000}))}
function fermerSessionLocale(){sessionStorage.removeItem(CLE+'-session')}

/* ---------- recherches dans le magasin (injectées dans la validation partagée) ---------- */
const existante=(t,p,f,a)=>M.donnees.find(d=>d.actif&&d.type_periode===t&&d.periode===p
  &&d.filiale.toLowerCase()===f.toLowerCase()&&d.activite.toLowerCase()===a.toLowerCase());
function precedente(t,f,a,p){
  const c=M.donnees.filter(d=>d.actif&&d.type_periode===t&&d.periode<p
    &&d.filiale.toLowerCase()===f.toLowerCase()&&d.activite.toLowerCase()===a.toLowerCase())
    .sort((x,y)=>y.periode.localeCompare(x.periode));
  return c[0]||null;
}
const BASE_LOCALE={existante,precedente};
const validerTableau=t=>R.validerTableau(t,BASE_LOCALE);

/* ---------- routes locales ---------- */
const PREVIS=new Map();
class ErreurApiLocale extends Error{constructor(s,m){super(m);this.statut=s}}
const refuser=(s,m)=>{throw new ErreurApiLocale(s,m)};
function exigerAuth(){const u=lireSession();if(!u)refuser(401,'Session expirée — reconnectez-vous.');return u}
function exigerDroit(u,p){if(!PERMISSIONS[u.role][p])refuser(403,'Droits insuffisants pour cette action.')}
const validerLogin=l=>{if(!R.validerLogin(l))refuser(400,'Identifiant : 3 caractères minimum (lettres, chiffres, . _ -).')};

async function routeLocale(chemin,options){
  const methode=(options&&options.methode)||'GET';
  const corps=(options&&options.corps)||{};
  const entetes=(options&&options.entetes)||{};
  const [chemin0,q]=chemin.split('?');
  const query={};(q||'').split('&').forEach(p=>{const[k,v]=p.split('=');if(k)query[k]=decodeURIComponent(v||'')});
  M=lireMagasin();
  let m;
  try{
    if(chemin0==='/etat'&&methode==='GET'){
      const u=lireSession();
      return {setupRequis:M.utilisateurs.length===0,connecte:u?profil(u):null,recuperation:!!M.recuperation,
        application:'pilotage-dfc-bpo',version:VERSION+'-autonome'};
    }
    if(chemin0==='/installation'&&methode==='POST'){
      if(M.utilisateurs.length)refuser(403,"L'installation a déjà été effectuée.");
      const nom=String(corps.nom||'').trim(),login=String(corps.login||'').trim().toLowerCase();
      if(!nom||!login)refuser(400,"Renseignez le nom et l'identifiant.");
      validerLogin(login);
      if(String(corps.mot_de_passe||'').length<8)refuser(400,'Mot de passe : 8 caractères minimum.');
      const u={id:M.seq.u++,nom,login,mot_de_passe_hash:await hacherMdp(corps.mot_de_passe),
        role:'ADMIN',actif:1,provisoire:0,date_creation:maintenant(),derniere_connexion:maintenant()};
      M.utilisateurs.push(u);
      const code=genCodeRecup();M.recuperation={hash:await hacherMdp(normCode(code)),date:maintenant(),par:login};
      audit(login,'creation_utilisateur','utilisateur '+login,null,{role:'ADMIN',origine:'installation'});
      audit(login,'code_recuperation','code de récupération créé');
      audit(login,'connexion','compte '+login);ouvrirSession(u);
      return {connecte:profil(u,false),code_recuperation:code};
    }
    if(chemin0==='/recuperation'&&methode==='POST'){
      /* Mot de passe administrateur oublié : exige le code de récupération remis à l'installation.
         Le code est à usage unique : un nouveau est généré et affiché après utilisation. */
      if(!M.recuperation)refuser(409,"Aucun code de récupération n'existe sur ce poste. Demandez à un autre administrateur de réinitialiser votre mot de passe.");
      const min=bloquee('#recuperation');if(min)refuser(429,'Trop de tentatives — réessayez dans '+min+' min.');
      if(!await verifierMdp(normCode(corps.code),M.recuperation.hash)){
        echec('#recuperation');audit('poste','echec_recuperation','code de récupération invalide');refuser(401,'Code de récupération incorrect.');}
      const login=String(corps.login||'').trim().toLowerCase();
      const c=M.utilisateurs.find(x=>x.login===login&&x.role==='ADMIN');
      if(!c)refuser(404,'Aucun compte administrateur avec cet identifiant.');
      if(String(corps.nouveau||'').length<8)refuser(400,'Nouveau mot de passe : 8 caractères minimum.');
      c.mot_de_passe_hash=await hacherMdp(corps.nouveau);c.provisoire=0;c.actif=1;
      delete TENTATIVES[login];delete TENTATIVES['#recuperation'];
      const code=genCodeRecup();M.recuperation={hash:await hacherMdp(normCode(code)),date:maintenant(),par:login};
      audit(login,'recuperation_compte','compte '+login,null,'mot de passe redéfini avec le code de récupération ; nouveau code émis');
      return {ok:true,code_recuperation:code};
    }
    if(chemin0==='/administration/code-recuperation'&&methode==='POST'){
      const u=exigerAuth();exigerDroit(u,'gerer_comptes');
      const code=genCodeRecup();M.recuperation={hash:await hacherMdp(normCode(code)),date:maintenant(),par:u.login};
      audit(u.login,'code_recuperation','nouveau code de récupération (l\u2019ancien est invalidé)');
      return {code_recuperation:code};
    }
    if(chemin0==='/connexion'&&methode==='POST'){
      const login=String(corps.login||'').trim().toLowerCase();
      if(!login||!corps.mot_de_passe)refuser(400,'Identifiant et mot de passe requis.');
      const min=bloquee(login);if(min)refuser(429,'Trop de tentatives — compte bloqué encore '+min+' min.');
      const u=M.utilisateurs.find(x=>x.login===login);
      if(!u||!await verifierMdp(corps.mot_de_passe,u.mot_de_passe_hash)){
        echec(login);audit(login,'echec_connexion','compte '+login);refuser(401,'Identifiant ou mot de passe incorrect.');}
      if(!u.actif){audit(login,'echec_connexion','compte '+login,null,'compte désactivé');
        refuser(403,'Ce compte est désactivé — contactez un administrateur.');}
      delete TENTATIVES[login];u.derniere_connexion=maintenant();
      audit(login,'connexion','compte '+login);ouvrirSession(u);
      return {connecte:profil(u)};
    }
    if(chemin0==='/deconnexion'&&methode==='POST'){exigerAuth();fermerSessionLocale();return {ok:true}}
    if(chemin0==='/mot-de-passe'&&methode==='POST'){
      const u=exigerAuth();
      if(!await verifierMdp(corps.actuel||'',u.mot_de_passe_hash))refuser(400,'Mot de passe actuel incorrect.');
      if(String(corps.nouveau||'').length<8)refuser(400,'Nouveau mot de passe : 8 caractères minimum.');
      if(corps.nouveau===corps.actuel)refuser(400,"Choisissez un mot de passe différent de l'actuel.");
      u.mot_de_passe_hash=await hacherMdp(corps.nouveau);u.provisoire=0;
      audit(u.login,'changement_mdp','compte '+u.login);return {ok:true};
    }
    if(chemin0==='/utilisateurs'&&methode==='GET'){
      const u=exigerAuth();exigerDroit(u,'gerer_comptes');
      return {utilisateurs:M.utilisateurs.map(x=>({id:x.id,nom:x.nom,login:x.login,role:x.role,filiale:perim(x),
        actif:x.actif,provisoire:x.provisoire,date_creation:x.date_creation,derniere_connexion:x.derniere_connexion})),
        recuperation:M.recuperation?{date:M.recuperation.date,par:M.recuperation.par}:null};
    }
    if(chemin0==='/utilisateurs'&&methode==='POST'){
      const u=exigerAuth();exigerDroit(u,'gerer_comptes');
      const nom=String(corps.nom||'').trim(),login=String(corps.login||'').trim().toLowerCase();
      if(!nom||!login)refuser(400,"Renseignez le nom et l'identifiant.");
      validerLogin(login);
      if(!PERMISSIONS[corps.role])refuser(400,'Rôle inconnu.');
      if(M.utilisateurs.some(x=>x.login===login))refuser(409,'Cet identifiant existe déjà.');
      const fil=corps.role==='ADMIN'?'':String(corps.filiale||'').trim().replace(/\s+/g,' ').slice(0,60);
      const prov=genMdpProvisoire();
      M.utilisateurs.push({id:M.seq.u++,nom,login,mot_de_passe_hash:await hacherMdp(prov),
        role:corps.role,filiale:fil,actif:1,provisoire:1,date_creation:maintenant(),derniere_connexion:null});
      audit(u.login,'creation_utilisateur','utilisateur '+login,null,{role:corps.role,perimetre:fil||'Groupe'});
      return {login,mot_de_passe_provisoire:prov};
    }
    if((m=chemin0.match(/^\/utilisateurs\/(\d+)$/))&&methode==='PATCH'){
      const u=exigerAuth();exigerDroit(u,'gerer_comptes');
      const c=M.utilisateurs.find(x=>x.id===+m[1]);if(!c)refuser(404,'Utilisateur introuvable.');
      const admins=M.utilisateurs.filter(x=>x.role==='ADMIN'&&x.actif).length;
      const dernier=c.role==='ADMIN'&&c.actif&&admins<=1;
      if(corps.actif!==undefined){
        if(!corps.actif&&dernier)refuser(409,'Impossible de désactiver le dernier administrateur actif.');
        c.actif=corps.actif?1:0;
        if(!c.actif&&lireSession()&&lireSession().login===c.login)fermerSessionLocale();
        audit(u.login,c.actif?'reactivation_utilisateur':'desactivation_utilisateur','utilisateur '+c.login);}
      if(corps.role!==undefined){
        if(!PERMISSIONS[corps.role])refuser(400,'Rôle inconnu.');
        if(corps.role!=='ADMIN'&&dernier)refuser(409,'Impossible de retirer le rôle du dernier administrateur actif.');
        audit(u.login,'modification_utilisateur','utilisateur '+c.login,{role:c.role},{role:corps.role});
        c.role=corps.role;
        if(c.role==='ADMIN'&&perim(c)){audit(u.login,'modification_perimetre','utilisateur '+c.login,{perimetre:perim(c)},{perimetre:'Groupe'});c.filiale=''}}
      if(corps.filiale!==undefined){
        const fil=String(corps.filiale||'').trim().replace(/\s+/g,' ').slice(0,60);
        if(fil&&c.role==='ADMIN')refuser(400,'Un administrateur a toujours le périmètre Groupe.');
        if(fil!==perim(c)){audit(u.login,'modification_perimetre','utilisateur '+c.login,{perimetre:perim(c)||'Groupe'},{perimetre:fil||'Groupe'});c.filiale=fil}}
      return {ok:true};
    }
    if((m=chemin0.match(/^\/utilisateurs\/(\d+)\/reinitialiser$/))&&methode==='POST'){
      const u=exigerAuth();exigerDroit(u,'gerer_comptes');
      const c=M.utilisateurs.find(x=>x.id===+m[1]);if(!c)refuser(404,'Utilisateur introuvable.');
      const prov=genMdpProvisoire();
      c.mot_de_passe_hash=await hacherMdp(prov);c.provisoire=1;
      audit(u.login,'reinitialisation_mdp','utilisateur '+c.login);
      return {login:c.login,mot_de_passe_provisoire:prov};
    }
    if(chemin0==='/donnees'&&methode==='GET'){
      const u=exigerAuth();const p=PERMISSIONS[u.role];
      let l=M.donnees.filter(d=>d.actif);
      if(query.type==='hebdo'||query.type==='mensuel')l=l.filter(d=>d.type_periode===query.type);
      l=l.slice().sort((a,b)=>(a.type_periode+a.periode+a.filiale+a.activite).localeCompare(b.type_periode+b.periode+b.filiale+b.activite));
      return {lignes:l.map(d=>filtrerFinance({...d},p))};
    }
    if(chemin0==='/corbeille'&&methode==='GET'){
      const u=exigerAuth();exigerDroit(u,'importer');
      const l=M.donnees.filter(d=>!d.actif).sort((a,b)=>b.date_import.localeCompare(a.date_import)).slice(0,500);
      return {lignes:l.map(d=>filtrerFinance({...d},PERMISSIONS[u.role]))};
    }
    if((m=chemin0.match(/^\/corbeille\/(\d+)\/restaurer$/))&&methode==='POST'){
      const u=exigerAuth();exigerDroit(u,'importer');
      const d=M.donnees.find(x=>x.id===+m[1]);
      if(!d||d.actif)refuser(404,'Ligne introuvable dans la corbeille.');
      if(!dansPerim(u,d.filiale))refuser(403,'Filiale « '+d.filiale+' » hors de votre périmètre d\u2019import ('+perim(u)+').');
      if(existante(d.type_periode,d.periode,d.filiale,d.activite))
        refuser(409,'Une donnée active existe déjà pour cette clé — archivez-la d\u2019abord.');
      d.actif=1;
      audit(u.login,'restauration','donnée '+d.type_periode+' '+d.periode+' · '+d.filiale+' · '+d.activite,null,resume(d));
      return {ok:true};
    }
    if((m=chemin0.match(/^\/corbeille\/(\d+)$/))&&methode==='DELETE'){
      const u=exigerAuth();exigerDroit(u,'purger');
      if(entetes['X-Confirmation']!=='SUPPRIMER'&&entetes['x-confirmation']!=='SUPPRIMER')
        refuser(428,'Confirmation requise (en-tête X-Confirmation: SUPPRIMER).');
      const i=M.donnees.findIndex(x=>x.id===+m[1]&&!x.actif);
      if(i<0)refuser(404,'Ligne introuvable dans la corbeille.');
      const d=M.donnees[i];M.donnees.splice(i,1);
      audit(u.login,'purge','donnée '+d.type_periode+' '+d.periode+' · '+d.filiale+' · '+d.activite,resume(d),null);
      return {ok:true};
    }
    if(chemin0==='/donnees/archiver-tout'&&methode==='POST'){
      const u=exigerAuth();exigerDroit(u,'purger');
      if(corps.confirmation!=='ARCHIVER')refuser(428,'Confirmation requise (champ confirmation = ARCHIVER).');
      let n=0;M.donnees.forEach(d=>{if(d.actif){d.actif=0;n++}});
      audit(u.login,'suppression','toutes les données actives → corbeille',n+' lignes',null);
      return {ok:true,archivees:n};
    }
    if(chemin0==='/imports/previsualiser'&&methode==='POST'){
      const u=exigerAuth();exigerDroit(u,'importer');
      const tableau=corps.tableau;
      if(!Array.isArray(tableau))refuser(400,'Tableau de données manquant.');
      if(tableau.length>20000)refuser(413,'Fichier trop volumineux (20 000 lignes maximum).');
      let {lignes,erreurs,avertissements,doublons,consolidation}=validerTableau(tableau);
      if(perim(u)){
        const hors=lignes.filter(l=>!dansPerim(u,l.filiale));
        for(const l of hors)erreurs.push({ligne:l.no,motif:'Filiale « '+l.filiale+' » hors de votre périmètre d\u2019import ('+perim(u)+') — ligne refusée.'});
        lignes=lignes.filter(l=>dansPerim(u,l.filiale));
        const ok=new Set(lignes.map(l=>l.no));doublons=doublons.filter(d=>ok.has(d.ligne));
        erreurs.sort((a,b)=>(a.ligne||0)-(b.ligne||0));
      }
      let token=null;
      if(lignes.length){token=genSel();
        PREVIS.set(token,{utilisateur:u.login,fichier:String(corps.fichier||'fichier'),lignes,expire:Date.now()+15*60000});}
      return {token,
        resume:{valides:lignes.length,erreurs:erreurs.length,avertissements:avertissements.length,doublons:doublons.length},
        erreurs:erreurs.slice(0,100),avertissements:avertissements.slice(0,100),
        doublons:doublons.slice(0,100).map(d=>({cle:d.cle,ligne:d.ligne,existante:resume(d.existante),nouvelle:d.nouvelle})),
        apercu:lignes.slice(0,8),consolidation:consolidation||null};
    }
    if(chemin0==='/imports/confirmer'&&methode==='POST'){
      const u=exigerAuth();exigerDroit(u,'importer');
      for(const[k,v]of PREVIS)if(v.expire<Date.now())PREVIS.delete(k);
      const p=PREVIS.get(corps.token);
      if(!p||p.utilisateur!==u.login)refuser(410,'Prévisualisation expirée — relancez la lecture du fichier.');
      PREVIS.delete(corps.token);
      let integrees=0,remplacees=0,ignorees=0;
      for(const l of p.lignes){
        if(!dansPerim(u,l.filiale))continue;
        const ex=existante(l.type_periode,l.periode,l.filiale,l.activite);
        if(ex){if(!corps.remplacer){ignorees++;continue}
          ex.actif=0;
          audit(u.login,'remplacement','donnée '+l.type_periode+' '+l.periode+' · '+l.filiale+' · '+l.activite,resume(ex),resume(l));
          remplacees++;}
        else integrees++;
        M.donnees.push({id:M.seq.d++,type_periode:l.type_periode,periode:l.periode,filiale:l.filiale,activite:l.activite,
          agents:l.agents,heures_loguees:l.heures_loguees,heures_productives:l.heures_productives,
          appels_traites:l.appels_traites,fiches_traitees:l.fiches_traitees,dmt_sec:l.dmt_sec,
          ca_facture:l.ca_facture,masse_salariale:l.masse_salariale,
          t_comm_h:l.t_comm_h,t_attente_h:l.t_attente_h,t_acw_h:l.t_acw_h,
          actif:1,date_import:maintenant(),utilisateur_import:u.login});}
      M.journal_imports.unshift({id:M.seq.ji++,date:maintenant(),utilisateur:u.login,fichier:p.fichier,
        lignes_integrees:integrees,lignes_remplacees:remplacees,lignes_rejetees:0,statut:'valide',
        details:ignorees?ignorees+' doublon(s) conservé(s) tels quels':null});
      M.journal_imports=M.journal_imports.slice(0,50);
      audit(u.login,'import','fichier '+p.fichier,null,{integrees,remplacees,ignorees});
      return {integrees,remplacees,ignorees};
    }
    if(chemin0==='/imports/journaliser-refus'&&methode==='POST'){
      const u=exigerAuth();exigerDroit(u,'importer');
      M.journal_imports.unshift({id:M.seq.ji++,date:maintenant(),utilisateur:u.login,
        fichier:String(corps.fichier||'fichier'),lignes_integrees:0,lignes_remplacees:0,
        lignes_rejetees:Math.max(0,parseInt(corps.rejetees,10)||0),statut:'refuse',
        details:String(corps.details||'').slice(0,500)});
      M.journal_imports=M.journal_imports.slice(0,50);
      return {ok:true};
    }
    if(chemin0==='/imports/journal'&&methode==='GET'){exigerAuth();return {journal:M.journal_imports.slice(0,50)}}
    if(chemin0==='/audit'&&methode==='GET'){
      const u=exigerAuth();exigerDroit(u,'audit');
      const lim=Math.min(1000,Math.max(1,parseInt(query.limite,10)||200));
      return {evenements:M.journal_audit.slice(-lim).reverse()};
    }
    if(chemin0==='/connecteurs'&&methode==='GET'){exigerAuth();
      return {connecteurs:[
        {id:'hermes',nom:'Hermès (temps, appels, temps réel)',connecte:false,statut:'À brancher — nécessite la version client/serveur.'},
        {id:'wfm',nom:'WFM (staffing, heures loguées)',connecte:false,statut:'À brancher — nécessite la version client/serveur.'},
        {id:'finance',nom:'Finance / RH (CA, masse salariale)',connecte:false,statut:'À brancher — nécessite la version client/serveur.'}],
        note:'Version autonome : les données proviennent exclusivement des imports contrôlés sur ce poste.'};
    }
    if(chemin0==='/restauration'&&methode==='POST'){
      const u=exigerAuth();exigerDroit(u,'sauvegarde');
      if(corps.confirmation!=='RESTAURER')refuser(428,'Confirmation requise : tapez RESTAURER.');
      const s=corps.sauvegarde;
      if(!s||s.application!=='pilotage-dfc-bpo'||
         ![s.utilisateurs,s.donnees,s.journal_imports,s.journal_audit].every(Array.isArray))
        refuser(400,'Fichier de sauvegarde invalide ou incomplet.');
      const courant={...u};
      const recup=M.recuperation||null;
      M={recuperation:recup,utilisateurs:s.utilisateurs.map(x=>({...x})),donnees:s.donnees.map(x=>({...x})),
        journal_imports:s.journal_imports.map(x=>({...x})),journal_audit:s.journal_audit.map(x=>({...x})),
        seq:{u:Math.max(1,...s.utilisateurs.map(x=>x.id+1),1),d:Math.max(1,...s.donnees.map(x=>x.id+1),1),
             ji:Math.max(1,...s.journal_imports.map(x=>x.id+1),1),ja:Math.max(1,...s.journal_audit.map(x=>x.id+1),1)}};
      let present=M.utilisateurs.find(x=>x.login===courant.login);
      if(!present){present={...courant,id:M.seq.u++,role:'ADMIN',actif:1,provisoire:0};M.utilisateurs.push(present)}
      else if(!present.actif||present.role!=='ADMIN'){present.actif=1;present.role='ADMIN'}
      ouvrirSession(present);
      audit(u.login,'restauration_sauvegarde','sauvegarde du '+(s.date||'?'),null,
        {donnees:s.donnees.length,utilisateurs:s.utilisateurs.length});
      return {ok:true,donnees:s.donnees.length,utilisateurs:s.utilisateurs.length};
    }
    if(chemin0==='/administration/vider-tout'&&methode==='POST'){
      const u=exigerAuth();exigerDroit(u,'purger');
      if(corps.confirmation!=='VIDER')refuser(428,'Confirmation requise (champ confirmation = VIDER).');
      const moi=M.utilisateurs.find(x=>x.login===u.login);
      const nDonnees=M.donnees.length,nComptes=Math.max(0,M.utilisateurs.length-(moi?1:0));
      M={recuperation:M.recuperation||null,utilisateurs:moi?[{...moi}]:[],donnees:[],journal_imports:[],journal_audit:[],
        seq:{u:(moi?moi.id:0)+1,d:1,ji:1,ja:1}};
      audit(u.login,'reinitialisation_totale','vidage complet de la base',null,
        {donnees_supprimees:nDonnees,comptes_supprimes:nComptes});
      return {ok:true,donnees:nDonnees,comptes:nComptes};
    }
    refuser(404,'Route inconnue.');
  }finally{ecrireMagasin(M)}
}

/* ---------- exposition : même contrat que api.js ---------- */
window.api=async function(chemin,options){
  try{return await routeLocale(chemin,options)}
  catch(e){
    if(e instanceof ErreurApiLocale){
      if(e.statut===401&&!chemin.startsWith('/connexion')&&!chemin.startsWith('/etat')
        &&typeof onSessionPerdue==='function')onSessionPerdue();
      const err=new ErreurApi(e.statut,e.message);throw err;
    }
    throw e;
  }
};
window.telechargerSauvegarde=function(){
  const u=lireSession();if(!u||!PERMISSIONS[u.role].sauvegarde){bandeau('Droits insuffisants.',true);return}
  M=lireMagasin();
  const contenu={application:'pilotage-dfc-bpo',version_format:1,date:maintenant(),
    utilisateurs:M.utilisateurs,donnees:M.donnees,journal_imports:M.journal_imports,journal_audit:M.journal_audit};
  audit(u.login,'sauvegarde','export logique ('+M.donnees.length+' données, '+M.utilisateurs.length+' comptes)');
  ecrireMagasin(M);
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(contenu)],{type:'application/json'}));
  a.download='sauvegarde-pilotage-'+maintenant().slice(0,10)+'.json';
  a.click();URL.revokeObjectURL(a.href);
};
})();
