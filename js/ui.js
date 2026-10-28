/* MbokaTech — interface de réunion façon Zoom / Teams / Meet :
   - ordinateur : barre de commandes regroupée, avec libellés sous les icônes
   - téléphone : vidéo plein écran, panneau en tiroir, commandes secondaires dans « Plus »,
     affichage en duo (l'autre en grand, soi-même en vignette) */

const isSmallScreen = () => window.matchMedia("(max-width: 768px)").matches;

const CONTROL_LABELS = {
  "toggle-mic": "Micro", "toggle-cam": "Caméra", "toggle-screen": "Partager",
  "toggle-captions": "Sous-titres", "raise-hand-btn": "Main", "reactions-btn": "Réagir",
  "toggle-record": "Enregistrer", "participants-btn": "Participants", "toggle-chat-btn": "Chat",
  "activities-btn": "Activités", "toggle-ai-btn": "IA", "more-btn": "Plus", "leave-meeting-btn": "Quitter",
};
// Sur téléphone, ces commandes passent dans le menu « Plus »
const SECONDARY_ON_MOBILE = [
  ["toggle-screen", "bi-display", "Partager l'écran"],
  ["toggle-captions", "bi-badge-cc", "Sous-titres"],
  ["reactions-btn", "bi-emoji-smile", "Réactions"],
  ["toggle-record", "bi-record-circle", "Enregistrer"],
  ["activities-btn", "bi-grid-3x3-gap", "Sondages, Q&R, notes"],
  ["toggle-ai-btn", "bi-robot", "Compte rendu IA"],
];

const UI = {
  init() {
    // Libellés et accessibilité
    Object.entries(CONTROL_LABELS).forEach(([id, label]) => {
      const b = document.getElementById(id);
      if (!b || b.querySelector(".ctrl-label")) return;
      const s = document.createElement("span");
      s.className = "ctrl-label";
      s.textContent = label;
      b.appendChild(s);
      b.setAttribute("aria-label", b.title || label);
    });
    SECONDARY_ON_MOBILE.forEach(([id]) => document.getElementById(id)?.classList.add("ctrl-secondary"));

    // Participants rejoint le groupe des panneaux (chat, activités…)
    $("#toggle-chat-btn").before($("#participants-btn"));
    // Groupes : audio/vidéo | interaction | panneaux | quitter
    const sep = () => Object.assign(document.createElement("span"), { className: "ctrl-sep" });
    $("#toggle-cam").after(sep());
    $("#toggle-record").after(sep());
    $("#leave-meeting-btn").before(sep());

    // Menu « Plus » : copies des commandes secondaires, visibles seulement sur téléphone
    const menu = document.querySelector("#more-btn + .dropdown-menu");
    menu.insertAdjacentHTML("afterbegin",
      SECONDARY_ON_MOBILE.map(([id, icon, label]) =>
        `<li class="mobile-only" data-proxy-li="${id}"><button class="dropdown-item" data-proxy="${id}"><i class="bi ${icon} me-2"></i>${label}</button></li>`).join("") +
      '<li class="mobile-only"><hr class="dropdown-divider" /></li>');
    menu.addEventListener("click", (e) => {
      const b = e.target.closest("[data-proxy]");
      if (!b) return;
      // Après la fermeture du menu, sinon le clic referme aussitôt les fenêtres ouvertes (réactions)
      setTimeout(() => document.getElementById(b.dataset.proxy)?.click(), 0);
    });
    // Le menu ne propose que les commandes autorisées (enregistrement, IA…)
    $("#more-btn").addEventListener("show.bs.dropdown", () => {
      menu.querySelectorAll("[data-proxy-li]").forEach((li) => {
        const t = document.getElementById(li.dataset.proxyLi);
        li.style.display = t && t.style.display === "none" ? "none" : "";
      });
    });

    // Tiroir du panneau latéral sur téléphone : poignée de fermeture
    const panel = $("#side-panel");
    panel.insertAdjacentHTML("afterbegin",
      '<button class="sheet-handle" id="sheet-close" aria-label="Fermer le panneau"><span></span></button>');
    $("#sheet-close").addEventListener("click", () => panel.classList.add("collapsed"));

    window.addEventListener("resize", () => Layout.apply());
  },

  onMeetingEntered() {
    // Sur téléphone, la vidéo d'abord : le panneau s'ouvre à la demande
    if (isSmallScreen()) $("#side-panel").classList.add("collapsed");
    Layout.apply();
  },

  /* Appelée après chaque mise en page : affichage en duo sur téléphone */
  afterLayout(grid) {
    const remotes = grid.querySelectorAll(".video-tile.remote:not(.presenter)");
    const special = grid.classList.contains("presenting") || grid.classList.contains("layout-speaker");
    const duo = isSmallScreen() && remotes.length === 1 && !special && !state.prefs.hideSelf;
    grid.classList.toggle("duo", duo);

    // Mosaïque qui remplit l'écran (comme la vue galerie de Zoom) : on choisit le nombre
    // de colonnes qui donne les plus grandes vignettes au format 16:9
    const gallery = !duo && !special;
    grid.classList.toggle("gallery", gallery);
    if (!gallery) return;
    const tiles = [...grid.querySelectorAll(".video-tile")].filter((t) => getComputedStyle(t).display !== "none");
    const n = Math.max(1, tiles.length);
    const W = grid.clientWidth - 24, H = grid.clientHeight - 24;
    if (W <= 0 || H <= 0) return;
    let best = { cols: 1, size: 0 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = (W - (cols - 1) * 12) / cols, h = (H - (rows - 1) * 12) / rows;
      const size = Math.min(w, (h * 16) / 9);
      if (size > best.size) best = { cols, size };
    }
    const rows = Math.ceil(n / best.cols);
    grid.style.setProperty("--cols", best.cols);
    grid.style.setProperty("--rows", rows);
    grid.style.setProperty("--tile-w", Math.floor(best.size) + "px");
  },
};

UI.init();
