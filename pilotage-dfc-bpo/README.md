# Pilotage DFC × BPO — v0.4

Tableau de bord de pilotage opérationnel et financier des activités BPO
(DMT, appels/heure, fiches, CA horaire, staffing, masse salariale, marge),
avec import contrôlé des extractions Hermès / WFM / Finance, gestion des
comptes par rôle, journal d'audit, corbeille, sauvegarde/restauration
et mode wallboard plein écran.

Ce dossier remplace l'ancien fichier unique
`pilotage-dfc-bpo-standalone.html` (1,1 Mo). Le code a été découpé
en fichiers séparés **sans changer le comportement** : un test automatisé
compare l'ancien et le nouveau fichier sur le même scénario (installation,
import, tableau de bord, comptes, audit) et donne des résultats identiques.

## Démarrage rapide

Le client est un site **100 % statique** (HTML + CSS + JavaScript, sans
compilation, sans dépendance à installer).

```bash
cd client
python3 -m http.server 8080     # ou n'importe quel serveur web
# ouvrir http://localhost:8080
```

Au premier lancement, l'application demande de créer le compte
administrateur et remet un **code de récupération** à conserver.

## Deux modes de fonctionnement

| Mode | Réglage (`client/js/config.js`) | Données | Usage |
|---|---|---|---|
| **Autonome** (par défaut) | `mode: 'autonome'` | Dans le navigateur du poste (`localStorage`) | Un seul poste, aucun serveur à écrire |
| **Serveur** | `mode: 'serveur'` | Base centrale, via l'API `/api/...` | Multi-postes, sécurité côté serveur |

Le mode serveur demande d'écrire un backend. **Aucune technologie n'est
imposée** (PHP, Node.js, Java, .NET, Python…) : il suffit de respecter le
contrat décrit dans [`docs/API.md`](docs/API.md). Le moteur local
`client/js/moteur-local/moteur-local.js` sert d'**implémentation de
référence** : chaque route y est codée avec les mêmes contrôles et les mêmes
messages d'erreur que ceux attendus du serveur.

## Arborescence

```
pilotage-dfc-bpo/
├── client/                      ← le site à déployer
│   ├── index.html               structure HTML de toutes les vues
│   ├── css/                     styles, découpés par thème
│   ├── js/
│   │   ├── config.js            mode autonome / serveur
│   │   ├── theme-init.js        thème clair/sombre avant affichage
│   │   ├── vendor/              SheetJS 0.18.5 (lecture/écriture Excel)
│   │   ├── lib/                 graphiques SVG, accès API, téléchargements
│   │   ├── partage/             règles métier (droits, validation des imports)
│   │   ├── moteur-local/        API simulée dans le navigateur (mode autonome)
│   │   └── app/                 l'application, une responsabilité par fichier
│   └── assets/                  modèle Excel d'import + guide PDF
├── docs/
│   ├── ARCHITECTURE.md          organisation du code, ordre de chargement
│   ├── API.md                   contrat d'API pour écrire le backend
│   └── DEPLOIEMENT.md           hébergement, HTTPS, sauvegardes
└── outils/
    └── construire-monofichier.js  régénère la version « fichier unique »
```

## Régénérer la version fichier unique

Pour redistribuer l'application en un seul fichier HTML (comme avant) :

```bash
node outils/construire-monofichier.js
# → dist/pilotage-dfc-bpo-autonome.html
```

## Documentation

- [Architecture du code](docs/ARCHITECTURE.md)
- [Contrat d'API (backend)](docs/API.md)
- [Déploiement](docs/DEPLOIEMENT.md)
