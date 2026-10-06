/* MbokaTech — cœur : Firebase, authentification, réunions, WebRTC, chat, IA, Vague 1 */
/* ==========================================================
   INITIALISATION FIREBASE (avec fallback démo)
   ========================================================== */
let auth, db, storage;
let firebaseReady = false;

try {
  // Vérifier que les SDK sont bien chargés
  if (typeof firebase === "undefined") {
    console.warn("Firebase SDK non chargé. Si vous ouvrez en file://, déployez d'abord (Netlify, Firebase Hosting, etc.)");
    const banner = document.getElementById("config-warning");
    if (banner) {
      banner.innerHTML = '<i class="bi bi-exclamation-triangle-fill"></i> <strong>Firebase non chargé.</strong> Ouvrez ce fichier via une URL <code>https://</code> (ex: déployez sur <a href="https://app.netlify.com/drop" target="_blank">Netlify</a>) — les fonctionnalités cloud sont indisponibles en mode <code>file://</code>.';
      banner.classList.remove("d-none");
    }
  } else if (FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "VOTRE_API_KEY") {
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.firestore();
    try { storage = firebase.storage(); } catch (e) { console.warn("Storage indisponible :", e.message); }
    firebaseReady = true;
    console.log("✅ Firebase initialisé : " + FIREBASE_CONFIG.projectId);
  } else {
    document.getElementById("config-warning").classList.remove("d-none");
  }
} catch (e) {
  console.error("Firebase init error:", e);
  const banner = document.getElementById("config-warning");
  if (banner) {
    banner.textContent = "⚠️ Erreur Firebase : " + e.message + " — passage en mode démo.";
    banner.classList.remove("d-none");
  }
}

/* ==========================================================
   ÉTAT GLOBAL
   ========================================================== */
const APP_LOGO = "logo-mbokatech.png";

const state = {
  user: null,
  currentMeetingId: null,
  currentMeetingTitle: "",
  localStream: null,
  screenStream: null,
  peer: null,
  myPeerId: null,
  calls: {},
  remoteStreams: {},
  participantNames: {},
  unsubChat: null,
  unsubParticipants: null,
  unsubPresenter: null,
  unsubMeetings: null,
  micOn: true,
  camOn: true,
  isScreenSharing: false,
  isRecording: false,
  mediaRecorder: null,
  recordedChunks: [],
  meetingStartTime: null,
  timerInterval: null,
  lastRecordedBlob: null,
  // mode démo (sans Firebase)
  demoMeetings: [],
  demoMessages: {},
};

/* ==========================================================
   HELPERS
   ========================================================== */
const $ = (sel) => document.querySelector(sel);

function showPage(id) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  $(`#${id}`).classList.add("active");
}
function showToast(msg, type = "dark") {
  const toastEl = $("#app-toast");
  toastEl.className = `toast align-items-center text-bg-${type} border-0`;
  $("#toast-body").textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }).show();
}
function showAuthError(msg) {
  const el = $("#auth-error");
  el.textContent = msg;
  el.classList.remove("d-none");
  setTimeout(() => el.classList.add("d-none"), 5000);
}
function initials(name = "") {
  return name.trim().split(/\s+/).map((s) => s[0] || "").join("").slice(0, 2).toUpperCase() || "U";
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function humanizeAuthError(err) {
  const map = {
    "auth/invalid-email": "Email invalide.",
    "auth/user-not-found": "Aucun compte avec cet email.",
    "auth/wrong-password": "Mot de passe incorrect.",
    "auth/invalid-credential": "Identifiants invalides.",
    "auth/email-already-in-use": "Email déjà utilisé.",
    "auth/weak-password": "Mot de passe trop faible (6 caractères min).",
    "auth/network-request-failed": "Problème de connexion réseau.",
  };
  return map[err.code] || err.message || "Erreur d'authentification.";
}

/* ==========================================================
   DÉTECTION DU LIEN D'INVITATION (?join=meetingId)
   ========================================================== */
(function detectInvitationLink() {
  const params = new URLSearchParams(window.location.search);
  const joinId = params.get("join");
  if (joinId) {
    state.pendingJoinMeetingId = joinId;
    // Conservé à part : pendingJoinMeetingId est effacé dès qu'on entre dans l'app
    state.inviteMeetingId = joinId;
    // Pas de minuterie ici : c'est onAuthStateChanged qui décide (modal invité si non connecté,
    // sinon enterApp). Une minuterie ouvrait le modal avant que Firebase ait restauré la session.
  }
})();

async function showGuestModal(meetingId) {
  // Récupérer le titre pour l'afficher dans le modal
  let title = "Réunion";
  if (firebaseReady) {
    try {
      const doc = await db.collection("meetings").doc(meetingId).get();
      if (doc.exists) title = doc.data().title || title;
    } catch (e) { /* ignore */ }
  }
  $("#guest-meeting-title-display").textContent = title;
  bootstrap.Modal.getOrCreateInstance($("#guestModal")).show();
}

// Formulaire invité
$("#guest-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#guest-name").value.trim();
  const email = $("#guest-email").value.trim();
  const errEl = $("#guest-error");
  errEl.classList.add("d-none");

  if (!firebaseReady) {
    errEl.textContent = "Firebase non connecté";
    errEl.classList.remove("d-none");
    return;
  }

  // ★ Sauvegarder l'ID de la réunion AVANT toute opération
  // (sera utilisé directement après l'auth, pas via enterApp)
  const targetMeetingId = state.pendingJoinMeetingId || state.inviteMeetingId;
  console.log("🎯 Réunion ciblée :", targetMeetingId);

  if (!targetMeetingId) {
    errEl.textContent = "Lien d'invitation invalide";
    errEl.classList.remove("d-none");
    return;
  }

  try {
    // Si déjà connecté à un autre compte, se déconnecter d'abord
    if (auth.currentUser) {
      console.log("Déconnexion de l'utilisateur précédent...");
      // Marquer comme "auth en cours" pour éviter que onAuthStateChanged interfère
      state.authInProgress = true;
      await auth.signOut();
      await new Promise(r => setTimeout(r, 500));
    }

    console.log("Tentative de connexion anonyme...");
    state.authInProgress = true;
    const cred = await auth.signInAnonymously();
    console.log("✅ Connexion anonyme réussie, uid:", cred.user.uid);

    await cred.user.updateProfile({ displayName: name });

    try {
      await db.collection("users").doc(cred.user.uid).set({
        uid: cred.user.uid,
        name,
        email,
        isGuest: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) { console.warn("users write:", e); }

    state.user = { uid: cred.user.uid, email, name, isGuest: true };
    state.authInProgress = false;

    // Fermer le modal
    bootstrap.Modal.getInstance($("#guestModal")).hide();

    // Mettre à jour l'UI utilisateur
    $("#user-name-display").textContent = name;
    $("#user-email-display").textContent = email;
    $("#user-avatar").textContent = initials(name);
    $("#welcome-name").textContent = name.split(" ")[0];

    // ★ REJOINDRE DIRECTEMENT la réunion (pas besoin de passer par l'accueil)
    state.pendingJoinMeetingId = null;
    console.log("🚀 Rejoindre directement la réunion :", targetMeetingId);
    await joinMeetingById(targetMeetingId);
  } catch (err) {
    state.authInProgress = false;
    console.error("[GUEST AUTH ERROR]", err);
    let msg = "";

    if (err.code === "auth/admin-restricted-operation") {
      msg = "❌ Connexion anonyme désactivée. L'organisateur doit l'activer dans Firebase Console → Authentication → Sign-in method → Anonymous.";
    } else if (err.code === "auth/operation-not-allowed") {
      msg = "❌ Méthode de connexion anonyme non activée. Vérifiez Firebase Console → Authentication → Sign-in method → Anonymous (toggle activé).";
    } else if (err.code === "auth/network-request-failed") {
      msg = "❌ Problème de connexion réseau. Vérifiez votre connexion internet.";
    } else if (err.code === "auth/too-many-requests") {
      msg = "❌ Trop de tentatives. Attendez quelques minutes avant de réessayer.";
    } else if (err.code) {
      msg = `❌ Erreur (${err.code}) : ${err.message}`;
    } else {
      msg = `❌ ${err.message || "Erreur inconnue"}`;
    }

    errEl.innerHTML = msg;
    errEl.classList.remove("d-none");
  }
});

/* ==========================================================
   1. AUTHENTIFICATION
   ========================================================== */
/* Appelée par js/main.js, une fois TOUS les scripts chargés
   (la session Firebase peut être restaurée avant la fin du chargement). */
function startAuth() {
  if (!firebaseReady) return;
  auth.onAuthStateChanged((user) => {
    // Ignorer si une auth invité est en cours (sera géré par guest-form)
    if (state.authInProgress) {
      console.log("⏸️ onAuthStateChanged ignoré (auth en cours dans guest-form)");
      return;
    }

    if (user) {
      state.user = {
        uid: user.uid,
        email: user.email || $("#guest-email")?.value || "",
        name: user.displayName || user.email?.split("@")[0] || "Invité",
        isGuest: !!user.isAnonymous,
      };
      enterApp();
    } else {
      state.user = null;
      // Si lien d'invitation présent, on affiche le modal invité au lieu de la page auth
      if (state.pendingJoinMeetingId) {
        showGuestModal(state.pendingJoinMeetingId);
      } else {
        showPage("auth-page");
      }
    }
  });
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  const pwd = $("#login-password").value;

  if (!firebaseReady) {
    // Mode démo
    state.user = { uid: "demo-" + Date.now(), email, name: email.split("@")[0] };
    enterApp();
    showToast("Mode démo activé (sans Firebase)", "warning");
    return;
  }

  try { await auth.signInWithEmailAndPassword(email, pwd); }
  catch (err) { showAuthError(humanizeAuthError(err)); }
});

$("#register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#register-name").value.trim();
  const email = $("#register-email").value.trim();
  const pwd = $("#register-password").value;

  if (!firebaseReady) {
    state.user = { uid: "demo-" + Date.now(), email, name };
    enterApp();
    showToast("Mode démo activé (sans Firebase)", "warning");
    return;
  }

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pwd);
    await cred.user.updateProfile({ displayName: name });
    await db.collection("users").doc(cred.user.uid).set({
      uid: cred.user.uid, name, email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) { showAuthError(humanizeAuthError(err)); }
});

$("#logout-btn").addEventListener("click", async () => {
  if (state.currentMeetingId) leaveMeeting();
  if (firebaseReady) await auth.signOut();
  else { state.user = null; showPage("auth-page"); }
  showToast("Déconnecté");
});

/* ==========================================================
   2. ENTRÉE DANS L'APP
   ========================================================== */
function enterApp() {
  bootstrap.Modal.getInstance($("#guestModal"))?.hide();
  $("#user-name-display").textContent = state.user.name;
  $("#user-email-display").textContent = state.user.email;
  $("#user-avatar").textContent = initials(state.user.name);
  $("#welcome-name").textContent = state.user.name.split(" ")[0];
  showPage("home-page");
  loadMeetings();
  Reports.load();

  // Si l'utilisateur arrive via un lien d'invitation, le rejoindre auto
  const pendingJoin = state.pendingJoinMeetingId;
  if (pendingJoin) {
    state.pendingJoinMeetingId = null;
    setTimeout(() => joinMeetingById(pendingJoin), 500);
  }
}

/* === Rejoindre une réunion par son ID (recherche le titre puis rejoint) === */
async function joinMeetingById(meetingId) {
  let title = "Réunion";
  if (firebaseReady) {
    try {
      const doc = await db.collection("meetings").doc(meetingId).get();
      if (doc.exists) {
        title = doc.data().title || title;
      } else {
        showToast("Réunion introuvable", "danger");
        return;
      }
    } catch (e) { console.warn(e); }
  }
  joinMeeting(meetingId, title);
}

/* ==========================================================
   3. LISTE DES RÉUNIONS
   ========================================================== */
function loadMeetings() {
  if (!firebaseReady) {
    renderDemoMeetings();
    return;
  }

  if (state.unsubMeetings) state.unsubMeetings();

  // Deux requêtes simples (sans orderBy, donc sans index composite à créer) :
  // les réunions que j'organise et celles auxquelles j'ai participé
  const owned = new Map();
  const joined = new Map();
  const render = () => {
    const all = new Map([...joined, ...owned]);
    renderMeetings([...all.values()].sort((a, b) => tsOf(b.data().createdAt) - tsOf(a.data().createdAt)));
  };
  const uid = state.user.uid;
  const u1 = db.collection("meetings").where("ownerId", "==", uid).limit(100).onSnapshot(
    (snap) => { owned.clear(); snap.docs.forEach((d) => owned.set(d.id, d)); render(); },
    (err) => console.error("Réunions organisées :", err)
  );
  const u2 = db.collection("meetings").where("attendeeIds", "array-contains", uid).limit(100).onSnapshot(
    (snap) => { joined.clear(); snap.docs.forEach((d) => joined.set(d.id, d)); render(); },
    (err) => console.warn("Réunions rejointes :", err)
  );
  state.unsubMeetings = () => { u1(); u2(); };
}

function renderMeetings(docs) {
  const now0 = Date.now();
  const upcomingAt = (d) => { const t = tsOf(d.data().scheduledAt); return t > now0 - 3600000 ? t : 0; };
  docs = docs.filter((d) => !d.data().isBreakout)
    .map((d, i) => ({ d, i, up: upcomingAt(d) }))
    .sort((a, b) => (a.up && b.up ? a.up - b.up : (b.up ? 1 : 0) - (a.up ? 1 : 0)) || a.i - b.i)
    .map((x) => x.d);
  onMeetingsRendered(docs);
  const list = $("#meetings-list");
  $("#meetings-count").textContent = docs.length;
  $("#stat-total").textContent = docs.length;

  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let week = 0, reports = 0;
  docs.forEach((d) => {
    const data = d.data();
    const t = data.createdAt?.toMillis?.() || 0;
    if (now - t < oneWeek) week++;
    if (data.hasReport) reports++;
  });
  $("#stat-week").textContent = week;
  $("#stat-reports").textContent = reports;

  if (docs.length === 0) {
    list.innerHTML = `
      <div class="text-center text-muted py-5 small">
        <i class="bi bi-inbox fs-1 d-block mb-2 opacity-50"></i>
        Aucune réunion pour le moment
      </div>`;
    return;
  }

  list.innerHTML = docs.map((d) => {
    const data = d.data();
    const date = data.createdAt?.toDate?.() || new Date();
    const dateStr = date.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    const hasReport = !!data.hasReport;
    return `
      <div class="meeting-row" data-id="${d.id}" data-title="${escapeHtml(data.title || "")}" data-hasreport="${hasReport}">
        <div class="meeting-icon"><i class="bi bi-camera-video-fill"></i></div>
        <div class="meeting-info">
          <div class="meeting-title">${escapeHtml(data.title || "Sans titre")}</div>
          <div class="meeting-meta">
            <i class="bi bi-clock"></i> ${dateStr}
            ${hasReport ? '<span class="badge bg-success-subtle text-success ms-2"><i class="bi bi-stars"></i> Compte rendu</span>' : ""}
            ${scheduledBadge(data)}
            ${data.ownerId && data.ownerId !== state.user.uid ? `<span class="badge bg-secondary-subtle text-secondary ms-2"><i class="bi bi-person"></i> ${escapeHtml(data.ownerName || "Invité")}</span>` : ""}
          </div>
        </div>
        <div class="ms-3 d-flex gap-2 flex-shrink-0" onclick="event.stopPropagation()">
          ${hasReport ? `
            <button class="btn btn-sm btn-outline-danger download-pdf-btn" data-meeting-id="${d.id}" title="Télécharger en PDF">
              <i class="bi bi-file-earmark-pdf-fill"></i>
              <span class="d-none d-lg-inline ms-1">PDF</span>
            </button>
            <button class="btn btn-sm btn-outline-primary download-word-btn" data-meeting-id="${d.id}" title="Télécharger en Word">
              <i class="bi bi-file-earmark-word-fill"></i>
              <span class="d-none d-lg-inline ms-1">Word</span>
            </button>
          ` : ""}
          <button class="btn btn-sm btn-outline-secondary copy-link-btn" data-meeting-id="${d.id}" title="Copier le lien d'invitation">
            <i class="bi bi-link-45deg"></i>
          </button>
          <button class="btn btn-sm btn-primary fw-semibold join-btn">
            <i class="bi bi-arrow-right"></i> <span class="d-none d-md-inline">Rejoindre</span>
          </button>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".meeting-row").forEach((row) => {
    // Le clic sur la ligne entière rejoint la réunion
    row.addEventListener("click", (e) => {
      // Ignorer si on a cliqué sur un bouton d'action
      if (e.target.closest(".download-pdf-btn") || e.target.closest(".download-word-btn") || e.target.closest(".copy-link-btn")) return;
      joinMeeting(row.dataset.id, row.dataset.title);
    });
  });

  // Le bouton « Rejoindre » est dans un conteneur qui stoppe la propagation : il lui faut son propre écouteur
  list.querySelectorAll(".join-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".meeting-row");
      joinMeeting(row.dataset.id, row.dataset.title);
    });
  });

  list.querySelectorAll(".copy-link-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyText(inviteLinkFor(btn.dataset.meetingId), "Lien d'invitation copié");
    });
  });

  // Boutons téléchargement PDF
  list.querySelectorAll(".download-pdf-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await downloadMeetingReport(btn.dataset.meetingId, "pdf");
    });
  });

  // Boutons téléchargement Word
  list.querySelectorAll(".download-word-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await downloadMeetingReport(btn.dataset.meetingId, "word");
    });
  });
}

/* === Télécharger le compte rendu d'une réunion depuis la liste === */
async function downloadMeetingReport(meetingId, format) {
  if (!firebaseReady) {
    showToast("Firebase non connecté", "danger");
    return;
  }

  showToast("📥 Récupération du compte rendu...", "info");

  try {
    // 1. Récupérer le compte rendu le plus récent pour cette réunion
    const reportsSnap = await db.collection("reports")
      .where("meetingId", "==", meetingId)
      .get();

    if (reportsSnap.empty) {
      showToast("Aucun compte rendu trouvé pour cette réunion", "warning");
      return;
    }

    const reportData = reportsSnap.docs
      .map((d) => d.data())
      .sort((a, b) => tsOf(b.createdAt) - tsOf(a.createdAt))[0];

    // 2. Récupérer les infos de la réunion
    const meetingDoc = await db.collection("meetings").doc(meetingId).get();
    const meetingData = meetingDoc.exists ? meetingDoc.data() : {};

    // 3. Récupérer les participants depuis la transcription
    let participants = [];
    try {
      const transcriptSnap = await db.collection("meetings").doc(meetingId)
        .collection("transcript").get();
      const setNames = new Set();
      transcriptSnap.docs.forEach(d => {
        if (d.data().userName) setNames.add(d.data().userName);
      });
      participants = Array.from(setNames);
    } catch (e) { /* ignore */ }

    // 4. Construire les metadata
    const createdDate = reportData.createdAt?.toDate?.() || new Date();
    const meta = {
      title: reportData.meetingTitle || meetingData.title || "Réunion",
      dateStr: createdDate.toLocaleDateString("fr-FR", {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
      }),
      timeStr: createdDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      organizerName: meetingData.ownerName || "Organisateur",
      participants: participants.length ? participants : [meetingData.ownerName || "Organisateur"],
      meetingId,
    };

    const report = {
      summary: reportData.summary || "",
      decisions: reportData.decisions || [],
      actions: reportData.actions || [],
      keypoints: reportData.keypoints || [],
    };

    // 5. Lancer l'export
    if (format === "pdf") {
      exportReportPDFDirect(report, meta);
    } else {
      await exportReportWordDirect(report, meta);
    }
  } catch (err) {
    console.error(err);
    showToast("Erreur : " + err.message, "danger");
  }
}

function renderDemoMeetings() {
  // Construit un tableau "fake docs" pour réutiliser renderMeetings
  const fakeDocs = state.demoMeetings.map((m) => ({
    id: m.id,
    data: () => ({
      ...m,
      createdAt: { toDate: () => m.createdAt, toMillis: () => m.createdAt.getTime() }
    })
  }));
  renderMeetings(fakeDocs);
}

/* ==========================================================
   4. CRÉATION / REJOINDRE UNE RÉUNION
   ========================================================== */
$("#create-meeting-btn").addEventListener("click", () => {
  bootstrap.Modal.getOrCreateInstance($("#createMeetingModal")).show();
});

$("#create-meeting-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("#new-meeting-title").value.trim();
  const description = $("#new-meeting-desc").value.trim();
  const scheduled = $("#new-meeting-schedule").checked && $("#new-meeting-date").value;
  const scheduledAt = scheduled ? new Date($("#new-meeting-date").value) : null;
  const durationMin = Number($("#new-meeting-duration").value) || 60;
  const settings = {
    ...DEFAULT_MEETING_SETTINGS,
    waitingRoom: $("#new-meeting-waiting").checked,
    autoTranscribe: $("#new-meeting-autotranscribe").checked,
    autoReport: $("#new-meeting-autoreport").checked,
    autoRecord: $("#new-meeting-autorecord").checked,
  };

  if (scheduledAt && isNaN(scheduledAt.getTime())) { showToast("Date invalide", "warning"); return; }

  try {
    let id;
    const extra = {
      description, settings,
      ...(scheduledAt ? { scheduledAt, durationMin } : {}),
    };
    if (firebaseReady) {
      const ref = await db.collection("meetings").add({
        title,
        ownerId: state.user.uid,
        ownerName: state.user.name,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        participants: [],
        hasReport: false,
        ...extra,
      });
      id = ref.id;
    } else {
      id = "demo-" + Math.random().toString(36).slice(2, 10);
      state.demoMeetings.unshift({
        id, title,
        ownerId: state.user.uid,
        ownerName: state.user.name,
        createdAt: new Date(),
        hasReport: false,
        ...extra,
      });
      renderDemoMeetings();
    }
    bootstrap.Modal.getInstance($("#createMeetingModal")).hide();
    $("#create-meeting-form").reset();
    $("#schedule-fields").style.display = "none";
    if (scheduledAt) showScheduledModal({ id, title, description, scheduledAt, durationMin });
    else joinMeeting(id, title);
  } catch (err) {
    console.error(err);
    showToast("Erreur lors de la création", "danger");
  }
});

$("#join-meeting-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#join-meeting-id").value.trim();
  if (!id) return;

  let title = "Réunion";
  if (firebaseReady) {
    const doc = await db.collection("meetings").doc(id).get();
    if (!doc.exists) { showToast("Réunion introuvable", "danger"); return; }
    title = doc.data().title || title;
  } else {
    const m = state.demoMeetings.find((x) => x.id === id);
    if (m) title = m.title;
  }
  bootstrap.Modal.getInstance($("#joinMeetingModal")).hide();
  $("#join-meeting-id").value = "";
  joinMeeting(id, title);
});

/* ==========================================================
   5. PAGE RÉUNION
   ========================================================== */
async function enterMeetingRoom(meetingId, title) {
  state.currentMeetingId = meetingId;
  state.currentMeetingTitle = title;
  $("#meeting-title").textContent = title;
  $("#meeting-id-display").textContent = meetingId;
  $("#local-name").textContent = state.user.name + " (vous)";
  showPage("meeting-page");

  document.querySelectorAll(".video-tile.remote").forEach((el) => el.remove());
  $("#chat-messages").innerHTML = "";
  resetAIPanel();

  // Détecter si l'utilisateur est l'organisateur (créateur de la réunion)
  state.isOrganizer = false;
  if (firebaseReady) {
    try {
      const doc = await db.collection("meetings").doc(meetingId).get();
      if (doc.exists) {
        state.isOrganizer = doc.data().ownerId === state.user.uid;
      }
    } catch (e) { console.warn(e); }
  } else {
    // En mode démo, créateur connu localement
    const m = state.demoMeetings.find(x => x.id === meetingId);
    state.isOrganizer = m ? (m.ownerId === state.user.uid) : true;
  }

  // Adapter l'UI selon le rôle
  const transcriptBtn = $("#toggle-transcription-btn");
  const transcriptLabel = $("#transcription-btn-label");
  const aiTab = document.querySelector('[data-bs-target="#ai-pane"]');
  const aiToggleBtn = $("#toggle-ai-btn");

  if (state.isOrganizer) {
    // ORGANISATEUR : tout est visible
    if (transcriptBtn) {
      transcriptBtn.disabled = false;
      transcriptBtn.classList.remove("opacity-50");
      transcriptLabel.textContent = "Démarrer la transcription";
      transcriptBtn.title = "Activer la transcription pour tous les participants";
    }
    if (aiTab) aiTab.style.display = "";
    if (aiToggleBtn) aiToggleBtn.style.display = "";
  } else {
    // PARTICIPANT : panneau IA totalement caché
    if (aiTab) aiTab.style.display = "none";
    if (aiToggleBtn) aiToggleBtn.style.display = "none";
    // Forcer l'affichage sur l'onglet Chat
    const chatTab = document.querySelector('[data-bs-target="#chat-pane"]');
    if (chatTab) chatTab.click();
  }

  try {
    await initLocalMedia();
    if (firebaseReady) {
      initPeer(meetingId);
      initChat(meetingId);
      initParticipants(meetingId);
      state.unsubPresenter = watchPresenter(meetingId);
      state.unsubTranscript = initTranscriptSync(meetingId);
      state.unsubTranscriptionMode = watchTranscriptionMode(meetingId);

      // === VAGUE 1 ===
      state.unsubParticipantsList = syncParticipantsList(meetingId);
      state.unsubCommands = syncCommands(meetingId);
      state.unsubReactions = initReactionsListener(meetingId);

      // Récupérer l'ID du créateur pour reconnaître les organisateurs
      try {
        const md = await db.collection("meetings").doc(meetingId).get();
        if (md.exists) state.meetingOwnerId = md.data().ownerId;
      } catch (e) { /* ignore */ }

      // Si je suis organisateur, écouter la salle d'attente + afficher le panneau host
      if (state.isOrganizer) {
        state.unsubWaiting = syncWaitingRoom(meetingId);
        const ht = $("#host-controls");
        if (ht) ht.style.display = "";
      } else {
        const ht = $("#host-controls");
        if (ht) ht.style.display = "none";
      }
    } else {
      initDemoChat();
      state.transcriptEntries = [];
    }
    startMeetingTimer();
    onMeetingEntered(meetingId);
  } catch (err) {
    console.error(err);
    showToast("Impossible d'accéder à la caméra/micro : " + err.message, "danger");
  }
}

$("#back-home-btn").addEventListener("click", () => finishMeeting());
$("#leave-meeting-btn").addEventListener("click", () => {
  if (state.isOrganizer && firebaseReady) bootstrap.Modal.getOrCreateInstance($("#leaveModal")).show();
  else finishMeeting();
});

function leaveMeeting(opts = {}) {
  runMeetingCleanups(opts);
  if (state.localStream) { state.localStream.getTracks().forEach((t) => t.stop()); state.localStream = null; }
  stopRawMedia();
  if (state.screenStream) { state.screenStream.getTracks().forEach((t) => t.stop()); state.screenStream = null; }
  if (state.isRecording && state.mediaRecorder) {
    try { state.mediaRecorder.stop(); } catch(_) {}
    Recorder.stop();
    state.isRecording = false;
  }

  if (state.peer) {
    Object.values(state.calls).forEach((c) => c.close());
    state.calls = {}; state.remoteStreams = {};
    state.peer.destroy(); state.peer = null;
  }

  if (firebaseReady && state.currentMeetingId && state.myPeerId) {
    db.collection("meetings").doc(state.currentMeetingId)
      .collection("participants").doc(state.myPeerId).delete().catch(() => {});
  }

  if (state.unsubChat) { state.unsubChat(); state.unsubChat = null; }
  if (state.unsubParticipants) { state.unsubParticipants(); state.unsubParticipants = null; }
  if (state.unsubPresenter) { state.unsubPresenter(); state.unsubPresenter = null; }
  if (state.unsubTranscript) { state.unsubTranscript(); state.unsubTranscript = null; }
  if (state.unsubTranscriptionMode) { state.unsubTranscriptionMode(); state.unsubTranscriptionMode = null; }
  if (state.unsubParticipantsList) { state.unsubParticipantsList(); state.unsubParticipantsList = null; }
  if (state.unsubCommands) { state.unsubCommands(); state.unsubCommands = null; }
  if (state.unsubReactions) { state.unsubReactions(); state.unsubReactions = null; }
  if (typeof state.unsubWaiting === "function") state.unsubWaiting();
  state.unsubWaiting = null;
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
  if (state.heartbeatInterval) { clearInterval(state.heartbeatInterval); state.heartbeatInterval = null; }
  if (state.ghostCheckInterval) { clearInterval(state.ghostCheckInterval); state.ghostCheckInterval = null; }

  // Arrêter la transcription en direct
  if (state.isTranscribing) {
    state.isTranscribing = false;
    state.autoTranscribing = false;
    if (state.recognition) { try { state.recognition.stop(); } catch(_) {} }
  }
  state.liveTranscript = "";
  state.transcriptEntries = [];
  state.localTranscriptEntries = [];
  state.isOrganizer = false;

  Object.values(state.callWatchdogs || {}).forEach(clearTimeout);
  state.callWatchdogs = {};
  state.callRetries = {};
  state.peerOpen = false;
  state.pendingPeers = new Set();
  state.currentMeetingId = null;
  state.myPeerId = null;
  if (!opts.stayOnPage) showPage("home-page");
}

/* ==========================================================
   6. WEBRTC via PeerJS
   ========================================================== */
async function initLocalMedia() {
  // Réutilise le flux de l'écran de préparation s'il existe (mêmes périphériques, même effet)
  if (!state.rawStream) {
    state.rawStream = await acquireMedia();
    if (state.prefs.bgMode !== "none" && state.rawStream.getVideoTracks()[0]) {
      await BgFx.apply(state.prefs.bgMode, { silent: true });
    }
  }
  state.localStream = new MediaStream([getOutVideoTrack(), getOutAudioTrack()]);
  $("#local-video").srcObject = state.localStream;
  // Important : muter la vidéo locale pour éviter l'écho avec les enceintes
  $("#local-video").muted = true;
  $("#local-video").volume = 0;
  state.micOn = state.desiredMicOn !== false && !!state.rawStream.getAudioTracks()[0];
  state.camOn = state.desiredCamOn !== false && !!state.rawStream.getVideoTracks()[0];
  applyTrackEnabled();
  updateControlsUI();
}

const STUN_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:global.stun.twilio.com:3478" },
];
// Relais publics de secours (fiabilité non garantie) : préférez TURN_CONFIG
const FALLBACK_TURN = [
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

async function getIceServers() {
  let turn = TURN_CONFIG.servers || [];
  if (TURN_CONFIG.meteredApiUrl) {
    try {
      const res = await fetch(TURN_CONFIG.meteredApiUrl);
      if (res.ok) turn = [...turn, ...(await res.json())];
    } catch (e) { console.warn("TURN Metered indisponible :", e); }
  }
  if (!turn.length) turn = FALLBACK_TURN;
  return [...STUN_SERVERS, ...turn];
}

async function initPeer(meetingId) {
  state.peerOpen = false;
  state.pendingPeers = new Set();
  const iceServers = await getIceServers();
  if (state.currentMeetingId !== meetingId) return; // réunion quittée entre-temps
  state.peer = new Peer(undefined, {
    debug: 1,
    config: { iceServers },
  });

  state.peer.on("disconnected", () => {
    // Perte du serveur de signalisation : les appels en cours continuent, on se reconnecte
    if (state.peer && !state.peer.destroyed && state.currentMeetingId) {
      setTimeout(() => { try { state.peer.reconnect(); } catch (_) {} }, 1500);
    }
  });

  state.peer.on("open", async (id) => {
    state.myPeerId = id;

    // 1. NETTOYAGE : supprimer mes anciennes entrées fantômes
    try {
      const oldEntries = await db.collection("meetings").doc(meetingId)
        .collection("participants")
        .where("userId", "==", state.user.uid)
        .get();

      const batch = db.batch();
      oldEntries.docs.forEach(doc => {
        if (doc.id !== id) {
          console.log("🧹 Suppression d'une entrée fantôme :", doc.id);
          batch.delete(doc.ref);
        }
      });
      await batch.commit();
    } catch (e) { console.warn("Cleanup error:", e); }

    // 2. INSCRIPTION : nouvelle entrée
    await db.collection("meetings").doc(meetingId)
      .collection("participants").doc(id).set({
        peerId: id,
        userId: state.user.uid,
        name: state.user.name,
        micOn: state.micOn,
        camOn: state.camOn,
        isGuest: !!state.user.isGuest,
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      });

    // Les participants vus avant que la connexion soit prête peuvent maintenant être appelés
    state.peerOpen = true;
    [...(state.pendingPeers || [])].forEach((pid) => connectToPeer(pid));
    state.pendingPeers = new Set();

    // 3. HEARTBEAT : mise à jour de "lastSeen" toutes les 10s
    if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
    state.heartbeatInterval = setInterval(async () => {
      if (!state.currentMeetingId || !state.myPeerId) return;
      try {
        await db.collection("meetings").doc(state.currentMeetingId)
          .collection("participants").doc(state.myPeerId)
          .update({ lastSeen: firebase.firestore.FieldValue.serverTimestamp() });
      } catch (e) { /* silently ignore */ }
    }, 10000);
  });

  state.peer.on("call", (call) => {
    // Identifier le type d'appel via metadata
    const callType = call.metadata?.type || "camera";
    console.log(`📞 Appel entrant de ${call.peer} (type: ${callType})`);
    if (call.metadata?.userName && !state.participantNames[call.peer]) {
      state.participantNames[call.peer] = call.metadata.userName;
    }
    if (callType === "camera" && state.calls[call.peer] && state.calls[call.peer] !== call) {
      const old = state.calls[call.peer];
      delete state.calls[call.peer];
      try { old.close(); } catch (_) {}
    }
    call.answer(state.localStream);
    setupCall(call, callType);
  });

  state.peer.on("error", (err) => {
    console.error("[PeerJS]", err);
    showToast("Erreur connexion vidéo : " + err.type, "warning");
  });
}

function setupCall(call, type = "camera") {
  // Pour les appels caméra : remplace l'ancien si déjà existant
  // Pour les appels écran : stockés séparément
  if (type === "screen") {
    state.screenCalls = state.screenCalls || {};
    state.screenCalls[call.peer] = call;
  } else {
    state.calls[call.peer] = call;
  }

  call.on("stream", (remoteStream) => {
    if (type === "screen") {
      state.remoteScreenStreams = state.remoteScreenStreams || {};
      state.remoteScreenStreams[call.peer] = remoteStream;
      addRemoteScreenVideo(call.peer, remoteStream);
    } else {
      state.remoteStreams[call.peer] = remoteStream;
      addRemoteVideo(call.peer, remoteStream);
    }
  });
  call.on("close", () => {
    if (type === "screen") {
      if (state.screenCalls?.[call.peer] !== call) return; // remplacé par un appel plus récent
      removeRemoteScreenVideo(call.peer);
      delete state.screenCalls[call.peer];
    } else {
      if (state.calls[call.peer] !== call) return; // remplacé par un appel plus récent
      removeRemoteVideo(call.peer);
    }
  });
  call.on("error", (e) => console.error(`[call ${type} error]`, e));
  watchIce(call, type);
}

/* Suit la connexion réseau d'un appel : relance en cas d'échec, explique sinon */
function watchIce(call, type) {
  const attach = () => {
    const pc = call.peerConnection;
    if (!pc) return false;
    pc.addEventListener("iceconnectionstatechange", () => {
      const st = pc.iceConnectionState;
      console.log(`[ICE ${type}] ${call.peer} → ${st}`);
      if (st === "failed" && type === "camera" && state.calls[call.peer] === call) {
        const name = state.participantNames[call.peer] || "un participant";
        const tries = (state.callRetries[call.peer] = (state.callRetries[call.peer] || 0) + 1);
        if (tries <= 3) {
          showToast(`Connexion vidéo avec ${name} interrompue : nouvelle tentative…`, "warning");
          delete state.calls[call.peer];
          try { call.close(); } catch (_) {}
          setTimeout(() => connectToPeer(call.peer, { force: true }), 1500 * tries);
        } else {
          showToast(`Impossible de relier la vidéo avec ${name} : vos réseaux nécessitent un relais TURN (voir README)`, "danger");
        }
      }
      if (st === "connected" || st === "completed") state.callRetries[call.peer] = 0;
    });
    return true;
  };
  if (!attach()) setTimeout(attach, 500);
}

/* Établit l'appel caméra avec un participant.
   Une seule des deux parties appelle (l'identifiant le plus grand), pour éviter
   deux appels croisés ; l'autre prend le relais si rien n'arrive. */
state.callRetries = {};
state.callWatchdogs = {};
function connectToPeer(pid, { force = false } = {}) {
  if (!pid || pid === state.myPeerId || !state.localStream) return;
  if (!state.peer || !state.peerOpen) { state.pendingPeers?.add(pid); return; }

  const existing = state.calls[pid];
  if (existing && existing.open && !force) return;
  const iAmCaller = force || state.myPeerId > pid;

  if (iAmCaller) {
    if (existing && !force) return; // appel déjà en cours de négociation
    const call = state.peer.call(pid, state.localStream, {
      metadata: { type: "camera", userName: state.user.name },
    });
    if (call) setupCall(call, "camera");
  }
  // Filet de sécurité : sans vidéo au bout de 12 s, on (re)lance l'appel nous-mêmes
  clearTimeout(state.callWatchdogs[pid]);
  state.callWatchdogs[pid] = setTimeout(() => {
    if (!state.currentMeetingId || state.remoteStreams[pid]) return;
    if (!(state.allParticipants || []).some((p) => p.peerId === pid)) return;
    console.log("⏱️ Pas de vidéo de", pid, "→ nouvel appel");
    const old = state.calls[pid];
    delete state.calls[pid];
    try { old?.close(); } catch (_) {}
    connectToPeer(pid, { force: true });
  }, iAmCaller ? 12000 : 8000);

  // Si je partage déjà mon écran, le nouveau venu doit le recevoir aussi
  if (state.isScreenSharing && state.screenStream && !state.screenCalls?.[pid]) {
    const screenCall = state.peer.call(pid, state.screenStream, {
      metadata: { type: "screen", userName: state.user.name },
    });
    if (screenCall) setupCall(screenCall, "screen");
  }
}

/* Tuile de partage d'écran distante (séparée de la caméra) */
function addRemoteScreenVideo(peerId, stream) {
  const tileId = `screen-tile-${peerId}`;
  if (document.getElementById(tileId)) return;
  const grid = $("#videos-grid");
  const name = state.participantNames[peerId] || "Participant";
  const tile = document.createElement("div");
  tile.className = "video-tile remote presenter";
  tile.id = tileId;
  tile.innerHTML = `
    <video autoplay playsinline></video>
    <div class="video-label">
      <i class="bi bi-display"></i>
      <span>Écran de ${escapeHtml(name)}</span>
    </div>`;
  grid.appendChild(tile);
  tile.querySelector("video").srcObject = stream;

  // Activer le mode présentation pour cet écran
  grid.classList.add("presenting");
}

function removeRemoteScreenVideo(peerId) {
  const el = document.getElementById(`screen-tile-${peerId}`);
  if (el) el.remove();
  if (state.remoteScreenStreams) delete state.remoteScreenStreams[peerId];

  // Si plus aucun écran partagé, désactiver mode présentation
  if (!document.querySelector(".video-tile.presenter")) {
    $("#videos-grid").classList.remove("presenting");
  }
}

function addRemoteVideo(peerId, stream) {
  if (document.getElementById(`tile-${peerId}`)) return;
  const grid = $("#videos-grid");
  const name = state.participantNames[peerId] || "Participant";
  const tile = document.createElement("div");
  tile.className = "video-tile remote";
  tile.id = `tile-${peerId}`;
  tile.dataset.peer = peerId;
  tile.innerHTML = `
    <video autoplay playsinline></video>
    <div class="tile-avatar"><span>${escapeHtml(initials(name))}</span></div>
    <div class="tile-tools">
      <button data-tile-action="pin" title="Épingler"><i class="bi bi-pin-angle-fill"></i></button>
      <button data-tile-action="fullscreen" title="Plein écran"><i class="bi bi-arrows-fullscreen"></i></button>
      <button data-tile-action="pip" title="Image dans l'image"><i class="bi bi-pip"></i></button>
    </div>
    <div class="video-label">
      <i class="bi bi-person-circle"></i>
      <span class="tile-name">${escapeHtml(name)}</span>
      <i class="bi bi-mic-mute-fill tile-mic ms-auto" style="display:none;"></i>
      <i class="bi bi-reception-4 net-ind" title="Qualité de connexion"></i>
    </div>`;
  grid.appendChild(tile);
  tile.querySelector("video").srcObject = stream;
  updateParticipantsCount();
  onRemoteStreamAdded(peerId, stream, tile);
}

function removeRemoteVideo(peerId) {
  const el = document.getElementById(`tile-${peerId}`);
  if (el) el.remove();
  onRemoteStreamRemoved(peerId);
  delete state.calls[peerId];
  delete state.remoteStreams[peerId];
  updateParticipantsCount();
}

function updateParticipantsCount() {
  $("#participants-count").textContent = 1 + Object.keys(state.remoteStreams).length;
}

/* ==========================================================
   7. PARTICIPANTS — détection des nouveaux pour les appeler
   ------------------------------------------------------------
   Filtre les fantômes : un participant doit avoir un lastSeen
   récent (< 45s). Sinon on l'ignore (probablement crashé/fermé).
   ========================================================== */
function isParticipantActive(data) {
  if (!data.lastSeen) {
    // Pas de lastSeen : c'est probablement très récent (vient d'arriver)
    // On lui laisse le bénéfice du doute si joinedAt < 30s
    const joined = data.joinedAt?.toMillis?.() || Date.now();
    return (Date.now() - joined) < 30000;
  }
  const last = data.lastSeen.toMillis?.() || 0;
  return (Date.now() - last) < 45000; // 45 secondes
}

function initParticipants(meetingId) {
  state.unsubParticipants = db.collection("meetings").doc(meetingId)
    .collection("participants")
    .onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        const data = change.doc.data();
        const pid = data.peerId;
        if (!pid || pid === state.myPeerId) return;

        if (change.type === "added" || change.type === "modified") {
          // Vérifier si le participant est actif (heartbeat récent)
          if (!isParticipantActive(data)) {
            console.log("👻 Participant fantôme ignoré :", data.name, pid);
            // Si on a déjà un call avec lui, on le ferme
            if (state.calls[pid]) {
              state.calls[pid].close();
              delete state.calls[pid];
            }
            if (state.screenCalls && state.screenCalls[pid]) {
              state.screenCalls[pid].close();
              delete state.screenCalls[pid];
            }
            removeRemoteVideo(pid);
            removeRemoteScreenVideo(pid);
            return;
          }

          state.participantNames[pid] = data.name;
          if (!state.calls[pid]) connectToPeer(pid);
        }
        if (change.type === "removed") {
          if (state.calls[pid]) state.calls[pid].close();
          if (state.screenCalls && state.screenCalls[pid]) state.screenCalls[pid].close();
          removeRemoteVideo(pid);
          removeRemoteScreenVideo(pid);
          delete state.participantNames[pid];
        }
      });
    });

  // Vérification périodique : on retire les fantômes même s'ils ne déclenchent pas "modified"
  if (state.ghostCheckInterval) clearInterval(state.ghostCheckInterval);
  state.ghostCheckInterval = setInterval(async () => {
    if (!state.currentMeetingId) return;
    try {
      const snap = await db.collection("meetings").doc(state.currentMeetingId)
        .collection("participants").get();

      snap.docs.forEach(async (doc) => {
        const data = doc.data();
        const pid = data.peerId;
        if (!pid || pid === state.myPeerId) return;

        if (!isParticipantActive(data)) {
          // Fantôme : retirer de l'UI
          if (state.calls[pid]) {
            state.calls[pid].close();
            delete state.calls[pid];
          }
          if (state.screenCalls && state.screenCalls[pid]) {
            state.screenCalls[pid].close();
            delete state.screenCalls[pid];
          }
          removeRemoteVideo(pid);
          removeRemoteScreenVideo(pid);
          delete state.participantNames[pid];

          // Tentative de suppression dans Firestore (peut échouer si pas d'autorisation)
          try {
            await doc.ref.delete();
            console.log("🧹 Fantôme supprimé de Firestore :", data.name);
          } catch (e) { /* ignore */ }
        }
      });
    } catch (e) { /* ignore */ }
  }, 20000); // toutes les 20 secondes
}

/* ==========================================================
   8. CONTRÔLES
   ========================================================== */
$("#toggle-mic").addEventListener("click", () => setMic(!state.micOn));
$("#toggle-cam").addEventListener("click", () => setCam(!state.camOn));

function setMic(on, { silent = false, force = false } = {}) {
  if (!state.localStream) return;
  if (on && !state.rawStream?.getAudioTracks()[0]) { if (!silent) showToast("Aucun micro détecté", "warning"); return; }
  if (on && !force && !canDo("unmuteEnabled")) { if (!silent) showToast("L'organisateur a désactivé la réactivation des micros", "warning"); return; }
  state.micOn = on;
  applyTrackEnabled();
  updateControlsUI();
  syncMyState();
}

function setCam(on) {
  if (!state.localStream) return;
  if (on && !state.rawStream?.getVideoTracks()[0]) { showToast("Aucune caméra détectée", "warning"); return; }
  state.camOn = on;
  applyTrackEnabled();
  updateControlsUI();
  syncMyState();
}

$("#toggle-screen").addEventListener("click", async () => {
  if (state.isScreenSharing) await stopScreenShare();
  else if (!canDo("shareEnabled")) showToast("L'organisateur a désactivé le partage d'écran", "warning");
  else await startScreenShare();
});

async function startScreenShare() {
  try {
    // Capturer l'écran (sans audio pour éviter feedback)
    // Audio de l'onglet / du système partagé si l'utilisateur le coche (vidéos, sons)
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: "always",
        frameRate: { ideal: 15, max: 30 }
      },
      audio: true
    });

    const screenTrack = state.screenStream.getVideoTracks()[0];

    // ★ NOUVELLE APPROCHE : ouvrir un APPEL SÉPARÉ pour l'écran
    // La caméra reste intacte sur l'appel principal
    state.screenCalls = state.screenCalls || {};

    // Récupérer la liste des participants connectés
    const peerIds = Object.keys(state.calls);
    let success = 0;

    for (const peerId of peerIds) {
      try {
        // Fermer l'ancien appel écran s'il existait
        if (state.screenCalls[peerId]) {
          state.screenCalls[peerId].close();
          delete state.screenCalls[peerId];
        }

        // Ouvrir une NOUVELLE connexion dédiée à l'écran (metadata pour distinguer)
        const screenCall = state.peer.call(peerId, state.screenStream, {
          metadata: { type: "screen", userName: state.user.name }
        });
        if (screenCall) {
          setupCall(screenCall, "screen");
          success++;
        }
      } catch (err) {
        console.error("[screenshare] erreur peer", peerId, err);
      }
    }

    // Aperçu local : ajouter une tuile pour l'écran (en plus de la caméra)
    const grid = $("#videos-grid");
    let localScreenTile = document.getElementById("local-screen-tile");
    if (!localScreenTile) {
      localScreenTile = document.createElement("div");
      localScreenTile.className = "video-tile presenter";
      localScreenTile.id = "local-screen-tile";
      localScreenTile.innerHTML = `
        <video autoplay playsinline muted></video>
        <div class="video-label">
          <i class="bi bi-display"></i>
          <span>Votre écran</span>
        </div>`;
      grid.appendChild(localScreenTile);
    }
    localScreenTile.querySelector("video").srcObject = state.screenStream;

    state.isScreenSharing = true;
    updateControlsUI();

    // Activer mode présentation pour mettre l'écran en grand
    grid.classList.add("presenting");

    // Signaler aux autres via Firestore
    if (firebaseReady && state.currentMeetingId && state.myPeerId) {
      try {
        await db.collection("meetings").doc(state.currentMeetingId)
          .update({ presenterId: state.myPeerId });
      } catch (e) { console.warn(e); }
    }

    screenTrack.onended = () => stopScreenShare();

    showToast(`📺 Partage d'écran actif${peerIds.length > 0 ? ` (${success}/${peerIds.length} participants)` : ""}`, "success");
  } catch (err) {
    console.error(err);
    if (err.name !== "NotAllowedError") {
      showToast("Partage d'écran : " + err.message, "warning");
    }
  }
}

async function stopScreenShare() {
  // Arrêter le stream d'écran
  if (state.screenStream) {
    state.screenStream.getTracks().forEach((t) => t.stop());
    state.screenStream = null;
  }

  // Fermer tous les appels écran (la caméra reste intacte !)
  if (state.screenCalls) {
    for (const peerId in state.screenCalls) {
      try {
        state.screenCalls[peerId].close();
      } catch (_) {}
    }
    state.screenCalls = {};
  }

  // Retirer la tuile écran locale
  const localScreenTile = document.getElementById("local-screen-tile");
  if (localScreenTile) localScreenTile.remove();

  state.isScreenSharing = false;
  updateControlsUI();

  // Désactiver mode présentation si plus aucun écran partagé
  if (!document.querySelector(".video-tile.presenter")) {
    $("#videos-grid").classList.remove("presenting");
  }

  // Effacer le signal Firestore
  if (firebaseReady && state.currentMeetingId) {
    try {
      const docRef = db.collection("meetings").doc(state.currentMeetingId);
      const snap = await docRef.get();
      if (snap.exists && snap.data().presenterId === state.myPeerId) {
        await docRef.update({ presenterId: firebase.firestore.FieldValue.delete() });
      }
    } catch (e) { console.warn(e); }
  }

  showToast("Partage d'écran arrêté", "secondary");
}

/* === MODE PRÉSENTATION (style Teams/Google Meet) === */
function activatePresentationMode(presenterId) {
  const grid = $("#videos-grid");
  grid.classList.add("presenting");

  // Retirer .presenter de tous les tiles
  document.querySelectorAll(".video-tile.presenter").forEach((el) => el.classList.remove("presenter"));

  // Marquer le bon tile comme presenter
  if (presenterId === state.myPeerId || presenterId === "local") {
    $("#local-tile").classList.add("presenter");
  } else {
    const tile = document.getElementById(`screen-tile-${presenterId}`) || document.getElementById(`tile-${presenterId}`);
    if (tile) tile.classList.add("presenter");
  }
}

function deactivatePresentationMode() {
  const grid = $("#videos-grid");
  grid.classList.remove("presenting");
  document.querySelectorAll(".video-tile.presenter").forEach((el) => el.classList.remove("presenter"));
}

/* Listener Firestore : qui partage l'écran ? */
function watchPresenter(meetingId) {
  if (!firebaseReady) return;
  return db.collection("meetings").doc(meetingId)
    .onSnapshot((snap) => {
      if (!snap.exists) return;
      const presenterId = snap.data().presenterId;

      if (presenterId && presenterId !== state.myPeerId) {
        // Quelqu'un d'autre partage
        activatePresentationMode(presenterId);
      } else if (!presenterId && !state.isScreenSharing) {
        // Plus personne ne partage
        deactivatePresentationMode();
      }
    });
}

$("#toggle-record").addEventListener("click", () => {
  if (state.isRecording) stopRecording();
  else startRecording();
});

$("#toggle-chat-btn").addEventListener("click", () => {
  $("#side-panel").classList.toggle("collapsed");
});
$("#toggle-ai-btn").addEventListener("click", () => {
  $("#side-panel").classList.remove("collapsed");
  document.querySelector('[data-bs-target="#ai-pane"]').click();
});

function updateControlsUI() {
  const micBtn = $("#toggle-mic");
  micBtn.classList.toggle("off", !state.micOn);
  micBtn.querySelector("i").className = state.micOn ? "bi bi-mic-fill" : "bi bi-mic-mute-fill";
  $("#local-mic-icon").className = state.micOn
    ? "bi bi-mic-fill ms-auto" : "bi bi-mic-mute-fill ms-auto";

  const camBtn = $("#toggle-cam");
  camBtn.classList.toggle("off", !state.camOn);
  camBtn.querySelector("i").className = state.camOn ? "bi bi-camera-video-fill" : "bi bi-camera-video-off-fill";

  $("#toggle-screen").classList.toggle("active", state.isScreenSharing);

  const recBtn = $("#toggle-record");
  recBtn.classList.toggle("recording", state.isRecording);
  updateRecBadge();

  $("#local-tile").classList.toggle("cam-off", !state.camOn);
  updateMirror();
}

/* ==========================================================
   9. CHAT TEMPS RÉEL
   ========================================================== */
function initChat(meetingId) {
  $("#chat-messages").innerHTML = "";
  state.unsubChat = db.collection("meetings").doc(meetingId)
    .collection("messages").orderBy("createdAt", "asc")
    .onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added") renderChatMessage(change.doc.data());
      });
    });
}

function initDemoChat() {
  $("#chat-messages").innerHTML = "";
  // Affiche les messages déjà stockés en mémoire pour cette réunion
  const msgs = state.demoMessages[state.currentMeetingId] || [];
  msgs.forEach(renderChatMessage);
}

$("#chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text || !state.currentMeetingId) return;
  if (!canDo("chatEnabled")) { showToast("L'organisateur a désactivé le chat", "warning"); return; }
  input.value = "";
  await sendChatMessage({ text });
});

/* Envoi d'un message (texte ou fichier), public ou privé */
async function sendChatMessage(extra) {
  const toSel = $("#chat-to");
  const to = toSel.value || null;
  const toName = to ? toSel.selectedOptions[0].textContent : null;
  const base = {
    text: "", ...extra,
    userId: state.user.uid, userName: state.user.name,
    ...(to ? { to, toName } : {}),
  };

  if (firebaseReady) {
    try {
      await db.collection("meetings").doc(state.currentMeetingId)
        .collection("messages").add({
          ...base,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
      console.error(err);
      showToast("Message non envoyé", "danger");
    }
  } else {
    const msg = { ...base, createdAt: { toDate: () => new Date() } };
    if (!state.demoMessages[state.currentMeetingId]) state.demoMessages[state.currentMeetingId] = [];
    state.demoMessages[state.currentMeetingId].push(msg);
    renderChatMessage(msg);
  }
}

/* Rend les liens cliquables dans un texte déjà échappé */
function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderChatMessage(msg) {
  const isOwn = msg.userId === state.user.uid;
  // Message privé : visible seulement par l'expéditeur et le destinataire
  if (msg.to && !isOwn && msg.to !== state.user.uid) return;

  const time = msg.createdAt?.toDate?.()
    .toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) || "";

  const container = $("#chat-messages");
  if (container.querySelector(".text-center.text-muted")) container.innerHTML = "";

  let privacy = "";
  if (msg.to) {
    privacy = isOwn
      ? ` · <i class="bi bi-lock-fill"></i> privé à ${escapeHtml(msg.toName || "")}`
      : ` · <i class="bi bi-lock-fill"></i> privé`;
  }

  let body = linkify(escapeHtml(msg.text || ""));
  if (msg.fileUrl && /^https:\/\//.test(msg.fileUrl)) {
    const size = msg.fileSize ? ` (${(msg.fileSize / 1024 / 1024).toFixed(1)} Mo)` : "";
    body = `<a href="${escapeHtml(msg.fileUrl)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-file-earmark-arrow-down-fill"></i> ${escapeHtml(msg.fileName || "Fichier")}</a>${size}`;
  }

  const div = document.createElement("div");
  div.className = `chat-msg ${isOwn ? "own" : ""} ${msg.to ? "private" : ""}`;
  div.innerHTML = `
    <div class="msg-meta">${escapeHtml(msg.userName || "Anonyme")} · ${time}${privacy}</div>
    <div class="msg-bubble">${body}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  onChatMessageRendered(msg, isOwn);
}

/* ==========================================================
   10. ENREGISTREMENT AUDIO
   ========================================================== */
function startRecording() {
  if (!state.localStream) return;
  if (!state.isOrganizer && !canDo("recordEnabled")) {
    showToast("Seul l'organisateur peut enregistrer cette réunion", "warning");
    return;
  }
  // Audio mixé de TOUS les participants (et plus seulement le micro local)
  const audioStream = Recorder.start();
  state.recordedChunks = [];

  let options = { mimeType: "audio/webm" };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) options = {};

  state.mediaRecorder = new MediaRecorder(audioStream, options);
  state.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) state.recordedChunks.push(e.data); };
  state.mediaRecorder.onstop = handleRecordingStop;
  state.mediaRecorder.start(1000);
  state.isRecording = true;
  updateControlsUI();
  showToast("Enregistrement démarré : la vidéo sera téléchargée à l'arrêt", "primary");
}

function stopRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop();
    Recorder.stop();
    state.isRecording = false;
    updateControlsUI();
    showToast("Enregistrement terminé", "success");
  }
}

async function handleRecordingStop() {
  const blob = new Blob(state.recordedChunks, { type: "audio/webm" });
  state.recordedChunks = [];
  state.lastRecordedBlob = blob;

  if (!state.currentMeetingId || !firebaseReady) return;

  try {
    const path = `audio-recordings/${state.currentMeetingId}/${Date.now()}.webm`;
    const ref = storage.ref(path);
    await ref.put(blob);
    const url = await ref.getDownloadURL();
    await db.collection("meetings").doc(state.currentMeetingId).update({
      lastAudioUrl: url, lastAudioPath: path,
      lastAudioAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    showToast("Audio sauvegardé sur Firebase Storage", "success");
  } catch (err) {
    console.error(err);
    showToast("Erreur upload audio (gardé en mémoire)", "warning");
  }
}

/* ==========================================================
   11. MODULE IA — Whisper + GPT
   ========================================================== */
$("#generate-report-btn").addEventListener("click", generateReport);

async function generateReport() {
  if (!state.currentMeetingId) return;

  const statusEl = $("#ai-status");
  statusEl.classList.remove("d-none");
  statusEl.className = "alert alert-info small mb-3";
  statusEl.textContent = "🧠 Analyse de la réunion en cours...";

  try {
    let transcript = "";
    let source = "";

    // PRIORITÉ 1 : Transcription locale (la plus fraîche, en mémoire)
    if (state.localTranscriptEntries && state.localTranscriptEntries.length > 0) {
      transcript = state.localTranscriptEntries
        .map(e => `${e.userName} : ${e.text}`)
        .join("\n");
      source = `transcription vocale locale (${state.localTranscriptEntries.length} interventions)`;
    }

    // PRIORITÉ 2 : Récupérer depuis Firestore (pour avoir les voix des autres participants)
    if (firebaseReady && state.currentMeetingId) {
      statusEl.textContent = "📥 Récupération de la transcription complète...";
      try {
        const snap = await db.collection("meetings").doc(state.currentMeetingId)
          .collection("transcript").orderBy("createdAt", "asc").get();

        if (!snap.empty) {
          const firestoreTranscript = snap.docs.map(d => {
            const data = d.data();
            return `${data.userName} : ${data.text}`;
          }).join("\n");

          // Utiliser Firestore si plus complet que le local
          if (firestoreTranscript.length > transcript.length) {
            transcript = firestoreTranscript;
            source = `transcription vocale (${snap.size} interventions, ${new Set(snap.docs.map(d => d.data().userId)).size} participant(s))`;
          }
        }
      } catch (err) {
        console.warn("Lecture Firestore transcript:", err);
      }
    }

    // PRIORITÉ 3 : Whisper si clé OpenAI dispo
    if (!transcript && state.lastRecordedBlob && OPENAI_CONFIG.apiKey) {
      statusEl.textContent = "🎙️ Transcription Whisper en cours...";
      transcript = await transcribeWithWhisper(state.lastRecordedBlob);
      source = "OpenAI Whisper";
    }

    // PRIORITÉ 4 : Chat (dernier recours)
    if (!transcript) {
      const chatText = await getChatTranscript();
      if (chatText && chatText.trim().length > 20) {
        transcript = chatText;
        source = "messages du chat";
      }
    }

    const sharedNotes = ($("#notes-area")?.value || "").trim();
    if (sharedNotes) {
      transcript += `\n\nNOTES PARTAGÉES PAR LES PARTICIPANTS :\n${sharedNotes}`;
      source += (source ? " + " : "") + "notes partagées";
    }

    if (!transcript || transcript.trim().length < 20) {
      statusEl.className = "alert alert-warning small mb-3";
      statusEl.innerHTML = "⚠️ Pas assez de contenu détecté.<br>👉 Démarrez la <strong>transcription</strong> et parlez clairement, ou écrivez dans le chat.";
      return;
    }

    statusEl.textContent = "✨ Génération du compte rendu...";

    // Priorité : Gemini > OpenAI > Local
    let report;
    let aiUsed = "résumé local";
    try {
      if (GEMINI_CONFIG.apiKey) {
        statusEl.textContent = "🤖 Gemini analyse la conversation...";
        report = await summarizeWithGemini(transcript);
        aiUsed = "Gemini AI";
      } else if (OPENAI_CONFIG.apiKey) {
        statusEl.textContent = "🤖 GPT analyse la conversation...";
        report = await summarizeWithGPT(transcript);
        aiUsed = "OpenAI GPT";
      } else {
        report = smartLocalReport(transcript);
      }
    } catch (aiErr) {
      console.warn("Échec IA, fallback local :", aiErr);
      report = smartLocalReport(transcript);
      aiUsed = "résumé local (IA indisponible)";
    }

    displayReport(report);

    state.lastReportId = null;
    if (firebaseReady) {
      const reportRef = await db.collection("reports").add({
        meetingId: state.currentMeetingId,
        meetingTitle: state.currentMeetingTitle,
        ownerId: state.user.uid,
        transcript: transcript.slice(0, 50000),
        ...report,
        source,
        aiUsed,
        simulated: !GEMINI_CONFIG.apiKey && !OPENAI_CONFIG.apiKey,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      state.lastReportId = reportRef.id;
      await db.collection("meetings").doc(state.currentMeetingId).update({ hasReport: true });
    }

    statusEl.className = "alert alert-success small mb-3";
    statusEl.innerHTML = `✅ Compte rendu généré par <strong>${aiUsed}</strong><br><small class="text-muted">Source : ${source}</small>`;
    return report;
  } catch (err) {
    console.error(err);
    statusEl.className = "alert alert-danger small mb-3";
    statusEl.textContent = "❌ Erreur : " + (err.message || "voir la console");
  }
}

async function transcribeWithWhisper(blob) {
  const fd = new FormData();
  fd.append("file", blob, "audio.webm");
  fd.append("model", OPENAI_CONFIG.whisperModel);
  fd.append("language", "fr");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_CONFIG.apiKey}` },
    body: fd,
  });
  if (!res.ok) throw new Error("Whisper : " + (await res.text()));
  const data = await res.json();
  return data.text || "";
}

async function summarizeWithGPT(transcript) {
  const prompt = `Tu es un assistant expert en compte rendu de réunion d'entreprise.
À partir du texte ci-dessous, produis un JSON STRICT avec cette structure exacte :
{
  "summary": "résumé synthétique en 3-5 phrases",
  "decisions": ["décision 1", "décision 2"],
  "actions": ["action attribuée 1", "action attribuée 2"],
  "keypoints": ["point important 1", "point important 2"]
}

Réponds UNIQUEMENT avec le JSON, sans markdown, sans préambule.

TEXTE :
"""
${transcript.slice(0, 12000)}
"""`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_CONFIG.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error("GPT : " + (await res.text()));
  const data = await res.json();
  const txt = data.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(txt); }
  catch { return simulatedReport(transcript); }
}

/* ==========================================================
   GEMINI — Génération du compte rendu de qualité humaine
   ========================================================== */
async function summarizeWithGemini(transcript) {
  const prompt = `Tu es un assistant professionnel expert en rédaction de comptes rendus de réunion d'entreprise.

À partir de la transcription ci-dessous (format "Nom : phrase"), rédige un compte rendu STRUCTURÉ et NATUREL comme le ferait un secrétaire humain expérimenté. NE liste PAS bêtement les phrases, mais SYNTHÉTISE et REFORMULE intelligemment.

Identifie les participants par leur nom. Reconnais qui a dit quoi quand c'est pertinent. Reformule de manière professionnelle.

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans préambule, exactement avec cette structure :

{
  "summary": "Un résumé fluide et structuré de 4 à 7 phrases qui raconte la réunion comme un humain. Mentionne les participants, les sujets abordés, le contexte, et l'issue. Style professionnel.",
  "decisions": ["Décision 1 reformulée clairement", "Décision 2..."],
  "actions": ["Action 1 avec si possible le responsable (ex: 'Davi : envoyer la maquette avant vendredi')", "Action 2..."],
  "keypoints": ["Point important 1", "Point important 2..."]
}

RÈGLES IMPORTANTES :
- Si aucune décision n'a été prise, mettre une liste vide []
- Si aucune action explicite, mettre []
- Reformule en français professionnel, pas du langage parlé
- Ne fais PAS de copier-coller des phrases brutes
- Ne mets PAS de markdown (pas de **, pas de ##)
- Réponds en français

TRANSCRIPTION :
"""
${transcript.slice(0, 20000)}
"""`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CONFIG.model}:generateContent?key=${GEMINI_CONFIG.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json"
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Gemini : " + errText);
  }

  const data = await res.json();
  const txt = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

  try {
    const parsed = JSON.parse(txt);
    // Validation/normalisation
    return {
      summary: parsed.summary || "Résumé indisponible",
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      keypoints: Array.isArray(parsed.keypoints) ? parsed.keypoints : []
    };
  } catch (e) {
    console.warn("Parsing Gemini échoué :", txt);
    return smartLocalReport(transcript);
  }
}

async function getChatTranscript() {
  if (firebaseReady) {
    const snap = await db.collection("meetings").doc(state.currentMeetingId)
      .collection("messages").orderBy("createdAt", "asc").get();
    return snap.docs.map((d) => d.data()).filter((m) => !m.to && m.text)
      .map((m) => `${m.userName} : ${m.text}`).join("\n");
  } else {
    const msgs = (state.demoMessages[state.currentMeetingId] || []).filter((m) => !m.to && m.text);
    return msgs.map((m) => `${m.userName} : ${m.text}`).join("\n");
  }
}

/* ==========================================================
   RÉSUMÉ LOCAL INTELLIGENT (sans IA externe)
   - Analyse le texte avec des heuristiques NLP simples
   - Détecte décisions, actions, points-clés par mots-clés français
   ========================================================== */
function smartLocalReport(transcript) {
  // Nettoyer le texte
  const text = transcript.replace(/\s+/g, " ").trim();

  // Découper en phrases (français : ., !, ?, ;)
  const sentences = text.split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 8);

  // Mots-clés français
  const decisionKw = /\b(décide|décidé|décidons|valid[éaeoi]+|confirm[éaeoi]+|approuv[éaeoi]+|adopt[éaeoi]+|on retient|on choisit|on garde|on opte|c'est acté|c'est ok|d'accord pour|on part sur)\b/i;
  const actionKw = /\b(doit|devra|devrons|il faut|faudra|à faire|prévoir|organiser|envoyer|préparer|contacter|appeler|écrire|rédiger|planifier|programmer|suivre|relancer|finaliser|livrer|fournir|partager|transmettre|je m'occupe|je prends|je vais|je ferai|tu peux|peux-tu|on doit)\b/i;
  const importantKw = /\b(important|essentiel|crucial|prioritaire|urgent|attention|noter|à retenir|point clé|clé|risque|problème|enjeu|opportunité|objectif|but|cible|deadline|échéance|budget|coût|investissement)\b/i;

  const decisions = [];
  const actions = [];
  const keypoints = [];

  sentences.forEach(s => {
    const clean = s.replace(/^[^:]+:\s*/, "").trim(); // enlever "Nom: "
    if (clean.length < 8 || clean.length > 250) return;

    if (decisionKw.test(clean)) decisions.push(clean);
    else if (actionKw.test(clean)) actions.push(clean);
    else if (importantKw.test(clean)) keypoints.push(clean);
  });

  // Dédupliquer (proximité approximative)
  const dedupe = (arr, max) => {
    const seen = new Set();
    const result = [];
    for (const item of arr) {
      const key = item.toLowerCase().slice(0, 40);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
        if (result.length >= max) break;
      }
    }
    return result;
  };

  // Résumé : prendre les 3-4 premières phrases significatives
  const summarySentences = sentences
    .filter(s => s.replace(/^[^:]+:\s*/, "").trim().length > 20)
    .slice(0, 4)
    .map(s => s.replace(/^[^:]+:\s*/, "").trim());

  const nbParticipants = 1 + Object.keys(state.remoteStreams).length;
  const wordCount = text.split(/\s+/).length;

  let summary = `Réunion "${state.currentMeetingTitle}" — ${nbParticipants} participant${nbParticipants > 1 ? "s" : ""}, environ ${wordCount} mots échangés. `;
  if (summarySentences.length > 0) {
    summary += summarySentences.join(" ");
  } else {
    summary += "Échanges courts entre les participants.";
  }

  return {
    summary: summary.slice(0, 600),
    decisions: dedupe(decisions, 5).length
      ? dedupe(decisions, 5)
      : ["Aucune décision explicite détectée dans la transcription"],
    actions: dedupe(actions, 6).length
      ? dedupe(actions, 6)
      : ["Aucune action explicite détectée"],
    keypoints: dedupe(keypoints, 5).length
      ? dedupe(keypoints, 5)
      : (summarySentences.slice(0, 3).length ? summarySentences.slice(0, 3) : ["Discussion générale entre participants"])
  };
}

// Ancien alias pour compatibilité
function simulatedReport(t) { return smartLocalReport(t); }

/* ==========================================================
   TRANSCRIPTION EN DIRECT — Web Speech API (gratuit Chrome)
   ------------------------------------------------------------
   L'ORGANISATEUR active la transcription depuis son interface.
   Tous les participants démarrent automatiquement leur propre
   reconnaissance vocale en arrière-plan (silencieux, pas d'UI).
   Les paroles de chacun sont envoyées dans Firestore et fusion-
   nées dans la transcription collective.
   ========================================================== */
state.recognition = null;
state.liveTranscript = "";
state.isTranscribing = false;
state.isOrganizer = false;       // Vrai si l'utilisateur est créateur de la réunion
state.autoTranscribing = false;  // Vrai si lancé automatiquement (non-organisateur)

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const recognition = new SpeechRecognition();
  recognition.lang = "fr-FR";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = "";

  recognition.onresult = async (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.trim();
      if (event.results[i].isFinal) {
        if (transcript.length < 2) continue;
        finalText += transcript + " ";

        // === TOUJOURS sauvegarder en local (sécurité) ===
        if (!state.localTranscriptEntries) state.localTranscriptEntries = [];
        state.localTranscriptEntries.push({
          text: transcript,
          userId: state.user.uid,
          userName: state.user.name,
          timestamp: Date.now(),
        });
        // Reconstruire liveTranscript pour les fonctions qui l'utilisent
        state.liveTranscript = state.localTranscriptEntries
          .map(e => `${e.userName} : ${e.text}`)
          .join("\n");

        // === Envoi dans Firestore pour partage temps réel ===
        if (firebaseReady && state.currentMeetingId) {
          try {
            await db.collection("meetings").doc(state.currentMeetingId)
              .collection("transcript").add({
                text: transcript,
                userId: state.user.uid,
                userName: state.user.name,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              });
          } catch (err) {
            console.warn("Transcript Firestore error:", err);
          }
        }

        console.log("📝 Transcrit:", transcript);
      } else {
        interim += transcript;
      }
    }
    updateLiveTranscriptDisplay(interim);
  };

  recognition.onerror = (event) => {
    console.warn("Speech recognition error:", event.error);
    if (event.error === "not-allowed") {
      showToast("Micro non autorisé pour la transcription", "danger");
      stopTranscription();
    } else if (event.error === "no-speech") {
      // Normal, on continue
    } else if (event.error === "aborted") {
      // Normal lors d'un stop manuel
    } else {
      showToast("Erreur reconnaissance : " + event.error, "warning");
    }
  };

  recognition.onend = () => {
    // Auto-redémarrage si on est toujours en mode actif
    if (state.isTranscribing) {
      try { recognition.start(); } catch (_) {}
    }
  };

  return recognition;
}

function updateLiveTranscriptDisplay(interimText = "") {
  const el = $("#live-transcript-text");

  // Construire l'affichage : transcriptions persistées dans state.transcriptEntries
  let html = "";
  if (state.transcriptEntries && state.transcriptEntries.length > 0) {
    html = state.transcriptEntries.map(entry => {
      const isMe = entry.userId === state.user?.uid;
      const color = isMe ? "var(--primary)" : "#198754";
      return `<div style="margin-bottom:0.4rem;"><strong style="color:${color};">${escapeHtml(entry.userName)} :</strong> ${escapeHtml(entry.text)}</div>`;
    }).join("");
  }

  // Ajouter le texte interim (en cours de reconnaissance)
  if (interimText) {
    html += `<div style="opacity:0.6; font-style:italic;"><strong style="color:var(--primary);">${escapeHtml(state.user?.name || "Vous")} :</strong> ${escapeHtml(interimText)}...</div>`;
  }

  if (!html.trim()) {
    el.innerHTML = '<em class="text-muted">En attente de paroles...</em>';
  } else {
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  renderCaptions(interimText);

  // Mettre à jour le transcript complet pour le compte rendu final
  if (state.transcriptEntries) {
    state.liveTranscript = state.transcriptEntries
      .map(e => `${e.userName} : ${e.text}`)
      .join("\n");
  }
}

/* === Écoute des transcriptions de TOUS les participants === */
function initTranscriptSync(meetingId) {
  if (!firebaseReady) return null;
  state.transcriptEntries = [];

  return db.collection("meetings").doc(meetingId)
    .collection("transcript")
    .orderBy("createdAt", "asc")
    .onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data();
          state.transcriptEntries.push({
            id: change.doc.id,
            text: data.text,
            userId: data.userId,
            userName: data.userName,
            timestamp: data.createdAt?.toMillis?.() || Date.now(),
          });
        }
      });
      state.transcriptEntries.sort((a, b) => a.timestamp - b.timestamp);
      updateLiveTranscriptDisplay();
    });
}

/* === Listener: l'organisateur a-t-il activé la transcription ? === */
function watchTranscriptionMode(meetingId) {
  if (!firebaseReady) return null;
  return db.collection("meetings").doc(meetingId)
    .onSnapshot(async (snap) => {
      if (!snap.exists) return;
      const data = snap.data();
      const enabled = !!data.transcriptionActive;

      // L'organisateur a activé → on démarre automatiquement, sans UI
      if (enabled && !state.isTranscribing && !state.isOrganizer) {
        await autoStartTranscription();
      }
      // L'organisateur a désactivé → on coupe
      else if (!enabled && state.autoTranscribing) {
        autoStopTranscription();
      }
    });
}

/* === Démarrage automatique (silencieux total, pour les non-organisateurs) === */
async function autoStartTranscription() {
  if (!state.recognition) {
    state.recognition = initSpeechRecognition();
    if (!state.recognition) {
      console.warn("Web Speech API indisponible");
      return;
    }
  }
  try {
    state.isTranscribing = true;
    state.autoTranscribing = true;
    state.recognition.start();
    // AUCUN toast, AUCUNE notification visible
  } catch (err) {
    console.warn(err);
  }
}

function autoStopTranscription() {
  state.autoTranscribing = false;
  state.isTranscribing = false;
  if (state.recognition) {
    try { state.recognition.stop(); } catch (_) {}
  }
  // AUCUN toast
}

/* === Démarrage manuel (par l'organisateur) === */
async function startTranscription() {
  if (!state.isOrganizer) return; // sécurité, mais ce cas ne devrait pas arriver (bouton caché)

  if (!state.recognition) {
    state.recognition = initSpeechRecognition();
    if (!state.recognition) {
      showToast("Web Speech API non disponible. Utilisez Chrome/Edge.", "danger");
      return;
    }
  }

  try {
    state.isTranscribing = true;

    // 1. Démarrer ma propre reconnaissance
    state.recognition.start();

    // 2. Activer le mode pour TOUS les autres participants via Firestore
    if (firebaseReady && state.currentMeetingId) {
      try {
        await db.collection("meetings").doc(state.currentMeetingId)
          .update({ transcriptionActive: true });
      } catch (e) {
        console.warn("Impossible de signaler aux autres :", e);
      }
    }

    $("#live-transcription-section").style.display = "";
    $("#toggle-transcription-btn").classList.remove("btn-success");
    $("#toggle-transcription-btn").classList.add("btn-danger");
    $("#toggle-transcription-btn").querySelector("i").className = "bi bi-stop-circle-fill me-2";
    $("#transcription-btn-label").textContent = "Arrêter la transcription";
    showToast("🎙️ Transcription activée", "success");
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes("already started")) {
      // Déjà en cours
    } else {
      showToast("Erreur : " + err.message, "danger");
    }
  }
}

async function stopTranscription() {
  state.isTranscribing = false;
  state.autoTranscribing = false;
  if (state.recognition) {
    try { state.recognition.stop(); } catch (_) {}
  }

  // Si organisateur : désactiver pour tous via Firestore
  if (state.isOrganizer && firebaseReady && state.currentMeetingId) {
    try {
      await db.collection("meetings").doc(state.currentMeetingId)
        .update({ transcriptionActive: false });
    } catch (e) { console.warn(e); }
  }

  $("#toggle-transcription-btn").classList.remove("btn-danger");
  $("#toggle-transcription-btn").classList.add("btn-success");
  $("#toggle-transcription-btn").querySelector("i").className = "bi bi-mic-fill me-2";
  $("#transcription-btn-label").textContent = state.isOrganizer ? "Reprendre la transcription" : "Réservé à l'organisateur";
  const status = $("#transcription-status");
  if (status) status.innerHTML = '<i class="bi bi-pause-fill"></i> EN PAUSE';
  showToast("Transcription arrêtée", "secondary");
}

// Bouton démarrer/arrêter transcription
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("toggle-transcription-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      if (state.isTranscribing) stopTranscription();
      else startTranscription();
    });
  }
  const clearBtn = document.getElementById("clear-transcript-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.liveTranscript = "";
      updateLiveTranscriptDisplay();
      showToast("Transcription effacée", "secondary");
    });
  }
});

function displayReport(r) {
  // Stocker le dernier rapport généré pour l'export
  state.lastReport = r;

  $("#ai-summary").innerHTML = escapeHtml(r.summary || "—");
  $("#ai-decisions").innerHTML = (r.decisions || []).length
    ? r.decisions.map((d) => `<li>${escapeHtml(d)}</li>`).join("")
    : '<li class="text-muted"><em>Aucune décision</em></li>';
  $("#ai-actions").innerHTML = (r.actions || []).length
    ? r.actions.map((a) => `<li>${escapeHtml(a)}</li>`).join("")
    : '<li class="text-muted"><em>Aucune action</em></li>';
  $("#ai-keypoints").innerHTML = (r.keypoints || []).length
    ? r.keypoints.map((k) => `<li>${escapeHtml(k)}</li>`).join("")
    : '<li class="text-muted"><em>Aucun point</em></li>';

  // Afficher les boutons d'export
  $("#export-buttons").style.display = "";
}

function resetAIPanel() {
  $("#ai-summary").innerHTML = '<em class="text-muted">Aucun résumé disponible.</em>';
  $("#ai-decisions").innerHTML = '<li class="text-muted"><em>—</em></li>';
  $("#ai-actions").innerHTML = '<li class="text-muted"><em>—</em></li>';
  $("#ai-keypoints").innerHTML = '<li class="text-muted"><em>—</em></li>';
  $("#ai-status").classList.add("d-none");
  const exp = $("#export-buttons");
  if (exp) exp.style.display = "none";
  state.lastReport = null;
}

/* ==========================================================
   EXPORT DU COMPTE RENDU — PDF & WORD
   ========================================================== */

// Récupérer les infos sur la réunion pour l'export
function getReportMeta() {
  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
  const timeStr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  // Récupérer les participants depuis les transcriptions
  const participants = new Set();
  if (state.localTranscriptEntries) {
    state.localTranscriptEntries.forEach(e => participants.add(e.userName));
  }
  if (state.transcriptEntries) {
    state.transcriptEntries.forEach(e => participants.add(e.userName));
  }
  if (participants.size === 0 && state.user) {
    participants.add(state.user.name);
  }

  return {
    title: state.currentMeetingTitle || "Réunion",
    dateStr,
    timeStr,
    organizerName: state.user?.name || "Organisateur",
    participants: Array.from(participants),
    meetingId: state.currentMeetingId || "",
  };
}

/* ===== EXPORT PDF ===== */
function exportReportPDF() {
  if (!state.lastReport) {
    showToast("Générez d'abord le compte rendu", "warning");
    return;
  }
  exportReportPDFDirect(state.lastReport, getReportMeta());
}

function exportReportPDFDirect(r, meta) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = 0;

  // ====== EN-TÊTE NOIR ÉLÉGANT avec LOGO ======
  doc.setFillColor(15, 22, 38); // bleu nuit foncé comme la charte
  doc.rect(0, 0, pageWidth, 45, "F");

  // Insérer le vrai logo MbokaTech (image base64)
  try {
    doc.addImage(APP_LOGO, "PNG", margin, 8, 28, 28);
  } catch (e) {
    // Fallback : bloc texte
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, 12, 22, 22, 3, 3, "F");
    doc.setTextColor(15, 22, 38);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("M", margin + 11, 26, { align: "center" });
  }

  // Titre app — "Mboka" en blanc, "Tech" en vert
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text("Mboka", margin + 33, 22);
  const mbokaWidth = doc.getTextWidth("Mboka");
  doc.setTextColor(34, 197, 94); // vert MbokaTech
  doc.text("Tech", margin + 33 + mbokaWidth, 22);

  // Slogan
  doc.setTextColor(200, 200, 200);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("CONNECTEZ. COLLABOREZ. RÉUSSISSEZ.", margin + 33, 29);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "italic");
  doc.text("Compte rendu de réunion", margin + 33, 37);

  // Date à droite
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`${meta.dateStr}`, pageWidth - margin, 22, { align: "right" });
  doc.text(`${meta.timeStr}`, pageWidth - margin, 28, { align: "right" });

  // Bande tricolore sous l'en-tête (vert/jaune/rouge)
  doc.setFillColor(34, 197, 94);
  doc.rect(0, 45, pageWidth / 3, 2, "F");
  doc.setFillColor(255, 193, 7);
  doc.rect(pageWidth / 3, 45, pageWidth / 3, 2, "F");
  doc.setFillColor(220, 53, 69);
  doc.rect((pageWidth / 3) * 2, 45, pageWidth / 3, 2, "F");

  y = 60;

  // ====== TITRE RÉUNION ======
  doc.setTextColor(33, 37, 41);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  const titleLines = doc.splitTextToSize(meta.title, contentWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 8;

  // Séparateur
  doc.setDrawColor(13, 110, 253);
  doc.setLineWidth(0.8);
  doc.line(margin, y + 2, margin + 30, y + 2);
  y += 10;

  // ====== INFOS RÉUNION ======
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(96, 94, 92);
  doc.text("ORGANISATEUR :", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(33, 37, 41);
  doc.text(meta.organizerName, margin + 35, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setTextColor(96, 94, 92);
  doc.text("PARTICIPANTS :", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(33, 37, 41);
  const partText = meta.participants.length ? meta.participants.join(", ") : "—";
  const partLines = doc.splitTextToSize(partText, contentWidth - 35);
  doc.text(partLines, margin + 35, y);
  y += partLines.length * 5 + 3;

  if (meta.meetingId) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(96, 94, 92);
    doc.text("ID RÉUNION :", margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(33, 37, 41);
    doc.setFontSize(8);
    doc.text(meta.meetingId, margin + 35, y);
    doc.setFontSize(10);
    y += 8;
  }

  y += 5;

  // ====== FONCTION HELPER POUR LES SECTIONS ======
  function addSection(title, color, icon, content, isList) {
    // Vérifier place restante
    if (y > pageHeight - 40) {
      doc.addPage();
      y = margin;
    }

    // Bandeau titre
    doc.setFillColor(...color);
    doc.roundedRect(margin, y, contentWidth, 9, 1.5, 1.5, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`${icon}  ${title.toUpperCase()}`, margin + 3, y + 6);
    y += 13;

    // Contenu
    doc.setTextColor(33, 37, 41);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");

    if (isList && Array.isArray(content)) {
      if (content.length === 0) {
        doc.setTextColor(150, 150, 150);
        doc.setFont("helvetica", "italic");
        doc.text("Aucun élément", margin + 3, y);
        y += 6;
      } else {
        content.forEach((item) => {
          if (y > pageHeight - 20) { doc.addPage(); y = margin; }
          doc.setFillColor(...color);
          doc.circle(margin + 2.5, y - 1.2, 0.8, "F");
          const lines = doc.splitTextToSize(item, contentWidth - 10);
          doc.text(lines, margin + 7, y);
          y += lines.length * 5 + 1;
        });
      }
    } else {
      const lines = doc.splitTextToSize(content || "—", contentWidth - 6);
      doc.text(lines, margin + 3, y);
      y += lines.length * 5;
    }
    y += 6;
  }

  addSection("Résumé", [13, 110, 253], "📝", r.summary || "—", false);
  addSection("Décisions prises", [25, 135, 84], "✓", r.decisions || [], true);
  addSection("Actions à mener", [255, 153, 0], "→", r.actions || [], true);
  addSection("Points importants", [220, 53, 69], "★", r.keypoints || [], true);

  // ====== PIED DE PAGE ======
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(225, 223, 221);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.setFont("helvetica", "normal");
    doc.text("Généré par MbokaTech — Compte rendu IA", margin, pageHeight - 9);
    doc.text(`Page ${i} / ${pageCount}`, pageWidth - margin, pageHeight - 9, { align: "right" });
  }

  // Téléchargement
  const safeTitle = meta.title.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 40);
  doc.save(`Compte-rendu_${safeTitle}_${Date.now()}.pdf`);
  showToast("PDF téléchargé ✓", "success");
}

/* ===== EXPORT WORD ===== */
async function exportReportWord() {
  if (!state.lastReport) {
    showToast("Générez d'abord le compte rendu", "warning");
    return;
  }
  await exportReportWordDirect(state.lastReport, getReportMeta());
}

async function exportReportWordDirect(r, meta) {
  if (typeof docx === "undefined") {
    showToast("Bibliothèque Word non chargée. Rechargez la page.", "danger");
    return;
  }

  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    AlignmentType, BorderStyle, ShadingType, Table, TableRow,
    TableCell, WidthType, convertInchesToTwip
  } = docx;

  // Helper : créer un paragraphe simple
  const para = (text, opts = {}) => new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: opts.after || 100, before: opts.before || 0 },
    alignment: opts.alignment || AlignmentType.LEFT,
  });

  // Helper : créer un titre de section avec fond coloré
  const sectionHeader = (text, hexColor) => new Paragraph({
    children: [new TextRun({ text, bold: true, size: 24, color: "FFFFFF" })],
    spacing: { before: 300, after: 200 },
    shading: { type: ShadingType.CLEAR, color: "auto", fill: hexColor },
    border: { left: { style: BorderStyle.SINGLE, size: 6, color: hexColor } },
    indent: { left: 200 },
  });

  // Helper : créer une puce de liste avec couleur
  const bulletItem = (text, color) => new Paragraph({
    children: [
      new TextRun({ text: "● ", bold: true, color, size: 22 }),
      new TextRun({ text, size: 22 }),
    ],
    spacing: { after: 100 },
    indent: { left: 360 },
  });

  // Construction du document
  const children = [];

  // === EN-TÊTE ===
  children.push(new Paragraph({
    children: [new TextRun({ text: "MbokaTech", bold: true, size: 40, color: "22C55E" })],
    spacing: { after: 100 },
    alignment: AlignmentType.LEFT,
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Compte rendu de réunion", italics: true, size: 22, color: "605E5C" })],
    spacing: { after: 400 },
  }));

  // Trait coloré sous l'en-tête
  children.push(new Paragraph({
    children: [new TextRun({ text: "" })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: "0D6EFD" } },
    spacing: { after: 300 },
  }));

  // === TITRE RÉUNION ===
  children.push(new Paragraph({
    children: [new TextRun({ text: meta.title, bold: true, size: 36, color: "201F1E" })],
    spacing: { before: 200, after: 200 },
  }));

  // === INFOS RÉUNION (tableau propre) ===
  const infoCell = (label, value, isLabel) => new TableCell({
    children: [new Paragraph({
      children: [new TextRun({
        text: value,
        bold: isLabel,
        size: 20,
        color: isLabel ? "605E5C" : "201F1E"
      })],
      spacing: { before: 80, after: 80 },
    })],
    width: { size: isLabel ? 30 : 70, type: WidthType.PERCENTAGE },
    shading: isLabel ? { fill: "F8F9FA" } : undefined,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
  });

  const infoTable = new Table({
    rows: [
      new TableRow({ children: [infoCell("", "Date", true), infoCell("", `${meta.dateStr} à ${meta.timeStr}`, false)] }),
      new TableRow({ children: [infoCell("", "Organisateur", true), infoCell("", meta.organizerName, false)] }),
      new TableRow({ children: [infoCell("", "Participants", true), infoCell("", meta.participants.join(", ") || "—", false)] }),
      ...(meta.meetingId ? [new TableRow({ children: [infoCell("", "ID Réunion", true), infoCell("", meta.meetingId, false)] })] : []),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });

  children.push(infoTable);
  children.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { after: 300 } }));

  // === SECTION RÉSUMÉ ===
  children.push(sectionHeader("📝  RÉSUMÉ", "0D6EFD"));
  children.push(new Paragraph({
    children: [new TextRun({ text: r.summary || "—", size: 22 })],
    spacing: { after: 200 },
    alignment: AlignmentType.JUSTIFIED,
  }));

  // === SECTION DÉCISIONS ===
  children.push(sectionHeader("✓  DÉCISIONS PRISES", "198754"));
  if (r.decisions && r.decisions.length) {
    r.decisions.forEach(d => children.push(bulletItem(d, "198754")));
  } else {
    children.push(new Paragraph({
      children: [new TextRun({ text: "Aucune décision identifiée", italics: true, color: "999999", size: 20 })],
      indent: { left: 360 },
    }));
  }

  // === SECTION ACTIONS ===
  children.push(sectionHeader("→  ACTIONS À MENER", "FF9900"));
  if (r.actions && r.actions.length) {
    r.actions.forEach(a => children.push(bulletItem(a, "FF9900")));
  } else {
    children.push(new Paragraph({
      children: [new TextRun({ text: "Aucune action définie", italics: true, color: "999999", size: 20 })],
      indent: { left: 360 },
    }));
  }

  // === SECTION POINTS IMPORTANTS ===
  children.push(sectionHeader("★  POINTS IMPORTANTS", "DC3545"));
  if (r.keypoints && r.keypoints.length) {
    r.keypoints.forEach(k => children.push(bulletItem(k, "DC3545")));
  } else {
    children.push(new Paragraph({
      children: [new TextRun({ text: "Aucun point particulier", italics: true, color: "999999", size: 20 })],
      indent: { left: 360 },
    }));
  }

  // === PIED ===
  children.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { before: 600 } }));
  children.push(new Paragraph({
    children: [new TextRun({
      text: "Document généré automatiquement par MbokaTech — Connectez. Collaborez. Réussissez.",
      italics: true, size: 16, color: "999999"
    })],
    alignment: AlignmentType.CENTER,
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: "E1DFDD" } },
    spacing: { before: 200 },
  }));

  // Création du document
  const doc = new Document({
    creator: "MbokaTech",
    title: `Compte rendu - ${meta.title}`,
    description: "Compte rendu de réunion généré automatiquement",
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(0.8),
            bottom: convertInchesToTwip(0.8),
            left: convertInchesToTwip(0.9),
            right: convertInchesToTwip(0.9),
          }
        }
      },
      children
    }],
  });

  // Téléchargement
  try {
    const blob = await Packer.toBlob(doc);
    const safeTitle = meta.title.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 40);
    saveAs(blob, `Compte-rendu_${safeTitle}_${Date.now()}.docx`);
    showToast("Document Word téléchargé ✓", "success");
  } catch (err) {
    console.error(err);
    showToast("Erreur export Word : " + err.message, "danger");
  }
}

// Branchement des boutons
document.addEventListener("DOMContentLoaded", () => {
  // Injecter le logo partout
  ["brand-logo-login", "brand-logo-nav", "brand-logo-guest"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.src = APP_LOGO;
  });

  const pdfBtn = document.getElementById("export-pdf-btn");
  if (pdfBtn) pdfBtn.addEventListener("click", exportReportPDF);

  const wordBtn = document.getElementById("export-word-btn");
  if (wordBtn) wordBtn.addEventListener("click", exportReportWord);
});

/* ==========================================================
   12. UTILITAIRES
   ========================================================== */
function startMeetingTimer() {
  state.meetingStartTime = Date.now();
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    const sec = Math.floor((Date.now() - state.meetingStartTime) / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    $("#meeting-timer").textContent = `${m}:${s}`;
  }, 1000);
}

// (L'élément copy-meeting-id a été retiré de l'UI car remplacé par le bouton "Inviter")

/* ==========================================================
   BOUTON INVITER — Génération du lien de partage
   ========================================================== */
const inviteBtn = document.getElementById("invite-btn");
if (inviteBtn) {
  inviteBtn.addEventListener("click", () => {
    if (!state.currentMeetingId) return;

    // Construire le lien d'invitation (URL actuelle + ?join=ID)
    const baseUrl = window.location.origin + window.location.pathname;
    const inviteLink = `${baseUrl}?join=${state.currentMeetingId}`;

  $("#invite-link").value = inviteLink;
  $("#invite-meeting-id").textContent = state.currentMeetingId;

  // Préparer les boutons de partage
  const meetingTitle = state.currentMeetingTitle || "Réunion";
  const message = `Bonjour ! Rejoignez ma réunion "${meetingTitle}" sur MbokaTech :\n${inviteLink}`;

  $("#share-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  $("#share-email").href = `mailto:?subject=${encodeURIComponent("Invitation : " + meetingTitle)}&body=${encodeURIComponent(message)}`;

  bootstrap.Modal.getOrCreateInstance($("#inviteModal")).show();
  });
}

const copyInviteBtn = document.getElementById("copy-invite-link");
if (copyInviteBtn) {
  copyInviteBtn.addEventListener("click", async () => {
    const link = $("#invite-link").value;
    try {
      await navigator.clipboard.writeText(link);
      showToast("Lien copié ! Partagez-le à vos invités.", "success");
      const btn = $("#copy-invite-link");
      btn.innerHTML = '<i class="bi bi-check-lg"></i> Copié !';
      btn.classList.remove("btn-primary");
      btn.classList.add("btn-success");
      setTimeout(() => {
        btn.innerHTML = '<i class="bi bi-clipboard-fill"></i> Copier';
        btn.classList.add("btn-primary");
        btn.classList.remove("btn-success");
      }, 2000);
    } catch {
      $("#invite-link").select();
      showToast("Sélectionnez et copiez le lien manuellement", "warning");
    }
  });
}

/* ============================================================
   VAGUE 1 : Main levée, Réactions, Salle d'attente,
              Mute all, Liste participants
   ============================================================ */

/* ---------- 1. MAIN LEVÉE ---------- */
state.handRaised = false;
state.handsRaised = {}; // { peerId: timestamp }

const raiseHandBtn = document.getElementById("raise-hand-btn");
if (raiseHandBtn) {
  raiseHandBtn.addEventListener("click", async () => {
    if (!state.currentMeetingId || !firebaseReady) return;
    state.handRaised = !state.handRaised;

    raiseHandBtn.classList.toggle("hand-raised", state.handRaised);

    try {
      await db.collection("meetings").doc(state.currentMeetingId)
        .collection("participants").doc(state.myPeerId).update({
          handRaised: state.handRaised,
          handRaisedAt: state.handRaised ? firebase.firestore.FieldValue.serverTimestamp() : null
        });

      // Indicateur sur sa propre tuile
      toggleHandIndicator("local-tile", state.handRaised);

      if (state.handRaised) {
        showToast("✋ Vous avez levé la main", "warning");
      } else {
        showToast("✋ Vous avez baissé la main", "secondary");
      }
    } catch (e) {
      console.warn("Hand raise error:", e);
    }
  });
}

function toggleHandIndicator(tileId, raised) {
  const tile = document.getElementById(tileId);
  if (!tile) return;
  const existing = tile.querySelector(".hand-indicator");
  if (raised && !existing) {
    const ind = document.createElement("div");
    ind.className = "hand-indicator";
    ind.innerHTML = "✋";
    tile.appendChild(ind);
  } else if (!raised && existing) {
    existing.remove();
  }
}

/* ---------- 2. RÉACTIONS ---------- */
const reactionsBtn = document.getElementById("reactions-btn");
const reactionsPopup = document.getElementById("reactions-popup");

if (reactionsBtn && reactionsPopup) {
  reactionsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    reactionsPopup.style.display = reactionsPopup.style.display === "none" ? "flex" : "none";
  });

  // Fermer si clic à l'extérieur
  document.addEventListener("click", (e) => {
    if (!reactionsPopup.contains(e.target) && e.target !== reactionsBtn) {
      reactionsPopup.style.display = "none";
    }
  });

  // Clic sur une réaction
  reactionsPopup.querySelectorAll(".reaction-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const emoji = btn.dataset.emoji;
      reactionsPopup.style.display = "none";

      // Animation locale immédiate
      showFloatingReaction("local-tile", emoji);

      // Broadcast via Firestore
      if (firebaseReady && state.currentMeetingId) {
        try {
          await db.collection("meetings").doc(state.currentMeetingId)
            .collection("reactions").add({
              emoji,
              peerId: state.myPeerId,
              userName: state.user.name,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
        } catch (e) { console.warn("Reaction error:", e); }
      }
    });
  });
}

function showFloatingReaction(tileId, emoji) {
  const tile = document.getElementById(tileId);
  if (!tile) return;
  const r = document.createElement("div");
  r.className = "floating-reaction";
  r.textContent = emoji;
  tile.appendChild(r);
  setTimeout(() => r.remove(), 2500);
}

/* Écouteur Firestore : recevoir les réactions des autres */
function initReactionsListener(meetingId) {
  if (!firebaseReady) return null;
  const startTime = Date.now();
  return db.collection("meetings").doc(meetingId)
    .collection("reactions")
    .where("createdAt", ">=", new Date())
    .onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data();
          if (data.peerId === state.myPeerId) return; // Pas pour moi
          const tileId = `tile-${data.peerId}`;
          showFloatingReaction(tileId, data.emoji);
        }
      });
    });
}

/* ---------- 3. PANNEAU PARTICIPANTS ---------- */
const participantsBtn = document.getElementById("participants-btn");
if (participantsBtn) {
  participantsBtn.addEventListener("click", () => {
    $("#side-panel").classList.remove("collapsed");
    document.querySelector('[data-bs-target="#participants-pane"]').click();
  });
}

function renderParticipantsList() {
  const list = $("#participants-list");
  const allParticipants = state.allParticipants || [];

  // Mettre à jour le compteur
  $("#participants-tab-count").textContent = allParticipants.length;

  if (allParticipants.length === 0) {
    list.innerHTML = `<div class="text-center text-muted small py-4">
      <i class="bi bi-people fs-3 d-block mb-2 opacity-50"></i>
      Aucun participant
    </div>`;
    return;
  }

  // Trier : moi en premier, puis main levée, puis le reste
  const sorted = [...allParticipants].sort((a, b) => {
    if (a.peerId === state.myPeerId) return -1;
    if (b.peerId === state.myPeerId) return 1;
    if (a.handRaised && !b.handRaised) return -1;
    if (!a.handRaised && b.handRaised) return 1;
    return 0;
  });

  list.innerHTML = sorted.map(p => {
    const isMe = p.peerId === state.myPeerId;
    const initials = (p.name || "?").trim().split(/\s+/).map(s => s[0] || "").join("").slice(0,2).toUpperCase();
    const isCoHost = (state.meetingData?.coHostIds || []).includes(p.userId);
    const role = p.isOrganizer ? "Organisateur" : isCoHost ? "Co-organisateur" : (p.isGuest ? "Invité" : "Participant");
    const handIcon = p.handRaised ? '<i class="bi bi-hand-thumbs-up-fill hand" title="A levé la main"></i>' : '';
    const micIcon = p.micOn === false
      ? '<i class="bi bi-mic-mute-fill mic-off"></i>'
      : '<i class="bi bi-mic-fill mic-on"></i>';
    const camIcon = p.camOn === false ? '<i class="bi bi-camera-video-off-fill mic-off"></i>' : '';
    const spotIcon = state.meetingData?.spotlightPeerId === p.peerId ? '<i class="bi bi-star-fill text-warning" title="Mis en avant"></i>' : '';

    // Actions : message privé pour tous, modération pour l'organisateur
    let actions = '';
    if (!isMe) {
      const dmBtn = `<button class="btn btn-outline-secondary" data-action="dm" data-peer="${p.peerId}" data-user="${p.userId}" title="Message privé"><i class="bi bi-chat-left-text"></i></button>`;
      const hostBtns = state.isOrganizer ? `
          ${p.micOn === false
            ? `<button class="btn btn-outline-success" data-action="askUnmute" data-peer="${p.peerId}" title="Demander d'activer son micro"><i class="bi bi-mic"></i></button>`
            : `<button class="btn btn-outline-warning" data-action="mute" data-peer="${p.peerId}" title="Couper son micro"><i class="bi bi-mic-mute"></i></button>`}
          <button class="btn btn-outline-primary" data-action="spotlight" data-peer="${p.peerId}" title="Mettre en avant pour tous"><i class="bi bi-star"></i></button>
          ${state.meetingOwnerId === state.user.uid && !p.isOrganizer && !p.isGuest
            ? `<button class="btn ${isCoHost ? "btn-primary" : "btn-outline-primary"}" data-action="cohost" data-peer="${p.peerId}" data-user="${p.userId}" title="${isCoHost ? "Retirer les droits de co-organisateur" : "Nommer co-organisateur"}"><i class="bi bi-person-badge"></i></button>`
            : ""}
          <button class="btn btn-outline-danger" data-action="kick" data-peer="${p.peerId}" data-user="${p.userId}" title="Expulser">
            <i class="bi bi-x-lg"></i>
          </button>` : '';
      actions = `<div class="participant-actions">${dmBtn}${hostBtns}</div>`;
    } else if (state.isOrganizer) {
      actions = `<div class="participant-actions"><button class="btn btn-outline-primary" data-action="spotlight" data-peer="${p.peerId}" title="Me mettre en avant"><i class="bi bi-star"></i></button></div>`;
    }

    return `
      <div class="participant-item ${isMe ? 'is-me' : ''} ${p.handRaised ? 'hand-raised' : ''}" data-peer="${p.peerId}">
        <div class="participant-avatar">${initials}</div>
        <div class="participant-info">
          <div class="participant-name">${escapeHtml(p.name)}${isMe ? ' <span class="text-primary">(vous)</span>' : ''}</div>
          <div class="participant-role">${role} · <span class="talk-time" data-talk="${p.peerId}">${formatTalkTime(p.peerId)}</span></div>
        </div>
        <div class="participant-icons">
          ${spotIcon}
          ${handIcon}
          ${camIcon}
          ${micIcon}
        </div>
        ${actions}
      </div>`;
  }).join("");

  // Brancher les actions
  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleParticipantAction(btn.dataset.action, btn.dataset.peer, btn.dataset.user));
  });
}

async function handleParticipantAction(action, peerId, userId) {
  if (action === "mute") {
    // Envoyer une commande via Firestore
    if (firebaseReady && state.currentMeetingId) {
      try {
        await db.collection("meetings").doc(state.currentMeetingId)
          .collection("commands").add({
            type: "mute",
            targetPeerId: peerId,
            from: state.user.name,
            at: firebase.firestore.FieldValue.serverTimestamp(),
          });
        showToast(`🔇 Demande de mute envoyée`, "info");
      } catch (e) { console.warn(e); }
    }
  } else if (action === "dm") {
    openPrivateChat(userId);
  } else if (action === "cohost") {
    await toggleCoHost(userId);
  } else if (action === "askUnmute" || action === "spotlight") {
    await handleExtraParticipantAction(action, peerId);
  } else if (action === "kick") {
    if (!(await askConfirm("Expulser ce participant ?", "Il sera retiré immédiatement de la réunion.", "Expulser"))) return;
    if (firebaseReady && state.currentMeetingId) {
      try {
        await db.collection("meetings").doc(state.currentMeetingId)
          .collection("commands").add({
            type: "kick",
            targetPeerId: peerId,
            from: state.user.name,
            at: firebase.firestore.FieldValue.serverTimestamp(),
          });
        showToast("Participant expulsé", "warning");
      } catch (e) { console.warn(e); }
    }
  }
}

/* Synchroniser la liste participants depuis Firestore */
function syncParticipantsList(meetingId) {
  if (!firebaseReady) return null;
  state.allParticipants = [];

  return db.collection("meetings").doc(meetingId)
    .collection("participants")
    .onSnapshot((snap) => {
      const list = [];
      snap.docs.forEach(doc => {
        const data = doc.data();
        // Vérifier si actif
        const active = isParticipantActive(data);
        if (!active) return;

        list.push({
          peerId: data.peerId,
          userId: data.userId,
          name: data.name || "Anonyme",
          handRaised: !!data.handRaised,
          micOn: data.micOn !== false,
          camOn: data.camOn !== false,
          isGuest: !!data.isGuest,
          isOrganizer: data.userId === state.meetingOwnerId,
          approved: data.approved !== false, // par défaut approuvé
        });

        // Mettre à jour les indicateurs visuels (main levée sur tuile)
        if (data.peerId !== state.myPeerId) {
          toggleHandIndicator(`tile-${data.peerId}`, !!data.handRaised);
        }
      });
      state.allParticipants = list;
      renderParticipantsList();
      onParticipantsUpdated(list);
    });
}

/* ---------- 4. SALLE D'ATTENTE ---------- */
function syncWaitingRoom(meetingId) {
  if (!firebaseReady || !state.isOrganizer) return null;

  let known = null;
  return db.collection("meetings").doc(meetingId)
    .collection("waiting")
    .onSnapshot((snap) => {
      const waiting = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(w => w.approved !== true && w.approved !== false);
      // Notifier l'organisateur des nouvelles demandes
      const ids = new Set(waiting.map(w => w.id));
      if (known) {
        waiting.filter(w => !known.has(w.id)).forEach(w => {
          showToast(`🚪 ${w.name || "Quelqu'un"} demande à rejoindre`, "info");
          playSound("knock");
        });
      }
      known = ids;
      state.waitingList = waiting;
      const badge = $("#waiting-badge");
      badge.textContent = waiting.length;
      badge.classList.toggle("show", waiting.length > 0);
      renderWaitingList(waiting);
    });
}

function renderWaitingList(waiting) {
  const wr = $("#waiting-room");
  const wl = $("#waiting-list");
  if (!wr || !wl) return;

  if (waiting.length === 0) {
    wr.style.display = "none";
    return;
  }

  wr.style.display = "";
  wl.innerHTML = waiting.map(w => `
    <div class="waiting-item">
      <div class="participant-avatar">${(w.name || "?")[0].toUpperCase()}</div>
      <div class="waiting-info">
        <div class="waiting-name">${escapeHtml(w.name)}</div>
        <div class="waiting-email">${escapeHtml(w.email || "")}</div>
      </div>
      <div class="participant-actions">
        <button class="btn btn-success" data-approve="${w.id}" title="Accepter"><i class="bi bi-check-lg"></i></button>
        <button class="btn btn-outline-danger" data-deny="${w.id}" title="Refuser"><i class="bi bi-x-lg"></i></button>
      </div>
    </div>`).join("");

  wl.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', () => approveWaiting(btn.dataset.approve));
  });
  wl.querySelectorAll('[data-deny]').forEach(btn => {
    btn.addEventListener('click', () => denyWaiting(btn.dataset.deny));
  });
}

async function approveWaiting(waitingId) {
  if (!firebaseReady) return;
  try {
    await db.collection("meetings").doc(state.currentMeetingId)
      .collection("waiting").doc(waitingId).update({ approved: true, decidedAt: firebase.firestore.FieldValue.serverTimestamp() });
    showToast("✅ Participant accepté", "success");
  } catch (e) { console.error(e); }
}

async function denyWaiting(waitingId) {
  if (!firebaseReady) return;
  try {
    await db.collection("meetings").doc(state.currentMeetingId)
      .collection("waiting").doc(waitingId).update({ approved: false, decidedAt: firebase.firestore.FieldValue.serverTimestamp() });
    showToast("❌ Participant refusé", "warning");
  } catch (e) { console.error(e); }
}

/* ---------- 5. MUTE ALL (organisateur) ---------- */
const muteAllBtn = document.getElementById("mute-all-btn");
if (muteAllBtn) {
  muteAllBtn.addEventListener("click", async () => {
    if (!(await askConfirm("Couper le micro de tous ?", "Tous les participants seront mis en sourdine.", "Couper"))) return;
    if (!firebaseReady || !state.currentMeetingId) return;

    try {
      // Envoyer un signal "mute all"
      await db.collection("meetings").doc(state.currentMeetingId)
        .collection("commands").add({
          type: "muteAll",
          from: state.user.name,
          at: firebase.firestore.FieldValue.serverTimestamp(),
        });
      showToast("🔇 Tous les micros ont été coupés", "success");
    } catch (e) { console.error(e); }
  });
}

/* Écouteur de commandes (mute, kick, muteAll) */
function syncCommands(meetingId) {
  if (!firebaseReady) return null;
  return db.collection("meetings").doc(meetingId)
    .collection("commands")
    .where("at", ">=", new Date())
    .onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type !== "added") return;
        const cmd = change.doc.data();

        if (cmd.type === "muteAll" && !state.isOrganizer) {
          // Couper mon micro
          if (state.micOn && state.localStream) {
            setMic(false);
            showToast(`🔇 ${cmd.from} a coupé les micros`, "warning");
          }
        }

        if (cmd.type === "mute" && cmd.targetPeerId === state.myPeerId) {
          if (state.micOn && state.localStream) {
            setMic(false);
            showToast(`🔇 Votre micro a été coupé par ${cmd.from}`, "warning");
          }
        }

        if (cmd.type === "kick" && cmd.targetPeerId === state.myPeerId) {
          showToast(`Vous avez été expulsé(e) par ${cmd.from}`, "danger");
          setTimeout(() => leaveMeeting(), 2000);
        }

        handleExtraCommand(cmd);
      });
    });
}

/* ---------- 6. UPDATE micOn/camOn dans Firestore quand on toggle ---------- */
async function syncMyState() {
  if (!firebaseReady || !state.currentMeetingId || !state.myPeerId) return;
  try {
    await db.collection("meetings").doc(state.currentMeetingId)
      .collection("participants").doc(state.myPeerId).update({
        micOn: state.micOn,
        camOn: state.camOn,
      });
  } catch (e) { /* silently */ }
}
