// Serveur PeerJS local pour les tests (installé à part : voir run.sh)
const { PeerServer } = require("peer");
PeerServer({ port: 9000, path: "/myapp", host: "0.0.0.0" }, () => console.log("PeerServer prêt sur le port 9000"));
