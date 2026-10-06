/* MbokaTech — fonctionnalités avancées (Vague 2) */
/* ============================================================
   VAGUE 2 : écran de préparation, périphériques, arrière-plans,
             orateur actif, mises en page, qualité réseau,
             sous-titres + traduction, enregistrement vidéo,
             chat enrichi, sondages, Q&R, notes, tableau blanc,
             salles de sous-commission, contrôles organisateur,
             salle d'attente, planification, assistant IA,
             raccourcis clavier, mode sombre
   ============================================================ */

/* ---------- 0. Préférences locales (par navigateur) ---------- */
const PREFS_KEY = "mboka.prefs";
const DEFAULT_PREFS = {
  cameraId: "", micId: "", speakerId: "",
  noiseSuppression: true, mirror: true, hideSelf: false, sounds: true,
  bgMode: "none", captionLang: "", theme: "light",
};
state.prefs = (() => {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; }
  catch (_) { return { ...DEFAULT_PREFS }; }
})();
if (state.prefs.bgMode === "custom") state.prefs.bgMode = "none"; // l'image importée n'est pas conservée
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch (_) {}
}

const DEFAULT_MEETING_SETTINGS = {
  locked: false, waitingRoom: false, chatEnabled: true,
  shareEnabled: true, unmuteEnabled: true, recordEnabled: false,
  autoTranscribe: true, autoReport: true, autoRecord: false,
};
function meetingSettings() {
  return { ...DEFAULT_MEETING_SETTINGS, ...(state.meetingData?.settings || {}) };
}
/* L'organisateur peut tout faire ; les autres selon les réglages de la réunion */
function canDo(key) {
  return state.isOrganizer || meetingSettings()[key] !== false;
}

/* ---------- 1. Utilitaires ---------- */
function tsOf(x) {
  if (!x) return 0;
  if (typeof x.toMillis === "function") return x.toMillis();
  if (x instanceof Date) return x.getTime();
  if (typeof x === "number") return x;
  if (typeof x.toDate === "function") return x.toDate().getTime();
  return 0;
}
function inviteLinkFor(id) {
  return `${window.location.origin}${window.location.pathname}?join=${id}`;
}
function copyText(text, okMsg) {
  navigator.clipboard.writeText(text)
    .then(() => showToast(okMsg, "success"))
    .catch(() => window.prompt("Copiez ce texte :", text));
}
/* Nom de fichier sûr : sans accents ni caractères spéciaux (sinon certains navigateurs l'ignorent) */
function safeName(s) {
  return String(s || "reunion").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "reunion";
}
function downloadBlob(blob, filename) {
  if (window.saveAs) { saveAs(blob, filename); return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function fmtDuration(ms) {
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
let permWarned = false;
function permissionWarn(err, where = "") {
  console.warn(where, err);
  if (err?.code === "permission-denied" && !permWarned) {
    permWarned = true;
    const part = where ? ` (${where.split("/").pop()})` : "";
    showToast(`Firebase refuse l'accès${part} : publiez le fichier firestore.rules dans la console Firebase › Firestore › Règles`, "danger");
  }
}

/* Fenêtre de confirmation (remplace confirm()) */
function askConfirm(title, text, okLabel = "OK") {
  return new Promise((resolve) => {
    const el = $("#confirmModal");
    const modal = bootstrap.Modal.getOrCreateInstance(el);
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    $("#confirm-ok").textContent = okLabel;
    let result = false;
    $("#confirm-ok").onclick = () => { result = true; modal.hide(); };
    $("#confirm-cancel").onclick = () => modal.hide();
    el.addEventListener("hidden.bs.modal", () => resolve(result), { once: true });
    modal.show();
  });
}

/* Sons de notification générés (aucun fichier à charger) */
let sfxCtx = null;
function playSound(kind) {
  if (!state.prefs.sounds) return;
  try {
    sfxCtx = sfxCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = { join: [660, 880], leave: [880, 550], message: [990], hand: [700, 940], knock: [520, 520] }[kind] || [800];
    notes.forEach((f, i) => {
      const o = sfxCtx.createOscillator();
      const g = sfxCtx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = sfxCtx.currentTime + i * 0.13;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(sfxCtx.destination);
      o.start(t);
      o.stop(t + 0.13);
    });
  } catch (_) {}
}

/* Minuterie dans un Worker : continue de tourner quand l'onglet est en arrière-plan */
function createTicker(fps, fn) {
  try {
    const src = `setInterval(() => postMessage(0), ${Math.round(1000 / fps)});`;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const w = new Worker(url);
    w.onmessage = fn;
    return { stop() { w.terminate(); URL.revokeObjectURL(url); } };
  } catch (_) {
    const id = setInterval(fn, 1000 / fps);
    return { stop() { clearInterval(id); } };
  }
}

function getAudioCtx() {
  if (!state.audioCtx || state.audioCtx.state === "closed") {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioCtx.state === "suspended") state.audioCtx.resume().catch(() => {});
  return state.audioCtx;
}

/* ---------- 2. Couche temps réel : Firestore, ou mémoire en mode démo ---------- */
function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof o[keys[i]] !== "object" || o[keys[i]] === null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  const k = keys[keys.length - 1];
  if (value && value.__op === "delete") delete o[k];
  else if (value && value.__op === "union") o[k] = [...new Set([...(o[k] || []), value.v])];
  else if (value && value.__op === "remove") o[k] = (o[k] || []).filter((x) => x !== value.v);
  else o[k] = value;
}

const rt = {
  mem: {}, memListeners: {}, memDocs: {}, memDocListeners: {},
  coll(meetingId, name) { return `meetings/${meetingId}/${name}`; },
  now() { return firebaseReady ? firebase.firestore.FieldValue.serverTimestamp() : new Date(); },
  union(v) { return firebaseReady ? firebase.firestore.FieldValue.arrayUnion(v) : { __op: "union", v }; },
  without(v) { return firebaseReady ? firebase.firestore.FieldValue.arrayRemove(v) : { __op: "remove", v }; },
  del() { return firebaseReady ? firebase.firestore.FieldValue.delete() : { __op: "delete" }; },
  _map(path) { return (this.mem[path] = this.mem[path] || new Map()); },
  _apply(obj, data) { Object.entries(data).forEach(([k, v]) => setPath(obj, k, v)); return obj; },
  _emit(path) {
    const docs = [...this._map(path).entries()].map(([id, d]) => ({ id, ...d }));
    (this.memListeners[path] || new Set()).forEach((cb) => cb(docs));
  },
  async add(path, data) {
    if (firebaseReady) return (await db.collection(path).add(data)).id;
    const id = Math.random().toString(36).slice(2, 12);
    this._map(path).set(id, this._apply({}, data));
    this._emit(path);
    return id;
  },
  async update(path, id, data) {
    if (firebaseReady) return db.collection(path).doc(id).update(data);
    const m = this._map(path);
    if (!m.has(id)) return;
    m.set(id, this._apply({ ...m.get(id) }, data));
    this._emit(path);
  },
  async remove(path, id) {
    if (firebaseReady) return db.collection(path).doc(id).delete();
    this._map(path).delete(id);
    this._emit(path);
  },
  listen(path, cb) {
    if (firebaseReady) {
      return db.collection(path).onSnapshot(
        (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => permissionWarn(err, path)
      );
    }
    (this.memListeners[path] = this.memListeners[path] || new Set()).add(cb);
    this._emit(path);
    return () => this.memListeners[path].delete(cb);
  },
  async updateMeeting(id, data) {
    if (firebaseReady) return db.collection("meetings").doc(id).update(data);
    this.memDocs[id] = this._apply({ ...(this.memDocs[id] || {}) }, data);
    (this.memDocListeners[id] || new Set()).forEach((cb) => cb(this.memDocs[id]));
  },
  listenMeeting(id, cb) {
    if (firebaseReady) {
      return db.collection("meetings").doc(id).onSnapshot((snap) => { if (snap.exists) cb(snap.data()); }, permissionWarn);
    }
    if (!this.memDocs[id]) {
      const m = state.demoMeetings.find((x) => x.id === id) || {};
      this.memDocs[id] = { ...m };
    }
    (this.memDocListeners[id] = this.memDocListeners[id] || new Set()).add(cb);
    cb(this.memDocs[id]);
    return () => this.memDocListeners[id].delete(cb);
  },
};

async function sendCommand(cmd) {
  if (!firebaseReady || !state.currentMeetingId) return;
  try {
    await db.collection("meetings").doc(state.currentMeetingId).collection("commands").add({
      ...cmd,
      from: state.user.name,
      fromPeerId: state.myPeerId,
      at: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) { permissionWarn(e); }
}

/* ---------- 3. Médias locaux : acquisition, périphériques, pistes ---------- */
function videoConstraints() {
  return {
    width: { ideal: 1280 }, height: { ideal: 720 },
    ...(state.prefs.cameraId ? { deviceId: { exact: state.prefs.cameraId } } : {}),
  };
}
function audioConstraints() {
  return {
    echoCancellation: true,
    noiseSuppression: !!state.prefs.noiseSuppression,
    autoGainControl: true,
    ...(state.prefs.micId ? { deviceId: { exact: state.prefs.micId } } : {}),
  };
}

/* Obtient caméra + micro, avec repli : micro seul, caméra seule, ou rien */
async function acquireMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Ce navigateur ne donne pas accès à la caméra / au micro", "warning");
    return new MediaStream();
  }
  const gum = (c) => navigator.mediaDevices.getUserMedia(c);
  for (let pass = 0; pass < 2; pass++) {
    try { return await gum({ video: videoConstraints(), audio: audioConstraints() }); } catch (_) {}
    try {
      const s = await gum({ audio: audioConstraints() });
      showToast("Caméra indisponible : vous rejoignez avec le micro seulement", "warning");
      return s;
    } catch (_) {}
    try {
      const s = await gum({ video: videoConstraints() });
      showToast("Micro indisponible : vous rejoignez avec la caméra seulement", "warning");
      return s;
    } catch (_) {}
    // Un périphérique mémorisé a peut-être été débranché : on réessaie avec ceux par défaut
    if (!state.prefs.cameraId && !state.prefs.micId) break;
    state.prefs.cameraId = "";
    state.prefs.micId = "";
    savePrefs();
  }
  showToast("Caméra et micro inaccessibles : vous pouvez tout de même suivre la réunion", "warning");
  return new MediaStream();
}

/* Pistes de remplacement (noir / silence) quand il n'y a pas de caméra ou de micro :
   elles gardent les « émetteurs » WebRTC en place pour pouvoir brancher un périphérique plus tard */
let placeholderVideo = null;
let placeholderAudio = null;
function getPlaceholderVideoTrack() {
  if (placeholderVideo && placeholderVideo.readyState === "live") return placeholderVideo;
  const c = document.createElement("canvas");
  c.width = 640; c.height = 360;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 640, 360);
  placeholderVideo = c.captureStream(1).getVideoTracks()[0];
  return placeholderVideo;
}
function getPlaceholderAudioTrack() {
  if (placeholderAudio && placeholderAudio.readyState === "live") return placeholderAudio;
  placeholderAudio = getAudioCtx().createMediaStreamDestination().stream.getAudioTracks()[0];
  return placeholderAudio;
}
function getOutVideoTrack() {
  return (BgFx.active && BgFx.track) || state.rawStream?.getVideoTracks()[0] || getPlaceholderVideoTrack();
}
function getOutAudioTrack() {
  return state.rawStream?.getAudioTracks()[0] || getPlaceholderAudioTrack();
}

/* Effet miroir de l'aperçu local : désactivé avec un fond image, pour que son texte reste lisible */
function updateMirror() {
  const imageBg = BgFx.active && (BgFx.mode.startsWith("img:") || BgFx.mode === "custom");
  const on = !!state.prefs.mirror && !imageBg;
  $("#local-tile").classList.toggle("mirror", on);
  $("#prejoin-tile").classList.toggle("mirror", on);
}

function applyTrackEnabled() {
  state.rawStream?.getAudioTracks().forEach((t) => (t.enabled = state.micOn));
  state.rawStream?.getVideoTracks().forEach((t) => (t.enabled = state.camOn));
  state.localStream?.getAudioTracks().forEach((t) => (t.enabled = state.micOn));
  state.localStream?.getVideoTracks().forEach((t) => (t.enabled = state.camOn));
}

function stopRawMedia() {
  BgFx.stop();
  state.rawStream?.getTracks().forEach((t) => t.stop());
  state.rawStream = null;
  Levels.detach("local");
}

/* Remplace les pistes envoyées aux autres participants sans couper les appels */
function replaceSenderTrack(kind, track) {
  Object.values(state.calls || {}).forEach((call) => {
    const pc = call.peerConnection;
    if (!pc) return;
    pc.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === kind && sender.track !== track) {
        sender.replaceTrack(track).catch((e) => console.warn("replaceTrack", e));
      }
    });
  });
}

function refreshOutgoing() {
  const v = getOutVideoTrack();
  const a = getOutAudioTrack();
  if (state.localStream) {
    state.localStream.getVideoTracks().forEach((t) => { if (t !== v) state.localStream.removeTrack(t); });
    state.localStream.getAudioTracks().forEach((t) => { if (t !== a) state.localStream.removeTrack(t); });
    if (!state.localStream.getVideoTracks().length) state.localStream.addTrack(v);
    if (!state.localStream.getAudioTracks().length) state.localStream.addTrack(a);
    replaceSenderTrack("video", v);
    replaceSenderTrack("audio", a);
    $("#local-video").srcObject = state.localStream;
  }
  if ($("#prejoin-page").classList.contains("active")) {
    $("#prejoin-video").srcObject = new MediaStream([v]);
  }
  applyTrackEnabled();
  updateMirror();
  Levels.attachLocal();
  if (Recorder.dest && Recorder.localTrack !== a) {
    Recorder.addTrack(a);
    Recorder.localTrack = a;
  }
}

async function switchDevice(kind, deviceId) {
  if (kind === "audiooutput") {
    state.prefs.speakerId = deviceId;
    savePrefs();
    applySpeaker();
    return;
  }
  if (kind === "videoinput") state.prefs.cameraId = deviceId;
  else state.prefs.micId = deviceId;
  savePrefs();
  if (!state.rawStream) return;

  try {
    const ns = await navigator.mediaDevices.getUserMedia(
      kind === "videoinput" ? { video: videoConstraints() } : { audio: audioConstraints() }
    );
    const newTrack = ns.getTracks()[0];
    const old = kind === "videoinput" ? state.rawStream.getVideoTracks() : state.rawStream.getAudioTracks();
    old.forEach((t) => { state.rawStream.removeTrack(t); t.stop(); });
    state.rawStream.addTrack(newTrack);
    if (kind === "videoinput" && BgFx.active) BgFx.setInput(newTrack);
    refreshOutgoing();
    refreshDeviceLists();
  } catch (e) {
    showToast("Impossible d'utiliser ce périphérique : " + e.message, "danger");
  }
}

function applySpeaker() {
  const id = state.prefs.speakerId || "";
  document.querySelectorAll("#videos-grid video").forEach((v) => {
    if (v.muted || typeof v.setSinkId !== "function") return;
    v.setSinkId(id).catch(() => {});
  });
}

async function refreshDeviceLists() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  let devices = [];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (_) { return; }
  const labels = { videoinput: "Caméra", audioinput: "Micro", audiooutput: "Haut-parleur" };
  document.querySelectorAll(".device-select").forEach((sel) => {
    const kind = sel.dataset.kind;
    if (kind === "audiooutput" && !("setSinkId" in HTMLMediaElement.prototype)) {
      sel.innerHTML = '<option value="">Sortie par défaut du système</option>';
      sel.disabled = true;
      return;
    }
    const list = devices.filter((d) => d.kind === kind);
    let current = state.prefs.speakerId;
    if (kind === "videoinput") current = state.rawStream?.getVideoTracks()[0]?.getSettings().deviceId || state.prefs.cameraId;
    if (kind === "audioinput") current = state.rawStream?.getAudioTracks()[0]?.getSettings().deviceId || state.prefs.micId;
    sel.innerHTML = list.length
      ? list.map((d, i) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || `${labels[kind]} ${i + 1}`)}</option>`).join("")
      : '<option value="">Aucun périphérique détecté</option>';
    if (current && list.some((d) => d.deviceId === current)) sel.value = current;
  });
}

document.querySelectorAll(".device-select").forEach((sel) => {
  sel.addEventListener("change", () => switchDevice(sel.dataset.kind, sel.value));
});
if (navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener?.("devicechange", () => refreshDeviceLists());
}

/* ---------- 4. Niveaux audio : orateur actif, temps de parole, vumètre ---------- */
const Levels = {
  nodes: {}, talkMs: {}, timer: null, activeId: null, holdUntil: 0, ticks: 0,
  attach(id, stream) {
    this.detach(id);
    const track = stream?.getAudioTracks?.()[0];
    if (!track) return;
    try {
      const ctx = getAudioCtx();
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.nodes[id] = { source, analyser, data: new Uint8Array(analyser.fftSize), level: 0 };
      if (!this.timer) this.timer = setInterval(() => this.tick(), 150);
    } catch (e) { console.warn("Analyse audio :", e); }
  },
  attachLocal() {
    const a = state.rawStream?.getAudioTracks()[0];
    if (a) this.attach("local", new MediaStream([a]));
  },
  detach(id) {
    const n = this.nodes[id];
    if (!n) return;
    try { n.source.disconnect(); } catch (_) {}
    delete this.nodes[id];
  },
  tick() {
    let best = null;
    let bestLevel = 0;
    for (const [id, n] of Object.entries(this.nodes)) {
      n.analyser.getByteTimeDomainData(n.data);
      let sum = 0;
      for (let i = 0; i < n.data.length; i++) {
        const v = (n.data[i] - 128) / 128;
        sum += v * v;
      }
      n.level = n.level * 0.6 + Math.sqrt(sum / n.data.length) * 0.4;
      const speaking = n.level > 0.03 && !(id === "local" && !state.micOn);
      const tile = document.getElementById(id === "local" ? "local-tile" : `tile-${id}`);
      if (tile) tile.classList.toggle("speaking", speaking);
      if (speaking) {
        const key = id === "local" ? (state.myPeerId || "local") : id;
        this.talkMs[key] = (this.talkMs[key] || 0) + 150;
        if (id !== "local" && n.level > bestLevel) { bestLevel = n.level; best = id; }
      }
    }
    const meter = $("#prejoin-meter");
    if (meter) meter.style.width = this.nodes.local && state.micOn ? Math.min(100, this.nodes.local.level * 500) + "%" : "0";

    const now = Date.now();
    if (best && best !== this.activeId && now > this.holdUntil) {
      this.activeId = best;
      this.holdUntil = now + 1500;
      Layout.apply();
    }
    if (++this.ticks % 13 === 0) {
      document.querySelectorAll("[data-talk]").forEach((el) => { el.textContent = formatTalkTime(el.dataset.talk); });
    }
  },
  reset() {
    Object.keys(this.nodes).forEach((id) => this.detach(id));
    this.talkMs = {};
    this.activeId = null;
    clearInterval(this.timer);
    this.timer = null;
  },
};
function formatTalkTime(peerId) {
  const ms = Levels.talkMs[peerId] || 0;
  return `parole ${fmtDuration(ms)}`;
}

/* ---------- 5. Arrière-plans : flou et images virtuelles (MediaPipe) ---------- */
const BG_PRESETS = [
  { id: "none", label: "Aucun" },
  { id: "blur-light", label: "Flou léger" },
  { id: "blur", label: "Flou fort" },
  { id: "img:mboka", label: "MbokaTech" },
  { id: "img:office", label: "Bureau" },
  { id: "img:sunset", label: "Coucher de soleil" },
  { id: "img:night", label: "Nuit étoilée" },
  { id: "img:forest", label: "Forêt" },
  { id: "custom", label: "Importer…" },
];
const bgCache = {};
function makePresetBackground(id, w = 1280, h = 720) {
  const key = `${id}:${w}`;
  if (bgCache[key]) return bgCache[key];
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const lin = (stops, x1 = 0, y1 = 0, x2 = 0, y2 = h) => {
    const gr = g.createLinearGradient(x1, y1, x2, y2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    return gr;
  };
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  if (id === "img:mboka") {
    g.fillStyle = lin([[0, "#0d6efd"], [1, "#4f52b2"]], 0, 0, w, h);
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.08)";
    [[w * 0.85, h * 0.15, h * 0.45], [w * 0.15, h * 0.9, h * 0.35], [w * 0.6, h * 0.75, h * 0.18]].forEach(([x, y, r]) => {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    });
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.font = `bold ${Math.round(h * 0.06)}px sans-serif`;
    g.textAlign = "right";
    g.fillText("MbokaTech", w * 0.96, h * 0.93);
  } else if (id === "img:office") {
    g.fillStyle = lin([[0, "#efe6da"], [1, "#d9cbb8"]]);
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#8b6b4a";
    g.fillRect(0, h * 0.78, w, h * 0.22);
    g.fillStyle = lin([[0, "#bfe0ff"], [1, "#eaf5ff"]], 0, h * 0.12, 0, h * 0.58);
    g.fillRect(w * 0.58, h * 0.12, w * 0.32, h * 0.46);
    g.strokeStyle = "#ffffff"; g.lineWidth = h * 0.015;
    g.strokeRect(w * 0.58, h * 0.12, w * 0.32, h * 0.46);
    g.beginPath(); g.moveTo(w * 0.74, h * 0.12); g.lineTo(w * 0.74, h * 0.58); g.stroke();
    g.fillStyle = "#6c4a2f"; g.fillRect(w * 0.08, h * 0.2, w * 0.2, h * 0.04);
    g.fillStyle = "#3f7d4f";
    g.beginPath(); g.arc(w * 0.12, h * 0.66, h * 0.11, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#b5651d"; g.fillRect(w * 0.09, h * 0.7, w * 0.06, h * 0.09);
  } else if (id === "img:sunset") {
    g.fillStyle = lin([[0, "#2b1055"], [0.55, "#d53369"], [1, "#fbb03b"]]);
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,220,120,0.9)";
    g.beginPath(); g.arc(w * 0.5, h * 0.72, h * 0.16, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#3a1c4a";
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += w / 8) g.lineTo(x, h * (0.78 + 0.06 * Math.sin(x / w * 7)));
    g.lineTo(w, h); g.fill();
  } else if (id === "img:night") {
    g.fillStyle = lin([[0, "#0b1026"], [1, "#2b3a67"]]);
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#fff";
    for (let i = 0; i < 220; i++) {
      g.globalAlpha = 0.3 + rnd() * 0.7;
      g.fillRect(rnd() * w, rnd() * h * 0.8, 1.5 + rnd() * 1.5, 1.5 + rnd() * 1.5);
    }
    g.globalAlpha = 1;
    g.fillStyle = "#f5f3ce";
    g.beginPath(); g.arc(w * 0.82, h * 0.2, h * 0.08, 0, Math.PI * 2); g.fill();
  } else if (id === "img:forest") {
    g.fillStyle = lin([[0, "#cfe9d6"], [1, "#6fae7c"]]);
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w, base = h * (0.7 + rnd() * 0.3), th = h * (0.35 + rnd() * 0.35);
      g.fillStyle = `hsl(${130 + rnd() * 25}, 40%, ${18 + rnd() * 18}%)`;
      g.beginPath(); g.moveTo(x, base - th); g.lineTo(x - th * 0.28, base); g.lineTo(x + th * 0.28, base); g.fill();
    }
  }
  bgCache[key] = c;
  return c;
}
function drawCover(ctx, img, w, h, contain = false) {
  const iw = img.videoWidth || img.width, ih = img.videoHeight || img.height;
  if (!iw || !ih) return;
  const scale = contain ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

const BgFx = {
  active: false, mode: "none", seg: null, loading: null,
  video: null, canvas: null, ctx: null, track: null, ticker: null, busy: false,
  bgCanvas: null, customCanvas: null, avgMs: 0, nextAt: 0, slowFrames: 0,
  loadModel() {
    if (this.seg) return Promise.resolve(this.seg);
    if (this.loading) return this.loading;
    const base = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/";
    this.loading = new Promise((resolve, reject) => {
      const init = async () => {
        try {
          const seg = new SelfieSegmentation({ locateFile: (f) => base + f });
          seg.setOptions({ modelSelection: 1, selfieMode: false });
          seg.onResults((r) => this.draw(r));
          await seg.initialize();
          this.seg = seg;
          resolve(seg);
        } catch (e) { reject(e); }
      };
      if (window.SelfieSegmentation) { init(); return; }
      const sc = document.createElement("script");
      sc.src = base + "selfie_segmentation.js";
      sc.crossOrigin = "anonymous";
      sc.onload = init;
      sc.onerror = () => reject(new Error("chargement du module de détourage impossible"));
      document.head.appendChild(sc);
    });
    this.loading.catch(() => { this.loading = null; });
    return this.loading;
  },
  async apply(mode, { silent = false } = {}) {
    if (mode === "none") {
      this.stop();
      state.prefs.bgMode = "none";
      savePrefs();
      refreshOutgoing();
      renderBgGrid();
      return true;
    }
    const raw = state.rawStream?.getVideoTracks()[0];
    if (!raw) {
      if (!silent) showToast("Aucune caméra : effet impossible", "warning");
      return false;
    }
    try {
      setBgStatus("⏳ Chargement du détourage…");
      await this.loadModel();
      if (mode.startsWith("img:")) this.bgCanvas = makePresetBackground(mode);
      else if (mode === "custom") this.bgCanvas = this.customCanvas;
      this.mode = mode;
      if (!this.active) this.startPipeline(raw);
      if (mode !== "custom") { state.prefs.bgMode = mode; savePrefs(); }
      refreshOutgoing();
      renderBgGrid();
      setBgStatus("✅ Effet appliqué — le détourage est calculé sur votre appareil.");
      return true;
    } catch (e) {
      console.warn(e);
      setBgStatus("❌ " + e.message);
      if (!silent) showToast("Effet indisponible : " + e.message, "danger");
      return false;
    }
  },
  startPipeline(rawTrack) {
    const s = rawTrack.getSettings();
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream([rawTrack]);
    this.video.play().catch(() => {});
    this.canvas = document.createElement("canvas");
    this.canvas.width = s.width || 1280;
    this.canvas.height = s.height || 720;
    this.ctx = this.canvas.getContext("2d");
    this.track = this.canvas.captureStream(25).getVideoTracks()[0];
    this.active = true;
    this.ticker = createTicker(25, () => this.tick());
  },
  setInput(track) {
    if (!this.video) return;
    this.video.srcObject = new MediaStream([track]);
    this.video.play().catch(() => {});
    const s = track.getSettings();
    if (s.width && this.canvas) { this.canvas.width = s.width; this.canvas.height = s.height; }
  },
  async tick() {
    if (!this.active || this.busy || !this.seg || !this.video || this.video.readyState < 2 || !state.camOn) return;
    const now = performance.now();
    if (now < this.nextAt) return;
    this.busy = true;
    try { await this.seg.send({ image: this.video }); } catch (e) { console.warn("segmentation", e); }
    this.busy = false;
    // Cadence adaptative : on laisse toujours du temps libre à l'interface sur les appareils lents
    const dt = performance.now() - now;
    this.avgMs = this.avgMs ? this.avgMs * 0.85 + dt * 0.15 : dt;
    this.nextAt = performance.now() + Math.max(0, this.avgMs * 1.5 - 40);
    this.slowFrames = this.avgMs > 350 ? this.slowFrames + 1 : 0;
    if (this.slowFrames > 15) {
      showToast("Appareil trop lent pour l'effet d'arrière-plan : effet désactivé", "warning");
      this.apply("none");
    }
  },
  draw(results) {
    const { ctx, canvas } = this;
    if (!ctx || !this.active) return;
    const w = canvas.width, h = canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(results.segmentationMask, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-in";
    ctx.drawImage(results.image, 0, 0, w, h);
    ctx.globalCompositeOperation = "destination-over";
    if (this.mode === "blur" || this.mode === "blur-light") {
      ctx.filter = `blur(${this.mode === "blur" ? 14 : 6}px)`;
      ctx.drawImage(results.image, 0, 0, w, h);
      ctx.filter = "none";
    } else if (this.bgCanvas) {
      drawCover(ctx, this.bgCanvas, w, h);
    }
    ctx.restore();
  },
  stop() {
    this.ticker?.stop();
    this.ticker = null;
    this.track?.stop();
    this.track = null;
    if (this.video) { this.video.srcObject = null; this.video = null; }
    this.active = false;
    this.mode = "none";
    this.busy = false;
    this.avgMs = 0;
    this.nextAt = 0;
    this.slowFrames = 0;
  },
};

function setBgStatus(text) {
  const el = $("#bg-status");
  if (el) el.textContent = text;
}
function renderBgGrid() {
  const grid = $("#bg-grid");
  if (!grid) return;
  const current = BgFx.active ? BgFx.mode : "none";
  grid.innerHTML = BG_PRESETS.map((p) => {
    let style = "";
    let icon = "";
    if (p.id.startsWith("img:")) style = `background-image:url(${makePresetBackground(p.id, 256, 144).toDataURL("image/jpeg", 0.7)})`;
    else if (p.id === "none") icon = '<i class="bi bi-slash-circle fs-4 d-block"></i>';
    else if (p.id === "custom") icon = '<i class="bi bi-upload fs-4 d-block"></i>';
    else icon = `<i class="bi bi-droplet-half fs-4 d-block" style="filter:blur(${p.id === "blur" ? 2 : 1}px)"></i>`;
    return `<div class="bg-thumb ${current === p.id ? "active" : ""}" data-bg="${p.id}" style="${style}">
      <div class="text-center">${icon}${escapeHtml(p.label)}</div></div>`;
  }).join("");
}
$("#bg-grid").addEventListener("click", (e) => {
  const t = e.target.closest("[data-bg]");
  if (!t) return;
  if (t.dataset.bg === "custom") { $("#bg-upload").click(); return; }
  BgFx.apply(t.dataset.bg);
});
$("#bg-upload").addEventListener("change", (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = 1280; c.height = 720;
    drawCover(c.getContext("2d"), img, 1280, 720);
    BgFx.customCanvas = c;
    URL.revokeObjectURL(img.src);
    BgFx.apply("custom");
  };
  img.src = URL.createObjectURL(f);
});
function openBgModal() {
  renderBgGrid();
  setBgStatus("Le détourage est calculé sur votre appareil (MediaPipe) : aucune image n'est envoyée sur un serveur.");
  bootstrap.Modal.getOrCreateInstance($("#bgModal")).show();
}

/* ---------- 6. Écran de préparation ---------- */
async function joinMeeting(meetingId, title) {
  if (state.currentMeetingId) leaveMeeting({ stayOnPage: true });
  state.pendingRoom = { meetingId, title };
  $("#prejoin-title").textContent = title || "Réunion";
  $("#prejoin-avatar").textContent = initials(state.user?.name || "");
  $("#prejoin-presence").textContent = "";
  updateMirror();
  showPage("prejoin-page");

  if (!state.rawStream) state.rawStream = await acquireMedia();
  if (state.pendingRoom?.meetingId !== meetingId) return; // annulé entre-temps
  state.micOn = state.desiredMicOn !== false && !!state.rawStream.getAudioTracks()[0];
  state.camOn = state.desiredCamOn !== false && !!state.rawStream.getVideoTracks()[0];
  if (state.prefs.bgMode !== "none" && !BgFx.active && state.rawStream.getVideoTracks()[0]) {
    BgFx.apply(state.prefs.bgMode, { silent: true });
  }
  refreshOutgoing();
  updatePrejoinUI();
  refreshDeviceLists();
  showPresence(meetingId);
}

function updatePrejoinUI() {
  const mic = $("#prejoin-mic"), cam = $("#prejoin-cam");
  mic.classList.toggle("off", !state.micOn);
  mic.querySelector("i").className = state.micOn ? "bi bi-mic-fill" : "bi bi-mic-mute-fill";
  cam.classList.toggle("off", !state.camOn);
  cam.querySelector("i").className = state.camOn ? "bi bi-camera-video-fill" : "bi bi-camera-video-off-fill";
  $("#prejoin-tile").classList.toggle("cam-off", !state.camOn);
}

async function showPresence(meetingId) {
  const el = $("#prejoin-presence");
  if (!firebaseReady) { el.textContent = "Mode démo"; return; }
  try {
    const [mdoc, snap] = await Promise.all([
      db.collection("meetings").doc(meetingId).get(),
      db.collection("meetings").doc(meetingId).collection("participants").get(),
    ]);
    const names = snap.docs.map((d) => d.data()).filter(isParticipantActive).map((d) => d.name);
    const unique = [...new Set(names)];
    let txt = unique.length === 0
      ? "Personne n'est encore là"
      : `${unique.length} personne${unique.length > 1 ? "s" : ""} déjà présente${unique.length > 1 ? "s" : ""} : ${unique.slice(0, 4).join(", ")}${unique.length > 4 ? "…" : ""}`;
    const m = mdoc.exists ? mdoc.data() : {};
    if (m.description) txt += ` · ${m.description.slice(0, 140)}`;
    el.textContent = txt;
  } catch (_) { el.textContent = ""; }
}

$("#prejoin-mic").addEventListener("click", () => {
  if (!state.rawStream?.getAudioTracks()[0]) { showToast("Aucun micro détecté", "warning"); return; }
  state.micOn = !state.micOn;
  applyTrackEnabled();
  updatePrejoinUI();
});
$("#prejoin-cam").addEventListener("click", () => {
  if (!state.rawStream?.getVideoTracks()[0]) { showToast("Aucune caméra détectée", "warning"); return; }
  state.camOn = !state.camOn;
  applyTrackEnabled();
  updatePrejoinUI();
});
$("#prejoin-bg").addEventListener("click", openBgModal);
$("#prejoin-cancel-btn").addEventListener("click", cancelPrejoin);

function cancelPrejoin() {
  state.pendingRoom = null;
  stopRawMedia();
  Levels.reset();
  showPage(state.user ? "home-page" : "auth-page");
}

$("#prejoin-join-btn").addEventListener("click", async () => {
  const room = state.pendingRoom;
  if (!room) return;
  const btn = $("#prejoin-join-btn");
  btn.disabled = true;
  state.desiredMicOn = state.micOn;
  state.desiredCamOn = state.camOn;
  const ok = await admissionCheck(room.meetingId);
  btn.disabled = false;
  if (!ok || state.pendingRoom !== room) return;
  state.pendingRoom = null;
  startRoom(room.meetingId, room.title);
});

function startRoom(meetingId, title) {
  state.meetingJoinedAt = Date.now();
  enterMeetingRoom(meetingId, title);
}

/* ---------- 7. Admission : réunion verrouillée / terminée / salle d'attente ---------- */
async function admissionCheck(meetingId) {
  if (!firebaseReady) return true;
  let data;
  try {
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) { showToast("Réunion introuvable", "danger"); return false; }
    data = doc.data();
  } catch (e) { console.warn(e); return true; }

  if (data.ownerId === state.user.uid || data.isBreakout || (data.coHostIds || []).includes(state.user.uid)) return true;
  if (data.endedAt) {
    showToast("Cette réunion est terminée. Attendez que l'organisateur la relance.", "warning");
    return false;
  }
  const st = { ...DEFAULT_MEETING_SETTINGS, ...(data.settings || {}) };
  if (st.locked) { showToast("🔒 Cette réunion est verrouillée par l'organisateur", "danger"); return false; }
  if (!st.waitingRoom) return true;
  return waitForAdmission(meetingId);
}

function waitForAdmission(meetingId) {
  return new Promise(async (resolve) => {
    const ref = db.collection("meetings").doc(meetingId).collection("waiting").doc(state.user.uid);
    try {
      const existing = await ref.get();
      if (existing.exists && existing.data().approved === true) { resolve(true); return; }
      await ref.set({
        uid: state.user.uid,
        name: state.user.name,
        email: state.user.email || "",
        approved: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      showToast("Salle d'attente indisponible : " + e.message, "danger");
      resolve(false);
      return;
    }
    const modal = bootstrap.Modal.getOrCreateInstance($("#waitingRoomModal"));
    modal.show();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      unsub();
      modal.hide();
      state.cancelWaiting = null;
      resolve(ok);
    };
    const unsub = ref.onSnapshot((snap) => {
      const d = snap.data();
      if (d?.approved === true) {
        showToast("✅ Vous avez été admis(e)", "success");
        finish(true);
      } else if (d?.approved === false || !snap.exists) {
        showToast("❌ L'organisateur n'a pas accepté votre demande", "danger");
        finish(false);
        cancelPrejoin();
      }
    }, (err) => { permissionWarn(err); finish(false); });
    state.cancelWaiting = () => {
      ref.delete().catch(() => {});
      finish(false);
    };
  });
}
$("#waiting-cancel-btn").addEventListener("click", () => state.cancelWaiting?.());

$("#admit-all-btn").addEventListener("click", async () => {
  for (const w of state.waitingList || []) await approveWaiting(w.id);
});

/* ---------- 8. Entrée / sortie de réunion : branchement de tous les modules ---------- */
function onMeetingEntered(meetingId) {
  state.meetingCleanups = state.meetingCleanups || [];
  const add = (fn) => { if (typeof fn === "function") state.meetingCleanups.push(fn); };

  $("#local-avatar").textContent = initials(state.user.name);
  $("#host-controls").style.display = state.isOrganizer ? "" : "none";
  Levels.attachLocal();
  NetStats.start();
  Layout.apply();
  applySpeaker();
  updateChatBadge();

  add(rt.listenMeeting(meetingId, (data) => {
    state.meetingData = data;
    applyMeetingDoc(data);
  }));
  add(Polls.listen(meetingId));
  add(QA.listen(meetingId));
  add(Whiteboard.listen(meetingId));
  add(watchBreakoutParent());

  if (!firebaseReady) {
    state.myPeerId = "demo-local";
    state.allParticipants = [{
      peerId: state.myPeerId, userId: state.user.uid, name: state.user.name,
      micOn: state.micOn, camOn: state.camOn, isOrganizer: state.isOrganizer,
    }];
    renderParticipantsList();
  }

  // Relancer une réunion terminée quand l'organisateur revient
  if (state.isOrganizer) rt.updateMeeting(meetingId, { endedAt: rt.del() }).catch(() => {});
  applyMeetingPolicies();
  Assistant.onEntered(meetingId);
}

function runMeetingCleanups(opts = {}) {
  Assistant.onLeaving();
  (state.meetingCleanups || []).forEach((fn) => { try { fn(); } catch (_) {} });
  state.meetingCleanups = [];
  Levels.reset();
  NetStats.stop();
  Layout.reset();
  Captions.reset();
  Whiteboard.reset();
  Breakout.stopTimer();
  state.meetingData = null;
  state.knownPeers = null;
  state.knownHands = null;
  state.chatUnread = 0;
  updateChatBadge();
  state.handRaised = false;
  $("#raise-hand-btn").classList.remove("hand-raised");
  ["#transcript-badge", "#lock-badge", "#breakout-banner", "#spotlight-banner"].forEach((s) => { $(s).style.display = "none"; });
  $("#waiting-badge").classList.remove("show");
  $("#ai-answers").innerHTML = "";
  $("#notes-area").value = "";
  $("#chat-to").innerHTML = '<option value="">À : tout le monde</option>';
  $("#chat-to").dataset.signature = "";
  if (!opts.stayOnPage) state.breakoutParent = null;
}

/* Applique le document réunion (réglages, badges, mise en avant, salles, fin) */
function applyMeetingDoc(data) {
  Assistant.onMeetingDoc(data);
  $("#transcript-badge").style.display = data.transcriptionActive ? "" : "none";
  updateRecBadge();
  applyMeetingPolicies();
  Notes.onRemote(data);

  // Mise en avant (spotlight)
  const spot = data.spotlightPeerId;
  const spotBanner = $("#spotlight-banner");
  if (spot) {
    const name = spot === state.myPeerId ? "Vous êtes" : `${escapeHtml(state.participantNames[spot] || "Un participant")} est`;
    spotBanner.innerHTML = `<i class="bi bi-star-fill"></i> ${name} mis(e) en avant par l'organisateur`;
    spotBanner.style.display = "";
  } else {
    spotBanner.style.display = "none";
  }
  Layout.apply();
  renderParticipantsList();

  // Fin de réunion décidée par l'organisateur
  if (data.endedAt && !state.isOrganizer && state.currentMeetingId) {
    showToast("La réunion a été terminée par l'organisateur", "warning");
    setTimeout(() => leaveMeeting(), 300);
    return;
  }
  // Salles de sous-commission (vu depuis la salle principale)
  if (!data.isBreakout) Breakout.onParentState(data);
}

function applyMeetingPolicies() {
  const st = meetingSettings();
  const host = state.isOrganizer;
  const chatOk = host || st.chatEnabled;
  const input = $("#chat-input");
  input.disabled = !chatOk;
  input.placeholder = chatOk ? "Écrire un message..." : "Le chat est désactivé par l'organisateur";
  $("#toggle-screen").classList.toggle("opacity-50", !(host || st.shareEnabled));
  $("#toggle-record").style.display = host || st.recordEnabled ? "" : "none";
  $("#poll-form").style.display = host ? "" : "none";
  $("#lock-badge").style.display = st.locked ? "" : "none";
  document.querySelectorAll(".host-setting").forEach((cb) => { cb.checked = !!st[cb.dataset.setting]; });
}

document.querySelectorAll(".host-setting").forEach((cb) => {
  cb.addEventListener("change", async () => {
    if (!state.isOrganizer || !state.currentMeetingId) return;
    try {
      await rt.updateMeeting(state.currentMeetingId, { [`settings.${cb.dataset.setting}`]: cb.checked });
    } catch (e) { permissionWarn(e); cb.checked = !cb.checked; }
  });
});

function updateRecBadge() {
  const d = state.meetingData || {};
  const visible = state.isRecording || !!d.recordingActive;
  $("#rec-badge").style.display = visible ? "" : "none";
  $("#rec-badge-text").textContent = state.isRecording || !d.recordingBy
    ? "ENREGISTREMENT"
    : `ENREGISTREMENT · ${d.recordingBy}`;
}

/* ---------- 9. Tuiles distantes ---------- */
function onRemoteStreamAdded(peerId, stream) {
  Levels.attach(peerId, stream);
  const p = (state.allParticipants || []).find((x) => x.peerId === peerId);
  if (p) updateRemoteTileState(p);
  applySpeaker();
  Recorder.addStream(stream);
  Layout.apply();
}
function onRemoteStreamRemoved(peerId) {
  Levels.detach(peerId);
  NetStats.forget(peerId);
  if (Layout.pinned === `tile-${peerId}`) Layout.pinned = null;
  Layout.apply();
}
function updateRemoteTileState(p) {
  const tile = document.getElementById(`tile-${p.peerId}`);
  if (!tile) return;
  tile.classList.toggle("cam-off", p.camOn === false);
  const mic = tile.querySelector(".tile-mic");
  if (mic) mic.style.display = p.micOn === false ? "" : "none";
  const nm = tile.querySelector(".tile-name");
  if (nm && p.name && nm.textContent !== p.name) {
    nm.textContent = p.name;
    tile.querySelector(".tile-avatar span").textContent = initials(p.name);
  }
}

function onParticipantsUpdated(list) {
  list.forEach((p) => {
    if (p.name) state.participantNames[p.peerId] = p.name;
    if (p.peerId !== state.myPeerId) updateRemoteTileState(p);
  });
  const ids = new Set(list.map((p) => p.peerId));
  const hands = new Set(list.filter((p) => p.handRaised).map((p) => p.peerId));
  if (state.knownPeers) {
    list.filter((p) => !state.knownPeers.has(p.peerId) && p.peerId !== state.myPeerId).forEach((p) => {
      showToast(`👋 ${p.name} a rejoint la réunion`, "info");
      playSound("join");
    });
    if ([...state.knownPeers].some((id) => !ids.has(id) && id !== state.myPeerId)) playSound("leave");
    list.filter((p) => p.handRaised && !state.knownHands.has(p.peerId) && p.peerId !== state.myPeerId).forEach((p) => {
      showToast(`✋ ${p.name} lève la main`, "warning");
      playSound("hand");
    });
  }
  state.knownPeers = ids;
  state.knownHands = hands;
  updateChatRecipients(list);
  Layout.apply();
}

/* ---------- 10. Mises en page : mosaïque, orateur, épingler, plein écran, PiP ---------- */
const Layout = {
  mode: "grid", pinned: null,
  set(mode) {
    this.mode = mode;
    this.apply();
    showToast(mode === "grid" ? "Mise en page : mosaïque" : "Mise en page : orateur actif", "secondary");
  },
  togglePin(tileId) {
    this.pinned = this.pinned === tileId ? null : tileId;
    this.apply();
  },
  mainTileId() {
    const spot = state.meetingData?.spotlightPeerId;
    if (spot) {
      const id = spot === state.myPeerId ? "local-tile" : `tile-${spot}`;
      if (document.getElementById(id)) return id;
    }
    if (this.pinned && document.getElementById(this.pinned)) return this.pinned;
    if (this.mode !== "speaker") return null;
    if (Levels.activeId && document.getElementById(`tile-${Levels.activeId}`)) return `tile-${Levels.activeId}`;
    const firstRemote = document.querySelector("#videos-grid .video-tile.remote:not(.presenter)");
    return firstRemote ? firstRemote.id : "local-tile";
  },
  apply() {
    const grid = $("#videos-grid");
    if (!grid) return;
    const main = this.mainTileId();
    grid.classList.toggle("layout-speaker", !!main);
    grid.classList.toggle("hide-self", !!state.prefs.hideSelf);
    grid.querySelectorAll(".video-tile").forEach((t) => {
      t.classList.toggle("main-tile", t.id === main);
      t.classList.toggle("pinned", t.id === this.pinned);
      // La tuile principale passe en premier (via l'ordre CSS : déplacer la vidéo la mettrait en pause)
      t.style.order = t.id === main ? "-1" : "";
    });
  },
  reset() {
    this.pinned = null;
    this.mode = "grid";
    this.apply();
  },
};

$("#videos-grid").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tile-action]");
  if (!btn) return;
  const tile = btn.closest(".video-tile");
  const action = btn.dataset.tileAction;
  if (action === "pin") Layout.togglePin(tile.id);
  if (action === "fullscreen") tile.requestFullscreen?.().catch(() => {});
  if (action === "pip") requestPip(tile.querySelector("video"));
});
$("#videos-grid").addEventListener("dblclick", (e) => {
  const tile = e.target.closest(".video-tile");
  if (tile && !e.target.closest("button")) Layout.togglePin(tile.id);
});

async function requestPip(video) {
  if (!video || !document.pictureInPictureEnabled) {
    showToast("Image dans l'image non prise en charge par ce navigateur", "warning");
    return;
  }
  try {
    if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch (e) { showToast("Image dans l'image : " + e.message, "warning"); }
}

/* ---------- 11. Qualité de connexion par participant ---------- */
const NetStats = {
  prev: {}, timer: null,
  start() { if (!this.timer) this.timer = setInterval(() => this.poll(), 4000); },
  stop() { clearInterval(this.timer); this.timer = null; this.prev = {}; },
  forget(id) { delete this.prev[id]; },
  async poll() {
    for (const [peerId, call] of Object.entries(state.calls || {})) {
      const pc = call.peerConnection;
      if (!pc) continue;
      try {
        const stats = await pc.getStats();
        let rtt = null, lost = 0, recv = 0;
        stats.forEach((r) => {
          if (r.type === "candidate-pair" && r.state === "succeeded" && r.nominated && r.currentRoundTripTime != null) {
            rtt = r.currentRoundTripTime * 1000;
          }
          if (r.type === "inbound-rtp") { lost += r.packetsLost || 0; recv += r.packetsReceived || 0; }
        });
        const p = this.prev[peerId] || { lost, recv };
        const dLost = Math.max(0, lost - p.lost), dRecv = Math.max(0, recv - p.recv);
        this.prev[peerId] = { lost, recv };
        const loss = dRecv + dLost > 0 ? dLost / (dRecv + dLost) : 0;
        let q = "good";
        if ((rtt != null && rtt > 400) || loss > 0.08) q = "poor";
        else if ((rtt != null && rtt > 180) || loss > 0.02) q = "fair";
        const ind = document.querySelector(`#tile-${CSS.escape(peerId)} .net-ind`);
        if (ind) {
          const icon = { good: "bi-reception-4", fair: "bi-reception-2", poor: "bi-reception-1" }[q];
          const label = { good: "bonne", fair: "moyenne", poor: "faible" }[q];
          ind.className = `bi ${icon} net-ind ${q}`;
          ind.title = `Connexion ${label}${rtt != null ? ` · ${Math.round(rtt)} ms` : ""} · ${(loss * 100).toFixed(1)} % de pertes`;
        }
      } catch (_) {}
    }
  },
};

/* ---------- 12. Sous-titres en direct + traduction ---------- */
const Captions = {
  on: false, translations: {}, pending: new Set(), timer: null,
  toggle() {
    if (!this.on) {
      const active = state.isTranscribing || state.meetingData?.transcriptionActive;
      if (!active) {
        if (state.isOrganizer) {
          startTranscription();
        } else {
          showToast("Les sous-titres utilisent la transcription : demande envoyée à l'organisateur", "info");
          sendCommand({ type: "captionsRequest" });
          return;
        }
      }
    }
    this.on = !this.on;
    $("#toggle-captions").classList.toggle("active", this.on);
    $("#captions-overlay").classList.toggle("show", this.on);
    clearInterval(this.timer);
    if (this.on) this.timer = setInterval(() => renderCaptions(""), 2000);
    renderCaptions("");
  },
  reset() {
    this.on = false;
    clearInterval(this.timer);
    this.timer = null;
    $("#toggle-captions").classList.remove("active");
    $("#captions-overlay").classList.remove("show");
    $("#captions-overlay").innerHTML = "";
  },
};
$("#toggle-captions").addEventListener("click", () => Captions.toggle());

function captionText(entry) {
  const lang = state.prefs.captionLang;
  if (!lang || !GEMINI_CONFIG.apiKey) return entry.text;
  const key = `${lang}|${entry.text}`;
  if (Captions.translations[key]) return Captions.translations[key];
  if (!Captions.pending.has(key)) {
    Captions.pending.add(key);
    callGemini(`Traduis ce sous-titre de réunion en ${lang}. Réponds uniquement par la traduction, sans guillemets.\n\n${entry.text}`, { temperature: 0.2 })
      .then((t) => { Captions.translations[key] = t.trim() || entry.text; renderCaptions(""); })
      .catch(() => { Captions.translations[key] = entry.text; });
  }
  return entry.text;
}

function renderCaptions(interim) {
  if (!Captions.on) return;
  const el = $("#captions-overlay");
  const now = Date.now();
  const source = state.transcriptEntries?.length ? state.transcriptEntries : (state.localTranscriptEntries || []);
  const recent = source.filter((e) => now - e.timestamp < 12000).slice(-2);
  let html = recent.map((e) => `<div class="caption-line"><strong>${escapeHtml(e.userName)}</strong>${escapeHtml(captionText(e))}</div>`).join("");
  if (interim) html += `<div class="caption-line interim"><strong>${escapeHtml(state.user?.name || "Vous")}</strong>${escapeHtml(interim)}</div>`;
  el.innerHTML = html;
}

/* ---------- 13. Enregistrement vidéo de la réunion (mosaïque + audio de tous) ---------- */
const Recorder = {
  dest: null, sources: [], canvas: null, ctx: null, ticker: null, rec: null, chunks: [],
  startedAt: 0, title: "",
  start() {
    const actx = getAudioCtx();
    this.dest = actx.createMediaStreamDestination();
    this.sources = [];
    this.localTrack = getOutAudioTrack();
    this.addTrack(this.localTrack);
    Object.values(state.remoteStreams || {}).forEach((s) => this.addStream(s));
    Object.values(state.remoteScreenStreams || {}).forEach((s) => this.addStream(s));
    if (state.screenStream) this.addStream(state.screenStream);

    this.canvas = document.createElement("canvas");
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx = this.canvas.getContext("2d");
    this.title = state.currentMeetingTitle || "reunion";
    this.startedAt = Date.now();
    this.ticker = createTicker(20, () => this.drawFrame());
    const vTrack = this.canvas.captureStream(20).getVideoTracks()[0];
    const mixed = new MediaStream([vTrack, ...this.dest.stream.getAudioTracks()]);
    const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
    const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
    this.chunks = [];
    try {
      this.rec = new MediaRecorder(mixed, mimeType ? { mimeType, videoBitsPerSecond: 2500000 } : {});
      this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      this.rec.onstop = () => this.save();
      this.rec.start(1000);
    } catch (e) {
      console.warn("Enregistrement vidéo indisponible :", e);
      this.rec = null;
    }
    if (state.currentMeetingId) {
      rt.updateMeeting(state.currentMeetingId, { recordingActive: true, recordingBy: state.user.name }).catch(() => {});
    }
    return new MediaStream(this.dest.stream.getAudioTracks());
  },
  addStream(stream) {
    const t = stream?.getAudioTracks?.()[0];
    if (t) this.addTrack(t);
  },
  addTrack(track) {
    if (!this.dest || !track) return;
    try {
      const src = getAudioCtx().createMediaStreamSource(new MediaStream([track]));
      src.connect(this.dest);
      this.sources.push(src);
    } catch (_) {}
  },
  drawFrame() {
    const { ctx, canvas } = this;
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#1f1f1f";
    ctx.fillRect(0, 0, W, H);
    const tiles = [...document.querySelectorAll("#videos-grid .video-tile")].filter((t) => t.offsetParent !== null);
    const main = tiles.find((t) => t.classList.contains("presenter")) || tiles.find((t) => t.classList.contains("main-tile"));
    if (main && tiles.length > 1) {
      this.drawTile(main, 0, 0, W * 0.78, H, true);
      const others = tiles.filter((t) => t !== main).slice(0, 5);
      const h = H / Math.max(others.length, 4);
      others.forEach((t, i) => this.drawTile(t, W * 0.78 + 6, i * h + 3, W * 0.22 - 9, h - 6));
    } else {
      const n = Math.max(tiles.length, 1);
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const w = W / cols, h = H / rows;
      tiles.forEach((t, i) => this.drawTile(t, (i % cols) * w + 4, Math.floor(i / cols) * h + 4, w - 8, h - 8));
    }
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(W - 150, 10, 140, 28);
    ctx.fillStyle = "#ff5c5c";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(`● REC ${fmtDuration(Date.now() - this.startedAt)}`, W - 138, 30);
  },
  drawTile(tile, x, y, w, h, contain = false) {
    const ctx = this.ctx;
    const v = tile.querySelector("video");
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
    const name = tile.querySelector(".video-label span")?.textContent || "";
    if (v && v.readyState >= 2 && !tile.classList.contains("cam-off")) {
      ctx.translate(x, y);
      drawCover(ctx, v, w, h, contain);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      ctx.fillStyle = "#2b2d31";
      ctx.fillRect(x, y, w, h);
      const r = Math.min(w, h) * 0.18;
      ctx.fillStyle = "#4f52b2";
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `600 ${Math.round(r * 0.8)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(name.replace(/\(vous\)/, "")), x + w / 2, y + h / 2);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
    if (name) {
      ctx.font = "13px sans-serif";
      const tw = ctx.measureText(name).width;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x + 8, y + h - 30, tw + 16, 22);
      ctx.fillStyle = "#fff";
      ctx.fillText(name, x + 16, y + h - 14);
    }
    if (tile.classList.contains("speaking")) {
      ctx.strokeStyle = "#2ecc71";
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    }
    ctx.restore();
  },
  stop() {
    this.ticker?.stop();
    this.ticker = null;
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    this.sources.forEach((s) => { try { s.disconnect(); } catch (_) {} });
    this.sources = [];
    this.dest = null;
    if (state.currentMeetingId) {
      rt.updateMeeting(state.currentMeetingId, { recordingActive: false }).catch(() => {});
    }
  },
  save() {
    if (!this.chunks.length) return;
    const type = this.rec?.mimeType || "video/webm";
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    downloadBlob(blob, `Enregistrement_${safeName(this.title)}_${stamp}.${ext}`);
    showToast("🎬 Vidéo de la réunion téléchargée", "success");
  },
};

/* ---------- 14. Chat enrichi : privé, emojis, fichiers, non lus ---------- */
state.chatUnread = 0;
function chatVisible() {
  return !$("#side-panel").classList.contains("collapsed") && $("#chat-pane").classList.contains("active");
}
function updateChatBadge() {
  const b = $("#chat-unread");
  b.textContent = state.chatUnread > 9 ? "9+" : state.chatUnread;
  b.classList.toggle("show", state.chatUnread > 0);
}
function clearChatUnread() {
  if (!chatVisible()) return;
  state.chatUnread = 0;
  updateChatBadge();
}
function onChatMessageRendered(msg, isOwn) {
  if (isOwn) return;
  const t = tsOf(msg.createdAt) || Date.now();
  if (state.meetingJoinedAt && t < state.meetingJoinedAt - 2000) return; // historique
  if (chatVisible()) return;
  state.chatUnread++;
  updateChatBadge();
  playSound("message");
  showToast(`💬 ${msg.userName || ""} : ${(msg.text || msg.fileName || "").slice(0, 80)}`, "dark");
}
$("#toggle-chat-btn").addEventListener("click", () => {
  if (!$("#side-panel").classList.contains("collapsed")) {
    document.querySelector('[data-bs-target="#chat-pane"]').click();
  }
  setTimeout(clearChatUnread, 0);
});
document.querySelector('[data-bs-target="#chat-pane"]').addEventListener("shown.bs.tab", clearChatUnread);

function updateChatRecipients(list) {
  const sel = $("#chat-to");
  const cur = sel.value;
  const seen = new Set();
  const others = list.filter((p) => {
    if (!p.userId || p.userId === state.user.uid || seen.has(p.userId)) return false;
    seen.add(p.userId);
    return true;
  });
  // Ne reconstruire la liste que si elle change (le battement de présence arrive toutes les 10 s)
  const signature = others.map((p) => `${p.userId}:${p.name}`).join("|");
  if (sel.dataset.signature === signature) return;
  sel.dataset.signature = signature;
  sel.innerHTML = '<option value="">À : tout le monde</option>' +
    others.map((p) => `<option value="${escapeHtml(p.userId)}">${escapeHtml(p.name)}</option>`).join("");
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
function openPrivateChat(userId) {
  $("#side-panel").classList.remove("collapsed");
  document.querySelector('[data-bs-target="#chat-pane"]').click();
  const sel = $("#chat-to");
  if ([...sel.options].some((o) => o.value === userId)) sel.value = userId;
  $("#chat-input").focus();
}

const EMOJIS = ["😀", "😂", "😊", "😍", "🤔", "😮", "😢", "😡", "👍", "👎", "👏", "🙏", "💪", "🎉", "🔥", "❤️",
  "✅", "❌", "⭐", "💡", "📌", "📎", "⏰", "☕", "👋", "🙌", "🤝", "💯", "🚀", "📈", "🇨🇩", "🌍"];
$("#emoji-pop").innerHTML = EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("");
$("#emoji-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#emoji-pop").classList.toggle("show");
});
$("#emoji-pop").addEventListener("click", (e) => {
  const b = e.target.closest("[data-emoji]");
  if (!b) return;
  const input = $("#chat-input");
  const pos = input.selectionStart ?? input.value.length;
  input.value = input.value.slice(0, pos) + b.dataset.emoji + input.value.slice(pos);
  input.focus();
  $("#emoji-pop").classList.remove("show");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#emoji-pop") && !e.target.closest("#emoji-btn")) $("#emoji-pop").classList.remove("show");
});

$("#chat-file-btn").addEventListener("click", () => {
  if (!canDo("chatEnabled")) { showToast("L'organisateur a désactivé le chat", "warning"); return; }
  if (!firebaseReady || !storage) { showToast("Le partage de fichiers nécessite Firebase Storage", "warning"); return; }
  $("#chat-file-input").click();
});
$("#chat-file-input").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f || !state.currentMeetingId) return;
  if (f.size > 25 * 1024 * 1024) { showToast("Fichier trop lourd (25 Mo maximum)", "warning"); return; }
  showToast(`📤 Envoi de ${f.name}…`, "info");
  try {
    const path = `chat-files/${state.currentMeetingId}/${Date.now()}_${f.name.replace(/[^\w.\-]+/g, "_")}`;
    const ref = storage.ref(path);
    await ref.put(f, { contentType: f.type || "application/octet-stream" });
    const url = await ref.getDownloadURL();
    await sendChatMessage({ fileName: f.name, fileUrl: url, fileSize: f.size });
  } catch (err) {
    permissionWarn(err);
    showToast("Échec de l'envoi : " + err.message, "danger");
  }
});

/* ---------- 15. Sondages ---------- */
const Polls = {
  list: [], known: null, path: null,
  listen(meetingId) {
    this.path = rt.coll(meetingId, "polls");
    this.known = null;
    return rt.listen(this.path, (docs) => {
      this.list = docs.sort((a, b) => (tsOf(b.createdAt) || Date.now()) - (tsOf(a.createdAt) || Date.now()));
      const ids = new Set(docs.map((d) => d.id));
      if (this.known && !state.isOrganizer) {
        docs.filter((d) => !this.known.has(d.id)).forEach((d) => {
          showToast(`📊 Nouveau sondage : ${d.question}`, "primary");
          playSound("message");
        });
      }
      this.known = ids;
      this.render();
    });
  },
  render() {
    const el = $("#polls-list");
    if (!this.list.length) { el.innerHTML = '<div class="text-center text-muted small py-3">Aucun sondage pour le moment</div>'; return; }
    const uid = state.user.uid;
    el.innerHTML = this.list.map((p) => {
      const votes = p.votes || {};
      const total = Object.keys(votes).length;
      const counts = (p.options || []).map((_, i) => Object.values(votes).filter((v) => v === i).length);
      const mine = votes[uid];
      const showResults = p.closed || mine !== undefined || state.isOrganizer;
      const body = showResults
        ? (p.options || []).map((o, i) => {
            const pct = total ? Math.round((counts[i] / total) * 100) : 0;
            const who = !p.anonymous && state.isOrganizer
              ? Object.entries(votes).filter(([, v]) => v === i).map(([u]) => p.voterNames?.[u] || "?").join(", ")
              : "";
            return `<div class="poll-bar" title="${escapeHtml(who)}"><div class="fill" style="width:${pct}%"></div>
              <span>${mine === i ? "✓ " : ""}${escapeHtml(o)} — <strong>${pct} %</strong> (${counts[i]})</span></div>`;
          }).join("")
        : (p.options || []).map((o, i) => `<button class="btn btn-sm btn-outline-primary w-100 mb-1 poll-opt-btn" data-poll-vote="${p.id}" data-idx="${i}">${escapeHtml(o)}</button>`).join("");
      const hostBtns = state.isOrganizer ? `
        <div class="d-flex gap-1 mt-2">
          ${p.closed ? "" : `<button class="btn btn-sm btn-outline-secondary" data-poll-close="${p.id}"><i class="bi bi-stop-circle"></i> Clôturer</button>`}
          <button class="btn btn-sm btn-outline-danger ms-auto" data-poll-delete="${p.id}"><i class="bi bi-trash"></i></button>
        </div>` : "";
      return `<div class="act-card">
        <div class="d-flex align-items-start gap-2 mb-2">
          <div class="fw-semibold flex-fill">${escapeHtml(p.question)}</div>
          ${p.closed ? '<span class="badge bg-secondary">Clôturé</span>' : '<span class="badge bg-success">En cours</span>'}
        </div>
        ${body}
        <div class="text-muted" style="font-size:.7rem;">${total} vote${total > 1 ? "s" : ""} · ${p.anonymous ? "anonyme" : "nominatif"} · par ${escapeHtml(p.createdBy || "")}</div>
        ${hostBtns}
      </div>`;
    }).join("");
  },
};
$("#poll-add-option").addEventListener("click", () => {
  const box = $("#poll-options");
  if (box.children.length >= 6) return;
  const inp = document.createElement("input");
  inp.className = "form-control form-control-sm mb-1 poll-option";
  inp.placeholder = `Option ${box.children.length + 1}`;
  inp.maxLength = 100;
  box.appendChild(inp);
});
$("#poll-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = $("#poll-question").value.trim();
  const options = [...document.querySelectorAll(".poll-option")].map((i) => i.value.trim()).filter(Boolean);
  if (!question || options.length < 2) { showToast("Il faut une question et au moins 2 options", "warning"); return; }
  try {
    await rt.add(Polls.path, {
      question, options, anonymous: $("#poll-anonymous").checked,
      votes: {}, voterNames: {}, closed: false,
      createdBy: state.user.name, createdAt: rt.now(),
    });
    $("#poll-form").reset();
    $("#poll-options").innerHTML = `
      <input class="form-control form-control-sm mb-1 poll-option" placeholder="Option 1" required maxlength="100" />
      <input class="form-control form-control-sm mb-1 poll-option" placeholder="Option 2" required maxlength="100" />`;
    showToast("📊 Sondage lancé", "success");
  } catch (err) { permissionWarn(err); showToast("Sondage non créé : " + err.message, "danger"); }
});
$("#polls-list").addEventListener("click", async (e) => {
  const vote = e.target.closest("[data-poll-vote]");
  const close = e.target.closest("[data-poll-close]");
  const del = e.target.closest("[data-poll-delete]");
  try {
    if (vote) {
      const poll = Polls.list.find((p) => p.id === vote.dataset.pollVote);
      const upd = { [`votes.${state.user.uid}`]: Number(vote.dataset.idx) };
      if (poll && !poll.anonymous) upd[`voterNames.${state.user.uid}`] = state.user.name;
      await rt.update(Polls.path, vote.dataset.pollVote, upd);
    }
    if (close) await rt.update(Polls.path, close.dataset.pollClose, { closed: true });
    if (del && (await askConfirm("Supprimer ce sondage ?", "Les résultats seront perdus.", "Supprimer"))) {
      await rt.remove(Polls.path, del.dataset.pollDelete);
    }
  } catch (err) { permissionWarn(err); }
});

/* ---------- 16. Questions-réponses ---------- */
const QA = {
  list: [], known: null, path: null,
  listen(meetingId) {
    this.path = rt.coll(meetingId, "questions");
    this.known = null;
    return rt.listen(this.path, (docs) => {
      this.list = docs.sort((a, b) =>
        (a.answered === b.answered ? 0 : a.answered ? 1 : -1) ||
        ((b.upvotes || []).length - (a.upvotes || []).length) ||
        (tsOf(a.createdAt) - tsOf(b.createdAt)));
      const ids = new Set(docs.map((d) => d.id));
      if (this.known && state.isOrganizer) {
        docs.filter((d) => !this.known.has(d.id) && d.userId !== state.user.uid).forEach(() => {
          showToast("❓ Nouvelle question dans Q&R", "info");
          playSound("message");
        });
      }
      this.known = ids;
      this.render();
    });
  },
  render() {
    const el = $("#qa-list");
    if (!this.list.length) { el.innerHTML = '<div class="text-center text-muted small py-3">Aucune question</div>'; return; }
    const uid = state.user.uid;
    el.innerHTML = this.list.map((q) => {
      const ups = q.upvotes || [];
      const mine = ups.includes(uid);
      const canDelete = state.isOrganizer || q.userId === uid;
      return `<div class="act-card qa-item ${q.answered ? "answered" : ""}">
        <div class="d-flex gap-2">
          <button class="btn btn-sm ${mine ? "btn-primary" : "btn-outline-primary"} align-self-start" data-qa-up="${q.id}" title="Moi aussi">
            <i class="bi bi-hand-thumbs-up"></i> ${ups.length}
          </button>
          <div class="flex-fill">
            <div>${escapeHtml(q.text)}</div>
            <div class="text-muted" style="font-size:.7rem;">${q.anonymous ? "Anonyme" : escapeHtml(q.userName || "")}${q.answered ? " · ✅ répondu" : ""}</div>
          </div>
        </div>
        <div class="d-flex gap-1 mt-2">
          ${state.isOrganizer ? `<button class="btn btn-sm btn-outline-success" data-qa-answer="${q.id}">${q.answered ? "Rouvrir" : "Marquer répondu"}</button>` : ""}
          ${canDelete ? `<button class="btn btn-sm btn-outline-danger ms-auto" data-qa-delete="${q.id}"><i class="bi bi-trash"></i></button>` : ""}
        </div>
      </div>`;
    }).join("");
  },
};
$("#qa-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#qa-input").value.trim();
  if (!text) return;
  try {
    await rt.add(QA.path, {
      text, anonymous: $("#qa-anonymous").checked,
      userId: state.user.uid, userName: state.user.name,
      upvotes: [], answered: false, createdAt: rt.now(),
    });
    $("#qa-form").reset();
  } catch (err) { permissionWarn(err); showToast("Question non envoyée : " + err.message, "danger"); }
});
$("#qa-list").addEventListener("click", async (e) => {
  const up = e.target.closest("[data-qa-up]");
  const ans = e.target.closest("[data-qa-answer]");
  const del = e.target.closest("[data-qa-delete]");
  try {
    if (up) {
      const q = QA.list.find((x) => x.id === up.dataset.qaUp);
      const mine = (q?.upvotes || []).includes(state.user.uid);
      await rt.update(QA.path, up.dataset.qaUp, { upvotes: mine ? rt.without(state.user.uid) : rt.union(state.user.uid) });
    }
    if (ans) {
      const q = QA.list.find((x) => x.id === ans.dataset.qaAnswer);
      await rt.update(QA.path, ans.dataset.qaAnswer, { answered: !q?.answered });
    }
    if (del) await rt.remove(QA.path, del.dataset.qaDelete);
  } catch (err) { permissionWarn(err); }
});

/* ---------- 17. Notes partagées ---------- */
const Notes = {
  typingUntil: 0, saveTimer: null, lastSaved: "",
  onRemote(data) {
    const ta = $("#notes-area");
    const remote = data.notes || "";
    if (remote === ta.value || Date.now() < this.typingUntil) return;
    ta.value = remote;
    this.lastSaved = remote;
    $("#notes-status").textContent = data.notesBy ? `Modifié par ${data.notesBy}` : "";
  },
  onInput() {
    this.typingUntil = Date.now() + 2000;
    clearTimeout(this.saveTimer);
    $("#notes-status").textContent = "…";
    this.saveTimer = setTimeout(() => this.save(), 700);
  },
  async save() {
    const v = $("#notes-area").value;
    if (v === this.lastSaved || !state.currentMeetingId) return;
    this.lastSaved = v;
    try {
      await rt.updateMeeting(state.currentMeetingId, { notes: v.slice(0, 50000), notesBy: state.user.name });
      $("#notes-status").textContent = "Enregistré ✓";
    } catch (err) {
      permissionWarn(err);
      $("#notes-status").textContent = "Non enregistré";
    }
  },
};
$("#notes-area").addEventListener("input", () => Notes.onInput());
$("#notes-download").addEventListener("click", () => {
  const txt = `${state.currentMeetingTitle || "Réunion"} — notes partagées\n${new Date().toLocaleString("fr-FR")}\n\n${$("#notes-area").value}`;
  downloadBlob(new Blob([txt], { type: "text/plain;charset=utf-8" }), `Notes_${safeName(state.currentMeetingTitle)}.txt`);
});

/* ---------- 18. Tableau blanc collaboratif ---------- */
const Whiteboard = {
  open: false, strokes: [], rendered: new Set(), color: "#1f1f1f", eraser: false,
  drawing: null, path: null, mine: [], lastCount: null,
  canvas: () => $("#wb-canvas"),
  listen(meetingId) {
    this.path = rt.coll(meetingId, "whiteboard");
    this.strokes = [];
    this.rendered = new Set();
    this.lastCount = null;
    return rt.listen(this.path, (docs) => {
      this.strokes = docs.sort((a, b) => (tsOf(a.createdAt) || Date.now()) - (tsOf(b.createdAt) || Date.now()));
      if (!this.open && this.lastCount !== null && docs.length > this.lastCount) {
        showToast("🖊️ Le tableau blanc a été modifié — menu ⋮ › Tableau blanc", "secondary");
      }
      this.lastCount = docs.length;
      this.sync();
    });
  },
  // Zone de dessin au format 16:9, identique pour tous les participants
  board() {
    const c = this.canvas();
    const W = c.width, H = c.height;
    let w = W, h = (W * 9) / 16;
    if (h > H) { h = H; w = (H * 16) / 9; }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  },
  show() {
    this.open = true;
    $("#whiteboard-overlay").classList.add("show");
    this.resize();
  },
  hide() {
    this.open = false;
    $("#whiteboard-overlay").classList.remove("show");
  },
  resize() {
    if (!this.open) return;
    const c = this.canvas();
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(r.width * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    this.redraw();
  },
  redraw() {
    const c = this.canvas();
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#eef0f3";
    ctx.fillRect(0, 0, c.width, c.height);
    const b = this.board();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    this.rendered = new Set();
    this.strokes.forEach((s) => { this.drawStroke(s); this.rendered.add(s.id); });
  },
  sync() {
    if (!this.open) return;
    const ids = new Set(this.strokes.map((s) => s.id));
    if ([...this.rendered].some((id) => !ids.has(id))) { this.redraw(); return; }
    this.strokes.forEach((s) => {
      if (!this.rendered.has(s.id)) { this.drawStroke(s); this.rendered.add(s.id); }
    });
  },
  drawStroke(s, from = 0) {
    const pts = s.points || [];
    if (pts.length < 2) return;
    const ctx = this.canvas().getContext("2d");
    const b = this.board();
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = Math.max(1, s.width * b.w);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const start = Math.max(0, from - 2);
    if (pts.length === 2) {
      ctx.beginPath();
      ctx.arc(b.x + pts[0] * b.w, b.y + pts[1] * b.h, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(b.x + pts[start] * b.w, b.y + pts[start + 1] * b.h);
      for (let i = start + 2; i < pts.length; i += 2) ctx.lineTo(b.x + pts[i] * b.w, b.y + pts[i + 1] * b.h);
      ctx.stroke();
    }
    ctx.restore();
  },
  pointFrom(e) {
    const c = this.canvas();
    const r = c.getBoundingClientRect();
    const dpr = c.width / r.width;
    const b = this.board();
    const x = ((e.clientX - r.left) * dpr - b.x) / b.w;
    const y = ((e.clientY - r.top) * dpr - b.y) / b.h;
    return [Math.round(Math.min(1, Math.max(0, x)) * 10000) / 10000, Math.round(Math.min(1, Math.max(0, y)) * 10000) / 10000];
  },
  down(e) {
    this.canvas().setPointerCapture(e.pointerId);
    const size = Number($("#wb-size").value);
    this.drawing = {
      points: this.pointFrom(e),
      color: this.eraser ? "#ffffff" : this.color,
      width: this.eraser ? size * 4 : size,
    };
  },
  move(e) {
    if (!this.drawing) return;
    const n = this.drawing.points.length;
    this.drawing.points.push(...this.pointFrom(e));
    this.drawStroke(this.drawing, n);
  },
  async up() {
    const s = this.drawing;
    this.drawing = null;
    if (!s || !this.path) return;
    if (s.points.length === 2) this.drawStroke(s);
    // Découpe des très longs traits (limite de taille d'un document Firestore)
    const chunks = [];
    for (let i = 0; i < s.points.length; i += 4000) chunks.push(s.points.slice(Math.max(0, i - 2), i + 4000));
    try {
      for (const pts of chunks) {
        const id = await rt.add(this.path, {
          points: pts, color: s.color, width: s.width,
          userId: state.user.uid, createdAt: rt.now(),
        });
        this.mine.push(id);
      }
    } catch (err) { permissionWarn(err); showToast("Trait non partagé : " + err.message, "warning"); }
  },
  async undo() {
    const id = this.mine.pop();
    if (id) await rt.remove(this.path, id).catch(permissionWarn);
  },
  async clear() {
    if (!(await askConfirm("Effacer le tableau blanc ?", "Le tableau sera vidé pour tous les participants.", "Effacer"))) return;
    const ids = this.strokes.map((s) => s.id);
    if (firebaseReady) {
      for (let i = 0; i < ids.length; i += 400) {
        const batch = db.batch();
        ids.slice(i, i + 400).forEach((id) => batch.delete(db.collection(this.path).doc(id)));
        await batch.commit().catch(permissionWarn);
      }
    } else {
      for (const id of ids) await rt.remove(this.path, id);
    }
    this.mine = [];
  },
  download() {
    const c = this.canvas();
    const b = this.board();
    const out = document.createElement("canvas");
    out.width = Math.round(b.w);
    out.height = Math.round(b.h);
    out.getContext("2d").drawImage(c, b.x, b.y, b.w, b.h, 0, 0, out.width, out.height);
    out.toBlob((blob) => downloadBlob(blob, `Tableau_${safeName(state.currentMeetingTitle)}.png`));
  },
  reset() {
    this.hide();
    this.strokes = [];
    this.rendered = new Set();
    this.mine = [];
    this.path = null;
  },
};
(() => {
  const c = $("#wb-canvas");
  c.addEventListener("pointerdown", (e) => Whiteboard.down(e));
  c.addEventListener("pointermove", (e) => Whiteboard.move(e));
  c.addEventListener("pointerup", () => Whiteboard.up());
  c.addEventListener("pointercancel", () => Whiteboard.up());
  window.addEventListener("resize", () => Whiteboard.resize());
  document.querySelectorAll(".wb-color").forEach((sw) => {
    sw.addEventListener("click", () => {
      document.querySelectorAll(".wb-color").forEach((x) => x.classList.remove("active"));
      sw.classList.add("active");
      Whiteboard.color = sw.dataset.color;
      Whiteboard.eraser = false;
      $("#wb-eraser").classList.remove("active");
    });
  });
  $("#wb-eraser").addEventListener("click", () => {
    Whiteboard.eraser = !Whiteboard.eraser;
    $("#wb-eraser").classList.toggle("active", Whiteboard.eraser);
  });
  $("#wb-undo").addEventListener("click", () => Whiteboard.undo());
  $("#wb-clear").addEventListener("click", () => Whiteboard.clear());
  $("#wb-download").addEventListener("click", () => Whiteboard.download());
  $("#wb-close").addEventListener("click", () => Whiteboard.hide());
})();

/* ---------- 19. Salles de sous-commission ---------- */
const Breakout = {
  assignments: {}, timer: null, lastBroadcast: 0,
  people() {
    const seen = new Set();
    return (state.allParticipants || []).filter((p) => {
      if (p.userId === state.user.uid || seen.has(p.userId)) return false;
      seen.add(p.userId);
      return true;
    });
  },
  openModal() {
    if (!firebaseReady) { showToast("Les salles de sous-commission nécessitent Firebase", "warning"); return; }
    const b = state.meetingData?.breakout;
    const running = !!b?.active;
    $("#breakout-setup").style.display = running ? "none" : "";
    $("#breakout-running").style.display = running ? "" : "none";
    $("#breakout-open-btn").style.display = running ? "none" : "";
    $("#breakout-close-btn").style.display = running ? "" : "none";
    if (running) this.renderRunning(b);
    else { this.shuffle(); }
    bootstrap.Modal.getOrCreateInstance($("#breakoutModal")).show();
  },
  count() { return Math.min(20, Math.max(2, Number($("#breakout-count").value) || 2)); },
  shuffle() {
    const n = this.count();
    const people = this.people().sort(() => Math.random() - 0.5);
    this.assignments = {};
    people.forEach((p, i) => { this.assignments[p.userId] = i % n; });
    this.renderAssign();
  },
  renderAssign() {
    const n = this.count();
    const people = this.people();
    if (!people.length) {
      $("#breakout-assign").innerHTML = '<div class="text-muted">Aucun participant à répartir pour le moment.</div>';
      return;
    }
    const opts = (sel) => Array.from({ length: n }, (_, i) => `<option value="${i}" ${sel === i ? "selected" : ""}>Salle ${i + 1}</option>`).join("");
    $("#breakout-assign").innerHTML = people.map((p) => `
      <div class="d-flex align-items-center gap-2 mb-1">
        <span class="flex-fill">${escapeHtml(p.name)}</span>
        <select class="form-select form-select-sm w-auto" data-assign="${escapeHtml(p.userId)}">${opts(this.assignments[p.userId] ?? 0)}</select>
      </div>`).join("");
  },
  renderRunning(b) {
    const counts = {};
    Object.values(b.assignments || {}).forEach((rid) => { counts[rid] = (counts[rid] || 0) + 1; });
    $("#breakout-rooms-list").innerHTML = (b.rooms || []).map((r) => `
      <div class="d-flex align-items-center gap-2 mb-1 small">
        <i class="bi bi-door-open"></i><span class="flex-fill">${escapeHtml(r.name)} · ${counts[r.id] || 0} pers.</span>
        <button class="btn btn-sm btn-outline-primary" data-breakout-join="${escapeHtml(r.id)}" data-name="${escapeHtml(r.name)}">Rejoindre</button>
      </div>`).join("");
  },
  async open() {
    const mid = state.currentMeetingId;
    const n = this.count();
    const minutes = Math.max(0, Number($("#breakout-duration").value) || 0);
    const rooms = Array.from({ length: n }, (_, i) => ({ id: `${mid}-salle${i + 1}`, name: `Salle ${i + 1}` }));
    const assignments = {};
    Object.entries(this.assignments).forEach(([uid, idx]) => { if (rooms[idx]) assignments[uid] = rooms[idx].id; });
    try {
      for (const r of rooms) {
        await db.collection("meetings").doc(r.id).set({
          title: `${state.currentMeetingTitle} — ${r.name}`,
          ownerId: state.user.uid,
          ownerName: state.user.name,
          parentId: mid,
          isBreakout: true,
          hasReport: false,
          settings: DEFAULT_MEETING_SETTINGS,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          endedAt: firebase.firestore.FieldValue.delete(),
        }, { merge: true });
      }
      await rt.updateMeeting(mid, {
        breakout: {
          active: true, rooms, assignments,
          startedAt: Date.now(),
          endsAt: minutes ? Date.now() + minutes * 60000 : null,
          broadcast: null,
        },
      });
      bootstrap.Modal.getInstance($("#breakoutModal"))?.hide();
      showToast(`🚪 ${n} salles ouvertes`, "success");
    } catch (err) { permissionWarn(err); showToast("Ouverture impossible : " + err.message, "danger"); }
  },
  async close() {
    const mid = state.breakoutParent?.id || state.currentMeetingId;
    try {
      await rt.updateMeeting(mid, { "breakout.active": false });
      bootstrap.Modal.getInstance($("#breakoutModal"))?.hide();
      showToast("Salles fermées : tout le monde revient en salle principale", "info");
    } catch (err) { permissionWarn(err); }
  },
  async broadcast(text) {
    const mid = state.breakoutParent?.id || state.currentMeetingId;
    await rt.updateMeeting(mid, { "breakout.broadcast": { text, from: state.user.name, at: Date.now() } }).catch(permissionWarn);
    showToast("📣 Message envoyé à toutes les salles", "success");
  },
  /* Réagit à l'état des salles, lu sur le document de la salle principale */
  onParentState(parent) {
    const b = parent.breakout;
    const inRoom = !!state.breakoutParent;
    if (b?.broadcast && b.broadcast.at > this.lastBroadcast) {
      if (this.lastBroadcast) {
        showToast(`📣 ${b.broadcast.from} : ${b.broadcast.text}`, "primary");
        playSound("message");
      }
      this.lastBroadcast = b.broadcast.at;
    } else if (!this.lastBroadcast) {
      this.lastBroadcast = b?.broadcast?.at || 1;
    }

    if (inRoom && !b?.active) {
      showToast("Les salles sont fermées : retour en salle principale", "info");
      returnToMainRoom();
      return;
    }
    if (!inRoom && b?.active && !state.isOrganizer && state.handledBreakout !== b.startedAt) {
      const rid = b.assignments?.[state.user.uid];
      const room = (b.rooms || []).find((r) => r.id === rid);
      if (room) {
        state.handledBreakout = b.startedAt;
        showToast(`🚪 Vous rejoignez ${room.name}`, "primary");
        setTimeout(() => moveToRoom(room.id, room.name), 1200);
        return;
      }
    }
    this.state = b;
    this.renderBanner();
    if (b?.active && state.isOrganizer) this.ensureTimer();
    else this.stopTimer();
  },
  renderBanner() {
    const b = this.state;
    const el = $("#breakout-banner");
    const inRoom = !!state.breakoutParent;
    if (!b?.active || (!inRoom && !state.isOrganizer)) { el.style.display = "none"; return; }
    const left = b.endsAt ? ` · ⏱ ${fmtDuration(Math.max(0, b.endsAt - Date.now()))}` : "";
    el.innerHTML = inRoom
      ? `<span><i class="bi bi-door-open-fill"></i> Vous êtes en salle de sous-commission${left}</span>
         <button class="btn btn-sm btn-light" id="breakout-return-btn">Revenir à la salle principale</button>`
      : `<span><i class="bi bi-diagram-3-fill"></i> ${(b.rooms || []).length} salles ouvertes${left}</span>
         <button class="btn btn-sm btn-light" id="breakout-manage-btn">Gérer</button>`;
    el.style.display = "";
    $("#breakout-return-btn")?.addEventListener("click", returnToMainRoom);
    $("#breakout-manage-btn")?.addEventListener("click", () => this.openModal());
  },
  ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.renderBanner();
      const b = this.state;
      if (state.isOrganizer && b?.active && b.endsAt && Date.now() > b.endsAt) {
        this.stopTimer();
        this.close();
      }
    }, 1000);
  },
  stopTimer() { clearInterval(this.timer); this.timer = null; },
};
$("#breakout-btn").addEventListener("click", () => Breakout.openModal());
$("#breakout-count").addEventListener("change", () => Breakout.shuffle());
$("#breakout-shuffle").addEventListener("click", () => Breakout.shuffle());
$("#breakout-assign").addEventListener("change", (e) => {
  const s = e.target.closest("[data-assign]");
  if (s) Breakout.assignments[s.dataset.assign] = Number(s.value);
});
$("#breakout-open-btn").addEventListener("click", () => Breakout.open());
$("#breakout-close-btn").addEventListener("click", () => Breakout.close());
$("#breakout-broadcast-btn").addEventListener("click", () => {
  const t = $("#breakout-broadcast-input").value.trim();
  if (t) { Breakout.broadcast(t); $("#breakout-broadcast-input").value = ""; }
});
$("#breakout-rooms-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-breakout-join]");
  if (!b) return;
  bootstrap.Modal.getInstance($("#breakoutModal"))?.hide();
  moveToRoom(b.dataset.breakoutJoin, b.dataset.name);
});

/* Dans une salle : on surveille la salle principale (fermeture, annonces, minuteur) */
function watchBreakoutParent() {
  const p = state.breakoutParent;
  if (!p || !firebaseReady || p.id === state.currentMeetingId) return null;
  return db.collection("meetings").doc(p.id).onSnapshot((snap) => {
    if (snap.exists) {
      Breakout.onParentState(snap.data());
      if (state.isOrganizer && snap.data().breakout?.active) Breakout.ensureTimer();
    }
  }, permissionWarn);
}

function moveToRoom(roomId, roomName) {
  const parent = state.breakoutParent || { id: state.currentMeetingId, title: state.currentMeetingTitle };
  state.desiredMicOn = state.micOn;
  state.desiredCamOn = state.camOn;
  leaveMeeting({ stayOnPage: true });
  state.breakoutParent = parent;
  startRoom(roomId, `${parent.title} — ${roomName}`);
}
function returnToMainRoom() {
  const parent = state.breakoutParent;
  if (!parent) return;
  state.desiredMicOn = state.micOn;
  state.desiredCamOn = state.camOn;
  leaveMeeting({ stayOnPage: true });
  state.breakoutParent = null;
  startRoom(parent.id, parent.title);
}

/* ---------- 20. Actions et commandes supplémentaires ---------- */
async function handleExtraParticipantAction(action, peerId) {
  if (action === "askUnmute") {
    await sendCommand({ type: "askUnmute", targetPeerId: peerId });
    showToast("Demande envoyée", "info");
  } else if (action === "spotlight") {
    const same = state.meetingData?.spotlightPeerId === peerId;
    await rt.updateMeeting(state.currentMeetingId, { spotlightPeerId: same ? rt.del() : peerId }).catch(permissionWarn);
  }
}

async function handleExtraCommand(cmd) {
  if (cmd.type === "lowerHands" && state.handRaised) {
    lowerMyHand();
    showToast(`✋ ${cmd.from} a baissé toutes les mains`, "secondary");
  }
  if (cmd.type === "askUnmute" && cmd.targetPeerId === state.myPeerId && !state.micOn) {
    if (await askConfirm("Activer votre micro ?", `${cmd.from} vous demande d'activer votre micro.`, "Activer")) {
      setMic(true, { force: true });
    }
  }
  if (cmd.type === "captionsRequest" && state.isOrganizer) {
    showToast(`💬 ${cmd.from} souhaite des sous-titres : activez la transcription (bouton CC)`, "info");
  }
}

function lowerMyHand() {
  state.handRaised = false;
  $("#raise-hand-btn").classList.remove("hand-raised");
  toggleHandIndicator("local-tile", false);
  if (firebaseReady && state.currentMeetingId && state.myPeerId) {
    db.collection("meetings").doc(state.currentMeetingId).collection("participants").doc(state.myPeerId)
      .update({ handRaised: false, handRaisedAt: null }).catch(() => {});
  }
}

$("#lower-hands-btn").addEventListener("click", async () => {
  await sendCommand({ type: "lowerHands" });
  showToast("Toutes les mains ont été baissées", "success");
});

async function endMeetingForAll() {
  if (!state.currentMeetingId) return;
  try {
    await rt.updateMeeting(state.currentMeetingId, {
      endedAt: rt.now(),
      transcriptionActive: false,
      presenterId: rt.del(),
      spotlightPeerId: rt.del(),
      "breakout.active": false,
    });
  } catch (err) { permissionWarn(err); }
  showToast("Réunion terminée pour tous", "secondary");
}
$("#end-all-btn").addEventListener("click", async () => {
  if (await askConfirm("Terminer la réunion pour tous ?", "Tous les participants seront déconnectés.", "Terminer")) finishMeeting({ endAll: true });
});
$("#leave-end-all").addEventListener("click", () => {
  bootstrap.Modal.getInstance($("#leaveModal"))?.hide();
  finishMeeting({ endAll: true });
});
$("#leave-only-me").addEventListener("click", () => {
  bootstrap.Modal.getInstance($("#leaveModal"))?.hide();
  finishMeeting();
});

$("#activities-btn").addEventListener("click", () => {
  $("#side-panel").classList.remove("collapsed");
  document.querySelector('[data-bs-target="#activities-pane"]').click();
});

/* ---------- 21. Menu « Plus » et paramètres ---------- */
document.addEventListener("click", (e) => {
  const item = e.target.closest("[data-menu]");
  if (!item) return;
  const m = item.dataset.menu;
  if (m === "layout-grid") Layout.set("grid");
  if (m === "layout-speaker") Layout.set("speaker");
  if (m === "hide-self") {
    state.prefs.hideSelf = !state.prefs.hideSelf;
    savePrefs();
    Layout.apply();
    showToast(state.prefs.hideSelf ? "Votre vidéo est masquée (pour vous seulement)" : "Votre vidéo est de nouveau visible", "secondary");
  }
  if (m === "pip") {
    const main = Layout.mainTileId();
    const tile = (main && document.getElementById(main)) ||
      (Levels.activeId && document.getElementById(`tile-${Levels.activeId}`)) ||
      document.querySelector("#videos-grid .video-tile.remote") || $("#local-tile");
    requestPip(tile.querySelector("video"));
  }
  if (m === "fullscreen") {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else $("#meeting-page").requestFullscreen?.().catch(() => {});
  }
  if (m === "whiteboard") Whiteboard.show();
  if (m === "background") {
    bootstrap.Modal.getInstance($("#settingsModal"))?.hide();
    openBgModal();
  }
  if (m === "settings") openSettings();
  if (m === "shortcuts") bootstrap.Modal.getOrCreateInstance($("#shortcutsModal")).show();
});

function openSettings() {
  refreshDeviceLists();
  document.querySelectorAll(".pref-switch").forEach((cb) => { cb.checked = !!state.prefs[cb.dataset.pref]; });
  $("#pref-caption-lang").value = state.prefs.captionLang || "";
  bootstrap.Modal.getOrCreateInstance($("#settingsModal")).show();
}
document.querySelectorAll(".pref-switch").forEach((cb) => {
  cb.addEventListener("change", () => {
    const k = cb.dataset.pref;
    state.prefs[k] = cb.checked;
    savePrefs();
    if (k === "noiseSuppression" && state.rawStream?.getAudioTracks()[0]) {
      switchDevice("audioinput", state.rawStream.getAudioTracks()[0].getSettings().deviceId || state.prefs.micId);
    }
    if (k === "mirror") updateMirror();
    if (k === "hideSelf") Layout.apply();
  });
});
$("#pref-caption-lang").addEventListener("change", (e) => {
  state.prefs.captionLang = e.target.value;
  savePrefs();
  Captions.translations = {};
  if (e.target.value && !GEMINI_CONFIG.apiKey) showToast("La traduction nécessite une clé Gemini", "warning");
});

/* ---------- 22. Raccourcis clavier (style Google Meet) ---------- */
document.addEventListener("keydown", (e) => {
  if (!$("#meeting-page").classList.contains("active")) return;
  const tag = (e.target.tagName || "").toLowerCase();
  const typing = ["input", "textarea", "select"].includes(tag) || e.target.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  const key = (e.key || "").toLowerCase();

  if (mod && !e.altKey && !e.shiftKey && key === "d") { e.preventDefault(); setMic(!state.micOn); return; }
  if (mod && !e.altKey && !e.shiftKey && key === "e") { e.preventDefault(); setCam(!state.camOn); return; }
  if (typing) return;

  if (e.ctrlKey && e.altKey) {
    const actions = {
      KeyH: () => $("#raise-hand-btn").click(),
      KeyC: () => $("#toggle-chat-btn").click(),
      KeyP: () => $("#participants-btn").click(),
      KeyS: () => Captions.toggle(),
      KeyL: () => Layout.set(Layout.mode === "grid" ? "speaker" : "grid"),
    };
    if (actions[e.code]) { e.preventDefault(); actions[e.code](); }
    return;
  }
  // Maintenir Espace pour parler quand le micro est coupé
  if (e.code === "Space" && !e.repeat && !mod && tag !== "button" && !state.micOn && state.localStream) {
    e.preventDefault();
    state.pushToTalk = true;
    setMic(true, { silent: true });
    if (state.micOn) showToast("🎙️ Parole temporaire (relâchez Espace pour couper)", "secondary");
    else state.pushToTalk = false;
    return;
  }
  if (e.key === "?") bootstrap.Modal.getOrCreateInstance($("#shortcutsModal")).show();
});
document.addEventListener("keyup", (e) => {
  if (e.code === "Space" && state.pushToTalk) {
    state.pushToTalk = false;
    setMic(false);
  }
});

/* ---------- 23. Assistant IA de réunion (Gemini) ---------- */
async function callGemini(prompt, { json = false, temperature = 0.4 } = {}) {
  if (!GEMINI_CONFIG.apiKey) throw new Error("aucune clé Gemini configurée");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CONFIG.model}:generateContent?key=${GEMINI_CONFIG.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, ...(json ? { responseMimeType: "application/json" } : {}) },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function gatherMeetingContext() {
  const entries = (state.transcriptEntries?.length ? state.transcriptEntries : state.localTranscriptEntries) || [];
  const lines = entries.map((e) =>
    `[${new Date(e.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}] ${e.userName} : ${e.text}`);
  let chat = "";
  try { chat = await getChatTranscript(); } catch (_) {}
  const notes = $("#notes-area").value.trim();
  const polls = Polls.list.map((p) => {
    const votes = Object.values(p.votes || {});
    return `- ${p.question} → ${(p.options || []).map((o, i) => `${o} : ${votes.filter((v) => v === i).length}`).join(", ")}`;
  }).join("\n");
  const ctx = `TRANSCRIPTION :\n${lines.join("\n") || "(vide)"}\n\nCHAT :\n${chat || "(vide)"}\n\nNOTES PARTAGÉES :\n${notes || "(vide)"}\n\nSONDAGES :\n${polls || "(aucun)"}`;
  return ctx.length > 30000 ? ctx.slice(-30000) : ctx;
}

async function askMeetingAI(question) {
  const box = $("#ai-answers");
  const item = document.createElement("div");
  item.className = "border rounded p-2 mb-2 small";
  item.innerHTML = `<div class="fw-semibold mb-1"><i class="bi bi-person"></i> ${escapeHtml(question)}</div>
    <div class="ai-answer text-muted"><span class="spinner-border spinner-border-sm"></span> Réflexion…</div>`;
  box.prepend(item);
  const out = item.querySelector(".ai-answer");
  try {
    const context = await gatherMeetingContext();
    const now = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const answer = await callGemini(
      `Tu es l'assistant de la réunion « ${state.currentMeetingTitle} ». Il est ${now}.
Réponds en français, de façon concise et structurée (texte simple, tirets autorisés, pas de markdown gras),
en t'appuyant UNIQUEMENT sur le contexte ci-dessous. Si l'information n'y figure pas, dis-le clairement.

${context}

QUESTION : ${question}`);
    out.className = "ai-answer";
    out.innerHTML = escapeHtml(answer.trim()).replace(/\n/g, "<br>") +
      '<div class="text-end mt-1"><button class="btn btn-link btn-sm p-0 ai-copy"><i class="bi bi-clipboard"></i> Copier</button></div>';
    out.querySelector(".ai-copy").addEventListener("click", () => copyText(answer.trim(), "Réponse copiée"));
  } catch (err) {
    out.className = "ai-answer text-danger";
    out.textContent = "Assistant indisponible : " + err.message;
  }
}
$("#ai-ask-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#ai-ask-input").value.trim();
  if (!q) return;
  $("#ai-ask-input").value = "";
  askMeetingAI(q);
});
document.querySelectorAll(".ai-quick").forEach((b) => b.addEventListener("click", () => askMeetingAI(b.dataset.q)));

/* ---------- 24. Planification : agenda Google, fichier .ics ---------- */
function scheduledBadge(data) {
  const t = tsOf(data.scheduledAt);
  if (!t) return "";
  const upcoming = t > Date.now() - 3600000;
  const txt = new Date(t).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return `<span class="badge ${upcoming ? "bg-primary-subtle text-primary" : "bg-secondary-subtle text-secondary"} ms-2"><i class="bi bi-calendar-event"></i> ${txt}</span>`;
}

function icsDate(d) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function showScheduledModal(m) {
  const link = inviteLinkFor(m.id);
  const start = m.scheduledAt;
  const end = new Date(start.getTime() + (m.durationMin || 60) * 60000);
  const details = `${m.description ? m.description + "\n\n" : ""}Rejoindre la réunion MbokaTech : ${link}`;
  $("#scheduled-title").textContent = m.title;
  $("#scheduled-when").textContent = `${start.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })} · ${m.durationMin} min`;
  $("#scheduled-link").value = link;
  $("#scheduled-gcal").href = `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(m.title)}&dates=${icsDate(start)}/${icsDate(end)}` +
    `&details=${encodeURIComponent(details)}&location=${encodeURIComponent(link)}`;
  $("#scheduled-copy").onclick = () => copyText(`Réunion « ${m.title} » — ${$("#scheduled-when").textContent}\n${link}`, "Invitation copiée");
  $("#scheduled-ics").onclick = () => {
    const esc = (s) => String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MbokaTech//Reunions//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${m.id}@mbokatech`, `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
      `SUMMARY:${esc(m.title)}`, `DESCRIPTION:${esc(details)}`, `LOCATION:${esc(link)}`, `URL:${link}`,
      "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", "DESCRIPTION:Réunion dans 10 minutes", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    downloadBlob(new Blob([ics], { type: "text/calendar;charset=utf-8" }), `${safeName(m.title)}.ics`);
  };
  bootstrap.Modal.getOrCreateInstance($("#scheduledModal")).show();
}

$("#new-meeting-schedule").addEventListener("change", (e) => {
  $("#schedule-fields").style.display = e.target.checked ? "" : "none";
  $("#create-meeting-submit span").textContent = e.target.checked ? "Planifier" : "Démarrer";
  if (e.target.checked && !$("#new-meeting-date").value) {
    const d = new Date(Date.now() + 3600000);
    d.setMinutes(0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    $("#new-meeting-date").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
});
$("#schedule-meeting-btn").addEventListener("click", () => {
  const cb = $("#new-meeting-schedule");
  cb.checked = true;
  cb.dispatchEvent(new Event("change"));
  bootstrap.Modal.getOrCreateInstance($("#createMeetingModal")).show();
});
$("#create-meeting-btn").addEventListener("click", () => {
  const cb = $("#new-meeting-schedule");
  if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event("change")); }
});

/* ---------- 25. Mode sombre ---------- */
function applyTheme() {
  const dark = state.prefs.theme === "dark";
  document.documentElement.setAttribute("data-bs-theme", dark ? "dark" : "light");
  $("#theme-toggle i").className = dark ? "bi bi-sun-fill" : "bi bi-moon-stars-fill";
}
$("#theme-toggle").addEventListener("click", () => {
  state.prefs.theme = state.prefs.theme === "dark" ? "light" : "dark";
  savePrefs();
  applyTheme();
});
applyTheme();

/* ---------- 7. QUITTER PROPREMENT à la fermeture de l'onglet ---------- */
window.addEventListener("beforeunload", (e) => {
  if (state.currentMeetingId) {
    leaveMeeting();
    e.preventDefault();
    e.returnValue = "";
  }
});
