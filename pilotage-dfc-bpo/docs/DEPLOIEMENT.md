# Déploiement

## 1. Ce qu'il faut publier

Le dossier **`client/`** uniquement. C'est un site statique : il n'y a ni
compilation ni `npm install`. Tout serveur web convient.

Pré-requis côté postes : navigateur récent (Chrome, Edge, Firefox, Safari).
Les polices IBM Plex sont chargées depuis Google Fonts ; sans Internet,
l'application utilise la police système (aucune autre ressource externe).

## 2. Mode autonome (aucun backend)

Copier `client/` sur le serveur web, ouvrir `index.html`. Chaque navigateur a
**sa propre base** (stockée sur le poste) : convient pour un poste unique.
Penser aux sauvegardes JSON régulières (onglet Données → Sauvegarder).

Le site fonctionne aussi en ouvrant directement `client/index.html` depuis
le disque, ou sous forme de fichier unique (`node outils/construire-monofichier.js`).

### Exemples d'hébergement

**Nginx**
```nginx
server {
  listen 443 ssl;
  server_name pilotage.exemple.com;
  root /var/www/pilotage-dfc-bpo/client;
  index index.html;
  add_header X-Content-Type-Options nosniff;
  add_header X-Frame-Options DENY;
  add_header Referrer-Policy same-origin;
  location ~* \.(js|css|xlsx|pdf)$ { add_header Cache-Control "no-cache"; }
}
```

**Apache** : copier `client/` dans le `DocumentRoot` (aucune réécriture d'URL nécessaire).

**IIS** : créer un site pointant sur `client/` ; vérifier que les types MIME
`.xlsx` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
et `.pdf` sont déclarés.

**Firebase Hosting / Netlify / GitHub Pages** : publier `client/` comme
répertoire public (Firebase : `"hosting": { "public": "client" }`).

> `Cache-Control: no-cache` sur les fichiers JS/CSS évite qu'un poste garde
> une ancienne version après une mise à jour.

## 3. Mode serveur (multi-postes)

1. L'équipe choisit sa technologie et implémente l'API décrite dans
   [`API.md`](API.md).
2. Le client et l'API doivent être servis **sur le même domaine**, l'API sous
   `/api`. Si le backend tourne sur un autre port / une autre machine, utiliser
   un proxy inverse :
   ```nginx
   location /api/ {
     proxy_pass http://127.0.0.1:3000/api/;
     proxy_set_header Host $host;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_set_header X-Forwarded-Proto $scheme;
     client_max_body_size 30m;     # imports jusqu'à 20 000 lignes
   }
   ```
3. Passer `mode: 'serveur'` dans `client/js/config.js`.
4. **HTTPS obligatoire** (cookies de session `Secure`).
5. Sauvegarde quotidienne de la base du serveur, conservée hors de la machine.

### Reprise des données d'un poste autonome

Sur le poste : Données → *Télécharger une sauvegarde* (fichier JSON).
Sur le serveur : se connecter en ADMIN → Données → *Restaurer*, taper
`RESTAURER`. Le format est identique dans les deux modes.

## 4. Mise à jour de version

Modifier `version` dans `client/js/config.js`, redéployer `client/`.
Les données ne sont pas touchées (navigateur ou serveur).
