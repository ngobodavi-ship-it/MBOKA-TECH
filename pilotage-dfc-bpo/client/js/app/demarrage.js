/* =======================================================================
   app/demarrage.js — Démarrage
   Contenu    : GET /etat → écran d'installation, de connexion, ou entrée directe
   Dépend de  : chargé en DERNIER
   ======================================================================= */
/* ---------- initialisation ---------- */
renderRules();
(async()=>{
  try{
    const e=await api('/etat');
    if(e.setupRequis)showAuth('setup');
    else if(e.connecte)await enterApp(e.connecte);
    else showAuth('login');
  }catch(err){
    showAuth('login',(window.PILOTAGE_CONFIG||{}).mode==='serveur'
      ?'Serveur injoignable — vérifiez votre connexion puis rechargez la page.'
      :'Erreur de démarrage du moteur local.');
  }
})();
