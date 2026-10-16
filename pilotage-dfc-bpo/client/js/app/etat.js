/* =======================================================================
   app/etat.js — État global de l'application
   Contenu    : FREQ (fréquences), state (vue, filtres), MOI (profil connecté), DB (lignes de production), droits()
   Dépend de  : —
   ======================================================================= */
/* =======================================================================
   Pilotage DFC × BPO — v0.4 (client / serveur)
   Frontend : état, sélection, rendus. Les autorisations sont appliquées
   par le serveur ; l'interface ne fait que refléter les droits reçus.
   ======================================================================= */
const FREQ={
  hebdo:{lab:'Hebdomadaire', usage:'revue de performance et staffing',
         dest:'BPO + DFC', periode:'Semaine en cours'},
  mensuel:{lab:'Mensuel', usage:'clôture, facturation, rentabilité',
           dest:'DFC + Direction', periode:'Mois en cours'}
};

const state={view:'dash', source:'prod', freq:'hebdo', niveau:'groupe', filiale:'all', activite:'all'};
let MOI=null;              // profil renvoyé par le serveur
let DB={rows:[]};          // données de PRODUCTION (base centrale, via l'API)
let CHARGE=false;

const NOTES={
  ADMIN:'Profil Administrateur — tous indicateurs, comptes, audit, sauvegarde.',
  DFC:'Profil DFC — vision financière complète, import des extractions.',
  DIRECTION:'Profil Direction — vision consolidée groupe, consultation.',
  BPO:'Profil BPO — indicateurs opérationnels. Les données financières sont réservées à la DFC.',
  CONTRIBUTEUR:'Profil Contributeur — import des extractions, consultation de tous les indicateurs opérationnels.'
};
const PERMISSIONS_UI_IMPORT=m=>!!(m&&m.permissions&&m.permissions.importer);
function droits(){
  if(!MOI)return{lab:'—',fin:false,imp:false,manage:false,aud:false,sauv:false,purge:false,note:''};
  const p=MOI.permissions||{};
  return{lab:MOI.roleLabel,fin:!!p.finance,imp:!!p.importer,manage:!!p.gerer_comptes,
         aud:!!p.audit,sauv:!!p.sauvegarde,purge:!!p.purger,filiale:MOI.filiale||'',
         note:(NOTES[MOI.role]||'')+(MOI.filiale&&PERMISSIONS_UI_IMPORT(MOI)?' Import limité à : '+MOI.filiale+'.':'')};
}
