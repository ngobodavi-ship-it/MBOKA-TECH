/* MbokaTech — configuration (clés et services). Seul fichier à modifier pour changer de projet. */
/* ==========================================================
   ⚙️  CONFIGURATION — À ÉDITER
   ========================================================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBj82Uer7iUI9Y4gZNp1WnJYjMwlouN9hk",
  authDomain: "mboka-tech.firebaseapp.com",
  projectId: "mboka-tech",
  storageBucket: "mboka-tech.firebasestorage.app",
  messagingSenderId: "18314014953",
  appId: "1:18314014953:web:9a3a155b93f4b6cd7d0078"
};

/* ⚠️ Ne jamais exposer la clé OpenAI en production : utiliser une Cloud Function */
const OPENAI_CONFIG = {
  apiKey: "",                // ex: "sk-..." — vide = fallback simulé
  model: "gpt-4o-mini",
  whisperModel: "whisper-1"
};

/* ==========================================================
   GEMINI API (Google AI Studio) — GRATUIT
   Obtenir une clé : https://aistudio.google.com/app/apikey
   ========================================================== */
const GEMINI_CONFIG = {
  apiKey: "AIzaSyAqRt6TU5bOHySmMZPevsPKUQdNsVbQQl4",
  model: "gemini-2.0-flash"            // rapide et gratuit (60 req/min)
};

/* ==========================================================
   RELAIS VIDÉO (TURN) — indispensable entre réseaux mobiles / box
   Sans relais, deux appareils derrière des NAT stricts (4G, entreprise)
   ne peuvent pas échanger la vidéo. Compte gratuit : https://www.metered.ca/stun-turn
   puis collez ici l'URL « API » de vos identifiants TURN.
   ========================================================== */
const TURN_CONFIG = {
  // ex : "https://votre-app.metered.live/api/v1/turn/credentials?apiKey=XXXX"
  meteredApiUrl: "",
  // ou bien des serveurs fixes : [{ urls: "turn:...", username: "...", credential: "..." }]
  servers: [],
};
