#!/usr/bin/env node
/* =======================================================================
   Construit la version AUTONOME en un seul fichier HTML (comme la v0.4
   d'origine) à partir des sources de client/ :
     · les <link rel="stylesheet" href="css/…"> deviennent des <style> ;
     · les <script src="js/…"> deviennent des <script> en ligne ;
     · le modèle Excel et le guide PDF sont embarqués en data-URI.
   Usage : node outils/construire-monofichier.js [sortie.html]
   Aucune dépendance (Node ≥ 16).
   ======================================================================= */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CLIENT = path.join(__dirname, '..', 'client');
const SORTIE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'pilotage-dfc-bpo-autonome.html'));
const lire = f => fs.readFileSync(path.join(CLIENT, f), 'utf8');

const TYPES = { '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pdf': 'application/pdf' };
const dataUri = f => 'data:' + TYPES[path.extname(f)] + ';base64,' + fs.readFileSync(path.join(CLIENT, f)).toString('base64');

let html = lire('index.html');

html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, f) => `<style>\n${lire(f)}</style>`);

html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, f) => {
  let code = lire(f);
  if (f === 'js/lib/telechargement.js') code = code.replace(/url: '(assets\/[^']+)'/g, (__, a) => `url: '${dataUri(a)}'`);
  if (/<\/script/i.test(code)) throw new Error(f + ' contient « </script » : impossible à mettre en ligne.');
  return `<script>\n${code}</script>`;
});

fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
fs.writeFileSync(SORTIE, html);
console.log('Version autonome générée : ' + SORTIE + ' (' + Math.round(html.length / 1024) + ' Ko)');
