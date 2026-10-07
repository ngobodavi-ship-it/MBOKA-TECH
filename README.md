# MbokaTech — Connectez. Collaborez. Réussissez.

Application de visioconférence avec assistant IA (transcription, enregistrement et compte rendu automatiques).
Elle s'appuie sur Firebase (Auth, Firestore, Storage), PeerJS (WebRTC pair à pair) et Gemini.

## Structure

```
index.html          pages et fenêtres (accueil, préparation, réunion)
css/app.css         styles (thème clair / sombre)
js/config.js        ⚙️ clés et services : Firebase, Gemini, OpenAI, relais vidéo TURN
js/app.js           cœur : connexion, réunions, vidéo WebRTC, chat, transcription, compte rendu, exports
js/features.js      préparation, arrière-plans, mises en page, sous-titres, sondages, tableau blanc, salles…
js/assistant.js     automatisation IA, fin de réunion, présence, co-organisateurs, comptes rendus, accueil
js/collab.js        statut de présence, contacts, appels directs, discussions, connexion Google, récurrence, PWA
sw.js, manifest.webmanifest, icons/   application installable (téléphone, ordinateur)
js/main.js          démarrage
firestore.rules     règles de sécurité Firestore · storage.rules : règles Storage
```

Pour changer de projet Firebase ou ajouter un relais TURN, modifiez seulement `js/config.js`.

## Fonctionnalités

| Domaine | Fonctionnalités |
|---|---|
| Avant la réunion | Écran de préparation (aperçu caméra, vumètre micro, choix caméra/micro/haut-parleur), planification avec date et durée, ajout à Google Agenda, fichier `.ics` (Outlook, Apple), lien d'invitation, WhatsApp, e-mail |
| Audio / vidéo | Micro, caméra, suppression du bruit, effet miroir, flou d'arrière-plan et fonds virtuels (MediaPipe, calcul sur l'appareil), import d'une image de fond, repli sans caméra ni micro |
| Affichage | Mosaïque, orateur actif, épingler (double-clic), mise en avant par l'organisateur, plein écran, image dans l'image, masquer sa vidéo, indicateur de qualité réseau |
| Partage | Partage d'écran (avec le son de l'onglet), mode présentation, tableau blanc collaboratif (couleurs, gomme, annuler, export PNG) |
| Échanges | Chat public et privé, emojis, fichiers (25 Mo), liens cliquables, messages non lus, main levée, réactions, sons de notification |
| Activités | Sondages (anonymes ou nominatifs), questions-réponses avec votes, notes partagées |
| Organisateur | Salle d'attente, verrouillage, autoriser ou non le chat, le partage, la réactivation des micros et l'enregistrement ; couper tous les micros, demander d'activer un micro, baisser toutes les mains, expulser, salles de sous-commission (minuteur, annonces), terminer pour tous |
| Enregistrement | Vidéo de la réunion (mosaïque + audio de tous) téléchargée en `.webm`, badge visible par tous |
| IA | Transcription en direct, sous-titres avec traduction (Gemini), compte rendu (résumé, décisions, actions, points clés) en PDF ou Word, assistant qui répond aux questions sur la réunion (rattrapage, actions, e-mail de suivi) |
| Assistant automatique | Transcription lancée dès l'entrée de l'organisateur, enregistrement automatique (option), compte rendu rédigé par l'IA à la fin de la réunion, récapitulatif de fin (durée, participants, interventions) |
| Comptes rendus | Espace « Comptes rendus » sur l'accueil : lecture, PDF, Word, e-mail de suivi prêt à envoyer, transcription complète |
| Présence | Heure d'arrivée, de départ et durée par participant, export CSV (Excel) |
| Rôles | Co-organisateurs nommés en cours de réunion (mêmes droits que l'organisateur) |
| Accueil | Prochaine réunion avec compte à rebours, réunions organisées et rejointes, recherche |
| Communication (comme Teams) | Contacts avec statut (Disponible, En réunion, Occupé, Ne pas déranger, Absent), appels vidéo directs avec sonnerie (accepter / refuser), discussions permanentes 1:1 et en groupe avec non-lus, lancement d'une réunion depuis une discussion |
| Compte | Connexion Google, mot de passe oublié, nom modifiable |
| Agenda | Réunions récurrentes (quotidiennes, jours ouvrés, hebdomadaires, mensuelles) avec Google Agenda et `.ics` |
| Application | Installable sur téléphone et ordinateur (PWA), notifications du navigateur pour les appels et messages |
| Confort | Raccourcis clavier (`Ctrl+D`, `Ctrl+E`, Espace pour parler, `?`), mode sombre, préférences mémorisées |

## Données Firestore utilisées

```
meetings/{id}                 titre, organisateur, settings{…}, notes, scheduledAt,
                              transcriptionActive, recordingActive, spotlightPeerId, coHostIds, attendeeIds,
                              breakout{active, rooms, assignments, endsAt, broadcast}, endedAt
meetings/{id}/participants    présence (heartbeat), micro, caméra, main levée
meetings/{id}/messages        chat (champ `to` pour les messages privés)
meetings/{id}/transcript      transcription collective
meetings/{id}/commands        commandes de l'organisateur
meetings/{id}/reactions       réactions emoji
meetings/{id}/waiting         salle d'attente
meetings/{id}/polls           sondages
meetings/{id}/questions       questions-réponses
meetings/{id}/whiteboard      traits du tableau blanc
meetings/{id}/attendance      présence (arrivée, départ, durée)
users/{uid}                   profil et statut de présence
calls/{id}                    appels directs (sonnerie, accepté, refusé, manqué)
conversations/{id}/messages   discussions permanentes
reports/{id}                  comptes rendus IA
Storage : audio-recordings/, chat-files/
```

### Configuration Firebase (obligatoire)

1. **Règles Firestore** : console Firebase › *Firestore Database* › *Règles*. Remplacez tout le contenu par
   celui du fichier [`firestore.rules`](firestore.rules), puis cliquez sur **Publier**.
2. **Règles Storage** (fichiers du chat, audio) : console Firebase › *Storage* › *Règles*. Collez
   [`storage.rules`](storage.rules), puis cliquez sur **Publier**.
3. **Invités** : *Authentication* › *Sign-in method* › activez **Anonyme**.

Sans ces règles, l'application affiche « Firebase refuse l'accès… ».

## Limites connues

- **Sécurité** : la clé Gemini est visible dans le code source. Il faut la faire passer par un serveur
  (par exemple une Cloud Function). Les messages privés ne sont masqués que dans l'interface :
  seules des règles Firestore peuvent les protéger réellement.
- **Taille des réunions** : en pair à pair, chaque participant envoie son flux à tous les autres.
  Au-delà de 6 à 8 personnes, il faut un serveur média (SFU : LiveKit, mediasoup, Jitsi).
- **Sous-titres et transcription** : ils reposent sur la reconnaissance vocale du navigateur (Chrome, Edge).
- **Vidéo entre réseaux différents** (4G / Wi-Fi d'entreprise) : un relais TURN est nécessaire,
  à renseigner dans `TURN_CONFIG` (`js/config.js`, compte gratuit chez Metered par exemple).
- **Fonds virtuels** : sur un appareil trop lent, l'effet se désactive automatiquement.
- **Notes partagées** : la dernière modification l'emporte. Deux personnes qui écrivent en même temps peuvent s'écraser.

## Déploiement

Hébergez le dossier complet (`index.html`, `css/`, `js/`, `logo-mbokatech.png`) en HTTPS
(GitHub Pages, Firebase Hosting, Netlify).
La caméra et le micro ne fonctionnent pas en `file://`.
