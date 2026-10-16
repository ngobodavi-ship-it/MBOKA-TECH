/* =======================================================================
   Configuration du client.
   mode : 'autonome' → moteur local dans le navigateur (aucun serveur requis,
                       données dans le localStorage du poste) ;
          'serveur'  → appels HTTP vers /api (base centrale multi-postes).
   Pour passer en mode serveur : mettre mode: 'serveur' ici (ou faire servir
   ce fichier par le backend) une fois l'API /api implémentée
   (contrat complet : docs/API.md).
   ======================================================================= */
window.PILOTAGE_CONFIG = {
  mode: 'autonome',
  version: '0.4.0'
};
/* Le mode est reflété sur <html data-mode="…"> : les textes propres à un mode
   portent la classe .si-autonome ou .si-serveur (voir css/mise-en-page.css). */
document.documentElement.setAttribute('data-mode', window.PILOTAGE_CONFIG.mode);
