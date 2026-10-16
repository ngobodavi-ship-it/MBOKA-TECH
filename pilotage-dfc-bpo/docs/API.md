# Contrat d'API — backend du mode serveur

Ce document décrit tout ce que le client attend d'un serveur. Il est
indépendant de la technologie choisie (PHP/Laravel, Node.js, Java/Spring,
.NET, Python/Django…).

**Implémentation de référence :** `client/js/moteur-local/moteur-local.js`
(fonction `routeLocale`) code chaque route ci-dessous avec les contrôles et
messages exacts. En cas de doute, c'est elle qui fait foi. Les règles de
validation des imports sont dans `client/js/partage/regles-metier.js`.

## 1. Conventions générales

- Toutes les routes sont préfixées par **`/api`** et servies **sur le même
  domaine** que le client (le client appelle `fetch('/api' + chemin)`).
  Sinon, configurer un proxy inverse (voir `DEPLOIEMENT.md`).
- Requêtes et réponses en **JSON** (`Content-Type: application/json`, UTF-8).
- **Erreur :** code HTTP ≥ 400 et corps `{ "erreur": "Message lisible en français." }`.
  Le client affiche ce message tel quel.
- **Dates :** chaînes ISO 8601 UTC (`2026-10-16T08:37:12.345Z`).
- Booléens de base (`actif`, `provisoire`) : entiers `1` / `0`.

| Code | Usage |
|---|---|
| 400 | saisie invalide |
| 401 | non connecté / session expirée → le client renvoie vers la connexion |
| 403 | droits insuffisants, compte désactivé, filiale hors périmètre |
| 404 | ressource ou route inconnue |
| 409 | conflit (identifiant existant, dernier administrateur, clé déjà active) |
| 410 | prévisualisation d'import expirée |
| 413 | fichier trop volumineux (> 20 000 lignes) |
| 428 | confirmation manquante (mot à taper) |
| 429 | trop de tentatives |

## 2. Session et sécurité attendues

- Session par **cookie** `HttpOnly`, `Secure` (HTTPS), `SameSite=Strict`.
  Le client n'envoie aucun jeton lui-même : le navigateur transmet le cookie.
- Durée : **8 h glissantes** (prolongée à chaque requête authentifiée).
- **Anti-force brute :** 5 échecs sur un identifiant → blocage 15 min (429),
  avec événement d'audit `blocage_connexion`. Idem pour le code de récupération.
- **Mots de passe :** bcrypt / scrypt / Argon2, 8 caractères minimum.
  Une sauvegarde issue du mode autonome contient des empreintes
  `sha256:<sel>:<hex>` (= SHA-256(sel + mot de passe)) : les accepter à la
  connexion puis les ré-hacher avec l'algorithme du serveur.
- Les droits sont **toujours** contrôlés côté serveur ; ne jamais renvoyer
  `ca_facture` ni `masse_salariale` à un profil sans la permission `finance`.
- Identifiant (`login`) : minuscules, `^[a-z0-9._-]{3,}$`.

## 3. Rôles et permissions

| Rôle | finance | importer | corriger | gerer_comptes | audit | sauvegarde | purger |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `ADMIN` (Administrateur) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `DFC` | ✔ | ✔ | ✔ | | | | |
| `DIRECTION` | ✔ | | | | | | |
| `BPO` | | | | | | | |
| `CONTRIBUTEUR` | | ✔ | ✔ | | | | |

**Périmètre filiale :** chaque compte a un champ `filiale`. Vide = *Groupe*
(toutes filiales). Sinon, le compte ne peut importer / restaurer que des
lignes de cette filiale (comparaison insensible à la casse). Un `ADMIN` a
toujours le périmètre Groupe. La consultation n'est pas limitée par le périmètre.

## 4. Modèle de données

### Objet `profil` (utilisateur connecté)
```json
{ "nom": "Awa Diallo", "login": "awa.diallo", "role": "DFC", "roleLabel": "DFC",
  "filiale": "", "provisoire": false,
  "permissions": { "finance": true, "importer": true, "corriger": true,
                   "gerer_comptes": false, "audit": false, "sauvegarde": false, "purger": false } }
```
`provisoire: true` → le client impose le changement de mot de passe.

### Table `utilisateurs`
`id, nom, login (unique), mot_de_passe_hash, role, filiale ('' = Groupe), actif, provisoire, date_creation, derniere_connexion`

### Table `donnees` (une ligne consolidée par période × filiale × activité)
| Colonne | Type | Remarque |
|---|---|---|
| `id` | entier | |
| `type_periode` | `hebdo` \| `mensuel` | |
| `periode` | texte | `2026-S33` (hebdo) ou `2026-07` (mensuel) |
| `filiale`, `activite` | texte | |
| `agents` | nombre | effectif staffé |
| `heures_loguees`, `heures_productives` | nombre | productives ≤ loguées |
| `appels_traites`, `fiches_traitees` | nombre | |
| `dmt_sec` | nombre | durée moyenne de traitement en secondes |
| `ca_facture`, `masse_salariale` | nombre | FCFA — **champs financiers** |
| `t_comm_h`, `t_attente_h`, `t_acw_h` | nombre ou `null` | décomposition du temps (facultatif) |
| `actif` | 1 / 0 | 0 = en corbeille |
| `date_import`, `utilisateur_import` | texte | |

**Unicité :** au plus **une ligne active** par
(`type_periode`, `periode`, `filiale`, `activite`) — filiale et activité
comparées sans tenir compte de la casse.

### Tables de journalisation
- `journal_imports` : `id, date, utilisateur, fichier, lignes_integrees, lignes_remplacees, lignes_rejetees, statut ('valide'|'refuse'), details`
- `journal_audit` : `id, date, utilisateur, action, objet, ancienne_valeur, nouvelle_valeur` (valeurs : texte ou JSON sérialisé)
- `recuperation` (paramètre unique) : `hash` du code de récupération, `date`, `par`

Actions d'audit utilisées : `connexion`, `echec_connexion`, `blocage_connexion`,
`creation_utilisateur`, `modification_utilisateur`, `modification_perimetre`,
`desactivation_utilisateur`, `reactivation_utilisateur`, `reinitialisation_mdp`,
`changement_mdp`, `code_recuperation`, `echec_recuperation`, `recuperation_compte`,
`import`, `remplacement`, `restauration`, `purge`, `suppression`, `sauvegarde`,
`restauration_sauvegarde`, `reinitialisation_totale`.

## 5. Routes

Légende — **Auth** : `—` publique · `✔` connecté · sinon permission requise.

### 5.1 Démarrage et authentification

#### `GET /etat` — Auth —
```json
{ "setupRequis": false, "connecte": { …profil… } | null, "recuperation": true,
  "application": "pilotage-dfc-bpo", "version": "0.4.0" }
```
`setupRequis` = aucun utilisateur en base.

#### `POST /installation` — Auth — (uniquement si aucun utilisateur)
Corps : `{ "nom", "login", "mot_de_passe" }`
Crée le premier compte `ADMIN`, génère un **code de récupération**
(16 caractères `ABCDEFGHJKMNPQRSTUVWXYZ23456789` en 4 groupes : `XXXX-XXXX-XXXX-XXXX`),
stocke son empreinte, ouvre la session.
Réponse : `{ "connecte": profil, "code_recuperation": "ABCD-EFGH-JKMN-PQRS" }`
Erreurs : 403 déjà installé · 400 champs / login / mot de passe < 8.

#### `POST /connexion` — Auth —
Corps : `{ "login", "mot_de_passe" }` → `{ "connecte": profil }`, cookie de session.
Erreurs : 400 champs manquants · 401 identifiants incorrects · 403 compte désactivé · 429 bloqué.
Met à jour `derniere_connexion`. Audit `connexion` / `echec_connexion`.

#### `POST /deconnexion` — Auth ✔ → `{ "ok": true }`

#### `POST /mot-de-passe` — Auth ✔
Corps : `{ "actuel", "nouveau" }` → `{ "ok": true }`, `provisoire` passe à 0.
Erreurs 400 : actuel incorrect · nouveau < 8 · nouveau identique.

#### `POST /recuperation` — Auth — (mot de passe administrateur oublié)
Corps : `{ "code", "login", "nouveau" }`. Le code est normalisé (majuscules,
caractères non alphanumériques retirés) avant comparaison. Usage unique :
un **nouveau code** est généré et renvoyé.
Réponse : `{ "ok": true, "code_recuperation": "…" }`
Erreurs : 409 aucun code · 429 trop d'essais · 401 code faux · 404 pas d'ADMIN avec ce login · 400 mot de passe < 8.

#### `POST /administration/code-recuperation` — `gerer_comptes`
Génère un nouveau code (l'ancien devient invalide) → `{ "code_recuperation": "…" }`

### 5.2 Comptes — permission `gerer_comptes`

#### `GET /utilisateurs`
```json
{ "utilisateurs": [ { "id", "nom", "login", "role", "filiale", "actif", "provisoire",
                      "date_creation", "derniere_connexion" } ],
  "recuperation": { "date", "par" } | null }
```
(jamais l'empreinte du mot de passe)

#### `POST /utilisateurs`
Corps : `{ "nom", "login", "role", "filiale" }` — `filiale` ignorée pour un ADMIN, tronquée à 60 caractères.
Génère un mot de passe provisoire de 10 caractères (`provisoire = 1`).
Réponse : `{ "login", "mot_de_passe_provisoire" }` · Erreurs : 400 · 409 login existant.

#### `PATCH /utilisateurs/{id}`
Corps : un ou plusieurs de `{ "actif": bool, "role": "…", "filiale": "…" }` → `{ "ok": true }`
- interdit de désactiver ou de retirer le rôle ADMIN au **dernier ADMIN actif** (409) ;
- passer ADMIN remet le périmètre à Groupe ; filiale non vide sur un ADMIN → 400 ;
- désactiver un compte ferme ses sessions.

#### `POST /utilisateurs/{id}/reinitialiser`
Nouveau mot de passe provisoire → `{ "login", "mot_de_passe_provisoire" }`

### 5.3 Données

#### `GET /donnees?type=hebdo|mensuel` — Auth ✔
`{ "lignes": [ …donnees actives… ] }` triées par type, période, filiale, activité.
Sans `finance` : **retirer** `ca_facture` et `masse_salariale`.

#### `GET /corbeille` — `importer`
500 dernières lignes inactives (date d'import décroissante) → `{ "lignes": [...] }` (même filtrage financier).

#### `POST /corbeille/{id}/restaurer` — `importer`
→ `{ "ok": true }` · 404 · 403 hors périmètre · 409 une ligne active existe déjà pour la clé.

#### `DELETE /corbeille/{id}` — `purger`
En-tête obligatoire **`X-Confirmation: SUPPRIMER`** (sinon 428). Suppression définitive.

#### `POST /donnees/archiver-tout` — `purger`
Corps `{ "confirmation": "ARCHIVER" }` (sinon 428) → `{ "ok": true, "archivees": n }`

### 5.4 Imports (deux temps : prévisualiser puis confirmer)

Le navigateur lit le fichier (CSV, Excel, exports Hermès) et envoie un
**tableau de lignes** : la première ligne contient les en-têtes.

#### `POST /imports/previsualiser` — `importer`
Corps : `{ "fichier": "nom.xlsx", "tableau": [ ["type_periode","periode",…], ["hebdo","2026-S33",…], … ] }`
- 400 si `tableau` absent · 413 si > 20 000 lignes ;
- validation = `validerTableau()` de `regles-metier.js` (en-têtes, formats,
  doublons internes, valeurs négatives, productives > loguées, DMT dérivée,
  avertissements d'occupation / DMT / variation de CA > 50 %…) ;
- lignes hors périmètre filiale du compte → erreurs ;
- si au moins une ligne valide : générer un **jeton** et garder les lignes
  validées côté serveur **15 minutes**, liées à l'utilisateur.

Réponse :
```json
{ "token": "hex" | null,
  "resume": { "valides": 3, "erreurs": 0, "avertissements": 1, "doublons": 1 },
  "erreurs":        [ { "ligne": 4, "motif": "…" } ],          // 100 max
  "avertissements": [ { "ligne": 2, "motif": "…" } ],          // 100 max
  "doublons": [ { "cle": "hebdo 2026-S33 · Congo · Service Client", "ligne": 2,
                  "existante": {…}, "nouvelle": {…} } ],        // 100 max
  "apercu": [ …8 premières lignes validées… ],
  "consolidation": null | { "groupes": [...], "lignes_source": n, "ignorees": n } }
```
`consolidation` est rempli quand le fichier est une extraction *par agent* :
le client propose alors de la consolider puis renvoie le résultat.

#### `POST /imports/confirmer` — `importer`
Corps : `{ "token", "remplacer": bool }`
Pour chaque ligne : si une ligne active existe pour la clé → si `remplacer`,
l'ancienne passe en corbeille (audit `remplacement`), sinon ignorée.
Ajoute une entrée au journal des imports (`statut: 'valide'`).
Réponse : `{ "integrees", "remplacees", "ignorees" }` · 410 jeton inconnu / expiré / autre utilisateur.
**À faire dans une transaction.**

#### `POST /imports/journaliser-refus` — `importer`
Corps : `{ "fichier", "rejetees", "details" }` (details ≤ 500 car.) → `{ "ok": true }`

#### `GET /imports/journal` — Auth ✔
`{ "journal": [ …50 dernières entrées, plus récentes d'abord… ] }`

### 5.5 Administration

#### `GET /audit?limite=300` — `audit`
`{ "evenements": [...] }` — les `limite` plus récents (1 à 1000, défaut 200), plus récents d'abord.

#### `GET /connecteurs` — Auth ✔
```json
{ "connecteurs": [ { "id": "hermes",  "nom": "Hermès (temps, appels, temps réel)", "connecte": false, "statut": "…" },
                   { "id": "wfm",     "nom": "WFM (staffing, heures loguées)",       "connecte": false, "statut": "…" },
                   { "id": "finance", "nom": "Finance / RH (CA, masse salariale)",   "connecte": false, "statut": "…" } ],
  "note": "…" }
```

#### `GET /sauvegarde` — `sauvegarde`
Renvoie le fichier JSON (en-tête `Content-Disposition: attachment`) :
```json
{ "application": "pilotage-dfc-bpo", "version_format": 1, "date": "ISO",
  "utilisateurs": [...], "donnees": [...], "journal_imports": [...], "journal_audit": [...] }
```
Audit `sauvegarde`. *(Route spécifique au mode serveur : en mode autonome, le
fichier est produit directement dans le navigateur.)*

#### `POST /restauration` — `sauvegarde`
Corps : `{ "confirmation": "RESTAURER", "sauvegarde": {…objet ci-dessus…} }`
- 428 sans confirmation · 400 si `application` ≠ `pilotage-dfc-bpo` ou listes manquantes ;
- remplace **tout** le contenu (le code de récupération est conservé) ;
- l'utilisateur qui restaure reste connecté et redevient ADMIN actif ;
- **ferme toutes les autres sessions**.
Réponse : `{ "ok": true, "donnees": n, "utilisateurs": n }`

#### `POST /administration/vider-tout` — `purger`
Corps `{ "confirmation": "VIDER" }` (sinon 428). Supprime données, journaux et
tous les comptes **sauf celui de l'appelant**.
Réponse : `{ "ok": true, "donnees": n, "comptes": n }`

## 6. Activer le mode serveur côté client

1. Implémenter les routes ci-dessus sous `/api`.
2. Dans `client/js/config.js`, mettre `mode: 'serveur'` (ou faire générer
   ce fichier par le backend).
3. Vérifier : `GET /api/etat` doit répondre avant toute connexion.

Le reste du client ne change pas.

## 7. Recette conseillée

Rejouer chaque scénario dans les deux modes et comparer :
installation → code de récupération → import du gabarit CSV → tableau de bord →
création d'un compte BPO (vérifier que les montants sont masqués) →
compte Contributeur avec filiale (import hors périmètre refusé) → corbeille →
sauvegarde → restauration → audit.
