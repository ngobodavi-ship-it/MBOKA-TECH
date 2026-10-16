/* =======================================================================
   app/vue-regles.js — Vue « Règles de calcul »
   Contenu    : RULES (définition des 6 indicateurs), renderRules()
   Dépend de  : —
   ======================================================================= */
/* =======================================================================
   Rendu — vue Règles
   ======================================================================= */
const RULES=[
  {n:1,name:'DMT',formule:'(temps de communication + attente + post-appel) / appels traités',meta:'Source : Hermès · consolidation en moyenne pondérée par les appels',valid:true},
  {n:2,name:'Appels traités / h',formule:'appels traités / heures productives des activités d\'appels (hors Back Office)',meta:'Source : Hermès + WFM · proposition v0.2',valid:false},
  {n:3,name:'Fiches traitées',formule:'somme des fiches clôturées Back Office sur la période',meta:'Source : Hermès (file BO) · proposition v0.2 — préciser le statut « clôturée »',valid:false},
  {n:4,name:'CA horaire',formule:'CA facturé / heures productives',meta:'Source : Finance · règle validée au cadrage',valid:true},
  {n:5,name:'Agents staffés',formule:'effectif distinct logué au moins une fois sur la période',meta:'Source : WFM · proposition v0.2 — alternative : ETP moyen planifié',valid:false},
  {n:6,name:'Masse salariale directe',formule:'salaires bruts + charges des agents affectés à l\'activité, hors encadrement et fonctions support',meta:'Source : RH / Finance · proposition v0.2 — périmètre des primes à arbitrer',valid:false}
];
function renderRules(){
  document.getElementById('rulesGrid').innerHTML=RULES.map(r=>
    `<div class="rule-card">
      <span class="idx">${String(r.n).padStart(2,'0')}</span>
      <h4>${r.name}</h4>
      <div class="formula">${r.formule}</div>
      <div class="meta">${r.meta}</div>
      <div class="badges">${r.valid?'<span class="valid-b">règle validée</span>':'<span class="todo">proposition à valider DFC</span>'}</div>
    </div>`).join('');
}
