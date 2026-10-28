#!/usr/bin/env bash
# Lance les émulateurs Firebase (avec les vraies règles firestore.rules), un serveur
# PeerJS local, puis les deux scénarios de bout en bout. Prérequis : Node 20+, Java 17+.
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
# Le serveur PeerJS a besoin de sa propre version de « ws » : installation séparée
[ -d peer/node_modules ] || (mkdir -p peer && cd peer && npm init -y >/dev/null && npm install peer@1)
cp ../firestore.rules firestore.rules   # les vraies règles du projet, à jour à chaque lancement
npx firebase emulators:start --only auth,firestore --project mboka-tech > emulators.log 2>&1 &
EMU=$!
(cd peer && NODE_PATH=node_modules node ../peer-server.cjs) > peer.log 2>&1 &
PEER=$!
trap 'kill $EMU $PEER 2>/dev/null || true' EXIT
for i in $(seq 1 60); do grep -q "All emulators ready" emulators.log && break; sleep 2; done
node e2e1.js
node e2e2.js
