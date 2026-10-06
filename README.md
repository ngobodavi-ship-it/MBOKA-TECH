# MbokaTech — Connectez. Collaborez. Réussissez.

Application de visioconférence avec compte rendu IA, en **un seul fichier** (`index.html`).
Elle s'appuie sur Firebase (Auth, Firestore, Storage), PeerJS (WebRTC pair à pair) et Gemini.

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
| Confort | Raccourcis clavier (`Ctrl+D`, `Ctrl+E`, Espace pour parler, `?`), mode sombre, préférences mémorisées |

## Données Firestore utilisées

```
meetings/{id}                 titre, organisateur, settings{…}, notes, scheduledAt,
                              transcriptionActive, recordingActive, spotlightPeerId,
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
- **Fonds virtuels** : sur un appareil trop lent, l'effet se désactive automatiquement.
- **Notes partagées** : la dernière modification l'emporte. Deux personnes qui écrivent en même temps peuvent s'écraser.

## Déploiement

Hébergez `index.html` et `logo-mbokatech.png` en HTTPS (GitHub Pages, Firebase Hosting, Netlify).
La caméra et le micro ne fonctionnent pas en `file://`.
