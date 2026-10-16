/* =======================================================================
   Couche d'accès à l'API (mode « serveur »).
   · api(chemin, {methode, corps, entetes}) → JSON de la réponse
   · erreurs uniformes (ErreurApi : statut HTTP + message lisible)
   · expiration de session : appelle onSessionPerdue() sur un 401
   En mode « autonome », js/moteur-local/moteur-local.js remplace window.api
   par un moteur qui respecte exactement le même contrat.
   ======================================================================= */
async function api(chemin, options = {}) {
  const rep = await fetch('/api' + chemin, {
    method: options.methode || 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.entetes || {}) },
    body: options.corps === undefined ? undefined : JSON.stringify(options.corps)
  });
  let json = null;
  try { json = await rep.json(); } catch (e) {}
  if (rep.status === 401 && !chemin.startsWith('/connexion') && !chemin.startsWith('/etat')) {
    if (typeof onSessionPerdue === 'function') onSessionPerdue();
    throw new ErreurApi(401, (json && json.erreur) || 'Session expirée.');
  }
  if (!rep.ok) throw new ErreurApi(rep.status, (json && json.erreur) || 'Erreur du serveur.');
  return json;
}
class ErreurApi extends Error {
  constructor(statut, message) { super(message); this.statut = statut; }
}

/* Sauvegarde logique complète (ADMIN) — le serveur renvoie le fichier JSON.
   Redéfinie par le moteur local en mode « autonome ». */
async function telechargerSauvegarde() {
  try {
    const rep = await fetch('/api/sauvegarde', { credentials: 'same-origin' });
    if (!rep.ok) {
      let msg = 'Sauvegarde impossible.';
      try { msg = (await rep.json()).erreur || msg; } catch (e) {}
      bandeau(msg, true);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await rep.blob());
    a.download = 'sauvegarde-pilotage-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    bandeau('Serveur injoignable — sauvegarde impossible.', true);
  }
}

// Bandeau de notification (succès / erreur)
let bandeauTimer = null;
function bandeau(message, erreur = false) {
  let el = document.getElementById('bandeau');
  if (!el) { el = document.createElement('div'); el.id = 'bandeau'; document.body.appendChild(el); }
  el.className = 'bandeau' + (erreur ? ' err' : '');
  el.textContent = message;
  el.style.display = '';
  clearTimeout(bandeauTimer);
  bandeauTimer = setTimeout(() => { el.style.display = 'none'; }, erreur ? 7000 : 4200);
}
