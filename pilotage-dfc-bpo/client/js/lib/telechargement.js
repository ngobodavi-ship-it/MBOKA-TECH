/* =======================================================================
   Ressources téléchargeables (modèle Excel, guide PDF).
   Les fichiers sont servis depuis client/assets/. Le script de construction
   « monofichier » (outils/construire-monofichier.js) remplace ces URL par
   des data-URI pour que la version autonome reste un seul fichier HTML.
   ======================================================================= */
const RESSOURCES = {
  modele: { url: 'assets/modele-import-pilotage.xlsx', nom: 'modele-import-pilotage.xlsx' },
  guide:  { url: 'assets/guide-remplissage-import.pdf', nom: 'guide-remplissage-import.pdf' }
};
function telechargerRessource(id) {
  const r = RESSOURCES[id];
  if (!r) return;
  const a = document.createElement('a');
  a.href = r.url;
  a.download = r.nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
