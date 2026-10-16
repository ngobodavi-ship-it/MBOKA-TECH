# Architecture du code

## Principes

- **Aucune étape de compilation.** Les fichiers JavaScript sont des
  *scripts classiques* (pas de modules ES, pas de bundler). Ils sont chargés
  par `index.html` dans un ordre précis et partagent la portée globale :
  une fonction définie dans `donnees.js` est utilisable dans
  `vue-tableau-de-bord.js`.
- **Le serveur décide des droits.** L'interface se contente d'afficher ou de
  masquer selon les `permissions` reçues de `/api/etat` ou `/api/connexion`.
  En mode autonome, c'est le moteur local qui joue ce rôle.
- **Un seul point d'accès aux données :** la fonction `api(chemin, options)`.
  Tout le reste de l'application l'appelle sans savoir s'il y a un vrai
  serveur derrière.

```
 ┌──────────── client/js/app/*.js (vues, import, comptes…) ────────────┐
 │                      api('/donnees'), api('/connexion', …)          │
 └───────────────────────────────┬─────────────────────────────────────┘
                                 │
           mode 'serveur'        │        mode 'autonome'
     ┌───────────────────────────┴───────────────────────────┐
     ▼                                                       ▼
 js/lib/api.js                                    js/moteur-local/moteur-local.js
 fetch('/api' + chemin)                           routes simulées + localStorage
     │                                                       │
     ▼                                                       ▼
 backend à écrire (docs/API.md)              js/partage/regles-metier.js
                                             (droits, validation des imports)
```

## Ordre de chargement (`client/index.html`)

| # | Fichier | Rôle |
|---|---|---|
| 0 | `js/theme-init.js` (dans `<head>`) | applique le thème avant affichage |
| 1 | `js/config.js` | `PILOTAGE_CONFIG` : mode et version |
| 2 | `js/vendor/xlsx.full.min.js` | SheetJS 0.18.5 — objet global `XLSX` |
| 3 | `js/lib/graphiques.js` | graphiques SVG + formatage (`nf`, `mmss`, `fcfa`, `esc`) |
| 4 | `js/lib/api.js` | `api()`, `ErreurApi`, `bandeau()`, `telechargerSauvegarde()` |
| 5 | `js/lib/telechargement.js` | `telechargerRessource('modele' / 'guide')` |
| 6 | `js/partage/regles-metier.js` | `window.PilotageRegles` (règles métier pures) |
| 7 | `js/moteur-local/moteur-local.js` | remplace `api()` **uniquement** en mode autonome |
| 8 | `js/app/etat.js` … `js/app/demarrage.js` | l'application (16 fichiers, voir ci-dessous) |

`demarrage.js` doit rester **le dernier** : il interroge `/etat` et affiche
l'écran d'installation, de connexion, ou entre directement dans l'application.

## Fichiers de l'application (`client/js/app/`)

Chaque fichier commence par un en-tête qui indique son contenu et ses dépendances.

| Fichier | Responsabilité |
|---|---|
| `etat.js` | état global : `state` (vue, filtres), `MOI` (profil), `DB` (données), `droits()` |
| `donnees.js` | conversion API → modèle (`mapProd`), calcul des indicateurs (`agg`), périodes, sélection |
| `csv.js` | lecture CSV (`;` ou `,`), gabarit CSV d'exemple |
| `vue-tableau-de-bord.js` | 6 KPI, 4 graphiques, tableau de ventilation |
| `vue-regles.js` | fiches des règles de calcul |
| `navigation.js` | barre latérale, filtres, thème, changement de vue |
| `vue-donnees.js` | état de la base, connecteurs, journal des imports, corbeille |
| `import-extractions-brutes.js` | conversion des exports Hermès bruts (« Agents production report », « Agents report ») |
| `import-modele-excel.js` | lecture du classeur modèle multi-feuilles, recalcul, complétion |
| `import-assistant.js` | assistant : lecture → contrôle → prévisualisation → confirmation |
| `vue-utilisateurs.js` | gestion des comptes (administrateur) |
| `vue-audit.js` | journal d'audit (administrateur) |
| `authentification.js` | installation, connexion, récupération, mot de passe |
| `controles.js` | branchement des boutons et filtres, export CSV, impression |
| `wallboard.js` | affichage plein écran pour écran mural |
| `demarrage.js` | lancement de l'application |

## Styles (`client/css/`)

Chargés dans cet ordre : `variables.css` (couleurs, polices, tailles — à
modifier pour changer la charte), `mise-en-page.css`, `composants.css`,
`authentification.css`, `theme-sombre.css`, `wallboard.css`, `responsive.css`.

## Calcul des indicateurs (`donnees.js` → `agg`)

Pour un ensemble de lignes (période × filiale × activité) :

| Indicateur | Formule |
|---|---|
| Occupation | heures productives / heures loguées |
| DMT | Σ(DMT × appels) / Σ appels — moyenne pondérée par les appels |
| Appels / h | Σ appels / Σ heures productives des lignes ayant des appels |
| CA horaire | Σ CA facturé / Σ heures productives |
| Coût horaire | Σ masse salariale / Σ heures productives |
| Marge directe | CA facturé − masse salariale |

Les champs financiers (`ca_facture`, `masse_salariale`) ne sont jamais
envoyés aux profils sans la permission `finance` (BPO, Contributeur).

## Règles métier partagées (`js/partage/regles-metier.js`)

Ce fichier ne dépend ni du navigateur ni du stockage. Il fonctionne aussi
sous Node.js (`require('./regles-metier.js')`) : un backend Node peut donc le
réutiliser tel quel. Pour une autre technologie, il sert de spécification :

- `PERMISSIONS` : matrice rôle → droits ;
- `validerTableau(tableau, base)` : contrôles ligne à ligne d'un import
  (erreurs bloquantes, avertissements, doublons) ;
- `consoliderParAgent()` : regroupement automatique d'une extraction par agent ;
- `normPeriode()`, `parseNum()`, `CORRESPONDANCE` (alias de colonnes acceptés).

## Stockage en mode autonome

- `localStorage['pilotage-standalone-v1']` : toute la base (comptes, données,
  journaux, audit) en JSON ;
- `sessionStorage['pilotage-standalone-v1-session']` : session de l'onglet (8 h glissantes) ;
- `localStorage['pilotage-theme']` : thème choisi.

Mots de passe : SHA-256 salé (limite assumée de la version autonome — un
backend doit utiliser bcrypt, scrypt ou Argon2).
