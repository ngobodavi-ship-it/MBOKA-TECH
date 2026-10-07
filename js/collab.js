/* MbokaTech — Vague 4 : présence, contacts, appels directs, discussions permanentes,
   connexion Google, profil, réunions récurrentes, application installable */

const Collab = {
  onEnterApp() {
    Presence.start();
    Contacts.load();
    Chats.load();
    Calls.listen();
  },
  onLogout() {
    Presence.goOffline();
    Contacts.unsub?.();
    Chats.unsub?.();
    Chats.closeView();
    Calls.unsubIn?.();
    Contacts.unsub = Chats.unsub = Calls.unsubIn = null;
  },
};

/* ---------- 1. Présence (statut comme dans Teams) ---------- */
const PRESENCE_LABELS = {
  available: "Disponible", busy: "Occupé", dnd: "Ne pas déranger",
  away: "Absent", meeting: "En réunion", offline: "Hors ligne",
};

const Presence = {
  status: "available", inMeeting: false, timer: null,
  start() {
    try { this.status = localStorage.getItem("mboka.presence") || "available"; } catch (_) {}
    this.write();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.write(), 60000);
    this.paint();
  },
  effective() { return this.inMeeting && this.status !== "dnd" ? "meeting" : this.status; },
  write() {
    if (!firebaseReady || !state.user || state.user.isGuest) return;
    const u = state.user;
    db.collection("users").doc(u.uid).set({
      uid: u.uid, name: u.name, email: u.email || "", isGuest: false,
      presence: this.effective(),
      lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch((e) => permissionWarn(e, "users"));
  },
  set(status) {
    this.status = status;
    try { localStorage.setItem("mboka.presence", status); } catch (_) {}
    this.write();
    this.paint();
  },
  setInMeeting(v) {
    this.inMeeting = v;
    this.write();
    this.paint();
  },
  goOffline() {
    clearInterval(this.timer);
    if (!firebaseReady || !state.user || state.user.isGuest) return;
    db.collection("users").doc(state.user.uid).set({ presence: "offline" }, { merge: true }).catch(() => {});
  },
  paint() {
    $("#my-presence-dot").className = `presence-dot ${this.effective()}`;
    $("#my-presence-dot").title = PRESENCE_LABELS[this.effective()];
    document.querySelectorAll("#presence-options [data-presence]").forEach((b) => {
      b.classList.toggle("active", b.dataset.presence === this.status);
    });
  },
};
/* Un utilisateur sans signe de vie depuis 3 min est considéré hors ligne */
function presenceOf(u) {
  const last = tsOf(u.lastSeen);
  if (!last || Date.now() - last > 3 * 60000) return "offline";
  return u.presence || "available";
}

$("#profile-btn").addEventListener("click", () => {
  $("#profile-name").value = state.user?.name || "";
  Presence.paint();
  bootstrap.Modal.getOrCreateInstance($("#profileModal")).show();
});
$("#presence-options").addEventListener("click", (e) => {
  const b = e.target.closest("[data-presence]");
  if (!b) return;
  Presence.set(b.dataset.presence);
  showToast(`Statut : ${PRESENCE_LABELS[b.dataset.presence]}`, "secondary");
});
$("#profile-save-name").addEventListener("click", async () => {
  const name = $("#profile-name").value.trim();
  if (!name || !state.user) return;
  try {
    if (firebaseReady && auth.currentUser) await auth.currentUser.updateProfile({ displayName: name });
    state.user.name = name;
    $("#user-name-display").textContent = name;
    $("#user-avatar").textContent = initials(name);
    $("#welcome-name").textContent = name.split(" ")[0];
    Presence.write();
    showToast("Nom mis à jour", "success");
  } catch (e) { showToast("Échec : " + e.message, "danger"); }
});

/* ---------- 2. Contacts ---------- */
const Contacts = {
  list: [], unsub: null,
  load() {
    this.unsub?.();
    if (!firebaseReady) { this.render(); return; }
    this.unsub = db.collection("users").limit(500).onSnapshot((snap) => {
      const me = state.user?.uid;
      const order = { available: 0, meeting: 1, busy: 2, dnd: 3, away: 4, offline: 5 };
      this.list = snap.docs.map((d) => d.data())
        .filter((u) => u.uid && u.uid !== me && !u.isGuest)
        .sort((a, b) => (order[presenceOf(a)] - order[presenceOf(b)]) || String(a.name).localeCompare(String(b.name)));
      this.render();
    }, (err) => permissionWarn(err, "users"));
  },
  find(uid) { return this.list.find((u) => u.uid === uid); },
  render() {
    const el = $("#contacts-list");
    if (!firebaseReady) {
      el.innerHTML = '<div class="text-center text-muted py-5 small">Les contacts nécessitent Firebase</div>';
      return;
    }
    if (!this.list.length) {
      el.innerHTML = `<div class="text-center text-muted py-5 small">
        <i class="bi bi-people fs-1 d-block mb-2 opacity-50"></i>
        Vos collègues apparaîtront ici dès qu'ils auront créé leur compte MbokaTech</div>`;
      return;
    }
    el.innerHTML = this.list.map((u) => {
      const p = presenceOf(u);
      return `<div class="meeting-row contact-row" data-uid="${escapeHtml(u.uid)}">
        <div class="position-relative me-3">
          <div class="avatar-circle">${escapeHtml(initials(u.name || "?"))}</div>
          <span class="presence-dot ${p}" title="${PRESENCE_LABELS[p]}"></span>
        </div>
        <div class="meeting-info">
          <div class="meeting-title">${escapeHtml(u.name || "Sans nom")}</div>
          <div class="meeting-meta">${PRESENCE_LABELS[p]} · ${escapeHtml(u.email || "")}</div>
        </div>
        <div class="ms-3 d-flex gap-2 flex-shrink-0">
          <button class="btn btn-sm btn-outline-primary" data-contact-chat="${escapeHtml(u.uid)}" title="Envoyer un message"><i class="bi bi-chat-dots"></i></button>
          <button class="btn btn-sm btn-success" data-contact-call="${escapeHtml(u.uid)}" title="Appel vidéo"><i class="bi bi-camera-video-fill"></i> <span class="d-none d-md-inline">Appeler</span></button>
        </div>
      </div>`;
    }).join("");
    applyHomeSearch();
  },
};
$("#contacts-list").addEventListener("click", (e) => {
  const call = e.target.closest("[data-contact-call]");
  const chat = e.target.closest("[data-contact-chat]");
  if (call) Calls.start(Contacts.find(call.dataset.contactCall));
  if (chat) Chats.openWith([Contacts.find(chat.dataset.contactChat)]);
});

/* ---------- 3. Appels directs (sonnerie, accepter / refuser) ---------- */
function newMeetingDoc(title, extraSettings = {}) {
  return db.collection("meetings").add({
    title,
    ownerId: state.user.uid,
    ownerName: state.user.name,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    participants: [],
    hasReport: false,
    settings: { ...DEFAULT_MEETING_SETTINGS, ...extraSettings },
  });
}

const Calls = {
  unsubIn: null, outgoing: null, incoming: null, ringTimer: null, seen: new Set(),

  listen() {
    this.unsubIn?.();
    if (!firebaseReady || !state.user || state.user.isGuest) return;
    this.unsubIn = db.collection("calls")
      .where("to", "==", state.user.uid)
      .where("status", "==", "ringing")
      .onSnapshot((snap) => {
        snap.docChanges().forEach((ch) => {
          const c = { id: ch.doc.id, ...ch.doc.data() };
          if (ch.type === "added" && !this.seen.has(c.id) && Date.now() - (c.createdAtMs || 0) < 45000) {
            this.seen.add(c.id);
            this.showIncoming(c);
          }
          if (ch.type === "removed" && this.incoming?.id === c.id) this.hideIncoming("L'appel est terminé");
        });
      }, (err) => permissionWarn(err, "calls"));
  },

  async start(user) {
    if (!user) return;
    if (!firebaseReady) { showToast("Les appels nécessitent Firebase", "warning"); return; }
    if (state.currentMeetingId) { showToast("Vous êtes déjà en réunion", "warning"); return; }
    try {
      const title = `Appel ${state.user.name} · ${user.name}`;
      const mRef = await newMeetingDoc(title, { autoTranscribe: false, autoReport: false });
      const cRef = await db.collection("calls").add({
        from: state.user.uid, fromName: state.user.name,
        to: user.uid, toName: user.name,
        meetingId: mRef.id, meetingTitle: title,
        status: "ringing", createdAtMs: Date.now(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      $("#outgoing-avatar").textContent = initials(user.name);
      $("#outgoing-name").textContent = user.name;
      $("#outgoing-status").textContent = presenceOf(user) === "offline" ? "Appel en cours… (semble hors ligne)" : "Appel en cours…";
      const modal = bootstrap.Modal.getOrCreateInstance($("#outgoingCallModal"));
      modal.show();
      const done = (msg, type = "secondary") => {
        clearTimeout(this.outgoing?.timer);
        this.outgoing?.unsub?.();
        this.outgoing = null;
        this.stopRing();
        modal.hide();
        if (msg) showToast(msg, type);
      };
      const unsub = cRef.onSnapshot((s) => {
        const st = s.data()?.status;
        if (st === "accepted") { done(); joinMeeting(mRef.id, title); }
        else if (st === "declined") done(`${user.name} a refusé l'appel`, "warning");
        else if (st === "busy") done(`${user.name} est déjà en réunion`, "warning");
      });
      const timer = setTimeout(() => {
        cRef.update({ status: "missed" }).catch(() => {});
        done(`${user.name} n'a pas répondu`, "warning");
      }, 40000);
      this.outgoing = { ref: cRef, unsub, timer, done };
      this.ring("outgoing");
    } catch (e) {
      permissionWarn(e, "calls");
      showToast("Appel impossible : " + e.message, "danger");
    }
  },

  cancelOutgoing() {
    if (!this.outgoing) return;
    this.outgoing.ref.update({ status: "cancelled" }).catch(() => {});
    this.outgoing.done("Appel annulé");
  },

  showIncoming(c) {
    const ref = db.collection("calls").doc(c.id);
    if (state.currentMeetingId) {
      ref.update({ status: "busy" }).catch(() => {});
      showToast(`📞 Appel manqué de ${c.fromName} (vous étiez en réunion)`, "warning");
      return;
    }
    if (Presence.status === "dnd") {
      showToast(`📞 Appel de ${c.fromName} (ne pas déranger)`, "secondary");
      return;
    }
    this.incoming = c;
    $("#incoming-avatar").textContent = initials(c.fromName);
    $("#incoming-name").textContent = c.fromName;
    bootstrap.Modal.getOrCreateInstance($("#incomingCallModal")).show();
    this.ring("incoming");
    notifyBrowser(`📞 ${c.fromName} vous appelle`, "Ouvrez MbokaTech pour répondre");
    clearTimeout(this.incomingTimer);
    this.incomingTimer = setTimeout(() => this.hideIncoming(`📞 Appel manqué de ${c.fromName}`), 40000);
  },

  hideIncoming(msg) {
    clearTimeout(this.incomingTimer);
    this.stopRing();
    this.incoming = null;
    bootstrap.Modal.getInstance($("#incomingCallModal"))?.hide();
    if (msg) showToast(msg, "secondary");
  },

  async answer(accept) {
    const c = this.incoming;
    if (!c) return;
    this.hideIncoming();
    try {
      await db.collection("calls").doc(c.id).update({ status: accept ? "accepted" : "declined" });
      if (accept) joinMeeting(c.meetingId, c.meetingTitle);
    } catch (e) { permissionWarn(e, "calls"); }
  },

  ring(kind) {
    this.stopRing();
    const beep = () => playRing(kind);
    beep();
    this.ringTimer = setInterval(beep, kind === "incoming" ? 1800 : 3000);
  },
  stopRing() { clearInterval(this.ringTimer); this.ringTimer = null; },
};
$("#incoming-accept").addEventListener("click", () => Calls.answer(true));
$("#incoming-decline").addEventListener("click", () => Calls.answer(false));
$("#outgoing-cancel").addEventListener("click", () => Calls.cancelOutgoing());

/* Sonnerie générée (la sonnerie ignore le réglage « sons de notification ») */
let ringCtx = null;
function playRing(kind) {
  try {
    ringCtx = ringCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === "incoming" ? [784, 988, 784, 988] : [440, 440];
    notes.forEach((f, i) => {
      const o = ringCtx.createOscillator();
      const g = ringCtx.createGain();
      o.frequency.value = f;
      const t = ringCtx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(ringCtx.destination);
      o.start(t);
      o.stop(t + 0.17);
    });
  } catch (_) {}
}

/* Notification système quand l'onglet n'est pas au premier plan */
function notifyBrowser(title, body) {
  if (!document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
  try { new Notification(title, { body, icon: "icons/icon-192.png" }); } catch (_) {}
}
function askNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}
["#home-chats-btn", "#home-contacts-btn"].forEach((s) => $(s).addEventListener("click", askNotificationPermission));

/* ---------- 4. Discussions permanentes (1:1 et groupes) ---------- */
const Chats = {
  list: [], unsub: null, openId: null, unsubMsgs: null, initialized: false, lastAt: {},

  load() {
    this.unsub?.();
    this.initialized = false;
    if (!firebaseReady || !state.user || state.user.isGuest) { this.renderList(); return; }
    this.unsub = db.collection("conversations")
      .where("members", "array-contains", state.user.uid)
      .onSnapshot((snap) => {
        this.list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (tsOf(b.lastAt) || Date.now()) - (tsOf(a.lastAt) || Date.now()));
        this.list.forEach((c) => {
          const t = tsOf(c.lastAt);
          if (this.initialized && t && t > (this.lastAt[c.id] || 0) && c.lastSenderId !== state.user.uid) {
            const viewing = this.openId === c.id && !document.hidden && $("#home-chats-tab").classList.contains("active");
            if (!viewing) {
              playSound("message");
              showToast(`💬 ${c.lastSenderName || ""} : ${(c.lastMessage || "").slice(0, 80)}`, "dark");
              notifyBrowser(`💬 ${c.lastSenderName || "Nouveau message"}`, c.lastMessage || "");
            }
          }
          this.lastAt[c.id] = t;
        });
        this.initialized = true;
        this.renderList();
        if (this.openId) this.renderHeader();
      }, (err) => permissionWarn(err, "conversations"));
  },

  title(c) {
    if (c.isGroup) return c.title || "Groupe";
    const other = (c.members || []).find((m) => m !== state.user.uid);
    return c.memberNames?.[other] || "Discussion";
  },
  unread(c) {
    const last = tsOf(c.lastAt);
    return !!last && c.lastSenderId !== state.user.uid && last > tsOf(c.lastRead?.[state.user.uid]);
  },

  renderList() {
    const el = $("#conversations-list");
    const unreadCount = this.list.filter((c) => this.unread(c)).length;
    const badge = $("#chats-unread");
    badge.textContent = unreadCount;
    badge.classList.toggle("d-none", unreadCount === 0);
    if (!firebaseReady) { el.innerHTML = '<div class="text-muted small p-3">Les discussions nécessitent Firebase</div>'; return; }
    if (!this.list.length) { el.innerHTML = '<div class="text-muted small p-3">Aucune discussion pour le moment</div>'; return; }
    el.innerHTML = this.list.map((c) => {
      const t = tsOf(c.lastAt);
      const when = t ? new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
      const other = !c.isGroup ? Contacts.find((c.members || []).find((m) => m !== state.user.uid)) : null;
      const dot = other ? `<span class="presence-dot ${presenceOf(other)}"></span>` : "";
      return `<div class="conv-item meeting-row ${this.openId === c.id ? "active" : ""} ${this.unread(c) ? "unread" : ""}" data-conv="${escapeHtml(c.id)}">
        <div class="position-relative me-2">
          <div class="avatar-circle">${c.isGroup ? '<i class="bi bi-people-fill"></i>' : escapeHtml(initials(this.title(c)))}</div>${dot}
        </div>
        <div class="meeting-info">
          <div class="meeting-title">${escapeHtml(this.title(c))}</div>
          <div class="meeting-meta text-truncate">${escapeHtml(c.lastMessage || "Nouvelle discussion")}</div>
        </div>
        <div class="conv-when">${when}</div>
      </div>`;
    }).join("");
  },

  renderHeader() {
    const c = this.list.find((x) => x.id === this.openId);
    const h = $("#conv-header-title");
    if (!c || !h) return;
    h.textContent = this.title(c);
    $("#conv-header-sub").textContent = c.isGroup
      ? `${(c.members || []).length} membres`
      : PRESENCE_LABELS[presenceOf(Contacts.find((c.members || []).find((m) => m !== state.user.uid)) || {})];
  },

  open(id) {
    this.closeView(false);
    this.openId = id;
    const view = $("#conversation-view");
    view.innerHTML = `
      <div class="conv-header">
        <button class="btn btn-sm btn-light d-md-none" id="conv-back"><i class="bi bi-arrow-left"></i></button>
        <div class="flex-fill min-w-0">
          <div class="fw-semibold text-truncate" id="conv-header-title"></div>
          <div class="small text-muted" id="conv-header-sub"></div>
        </div>
        <button class="btn btn-sm btn-success" id="conv-meet"><i class="bi bi-camera-video-fill"></i> <span class="d-none d-md-inline">Réunion</span></button>
      </div>
      <div class="chat-messages" id="conv-messages"><div class="text-center text-muted small py-4"><span class="spinner-border spinner-border-sm"></span></div></div>
      <form class="chat-input-bar" id="conv-form">
        <input class="form-control" id="conv-input" placeholder="Écrire un message…" autocomplete="off" required maxlength="2000" />
        <button class="btn btn-primary" type="submit"><i class="bi bi-send-fill"></i></button>
      </form>`;
    $("#home-chats-tab .chat-layout").classList.add("show-conv");
    this.renderHeader();
    this.renderList();
    $("#conv-back").onclick = () => this.closeView();
    $("#conv-meet").onclick = () => this.startMeeting();
    $("#conv-form").onsubmit = (e) => {
      e.preventDefault();
      const t = $("#conv-input").value.trim();
      if (t) { $("#conv-input").value = ""; this.send({ text: t }); }
    };
    const box = $("#conv-messages");
    this.unsubMsgs = db.collection("conversations").doc(id).collection("messages")
      .orderBy("createdAt", "asc").limitToLast(300)
      .onSnapshot((snap) => {
        box.innerHTML = snap.docs.map((d) => this.renderMessage(d.data())).join("") ||
          '<div class="text-center text-muted small py-4">Démarrez la conversation 👋</div>';
        box.scrollTop = box.scrollHeight;
        box.querySelectorAll("[data-join-meeting]").forEach((b) => {
          b.onclick = () => joinMeeting(b.dataset.joinMeeting, b.dataset.title);
        });
        this.markRead();
      }, (err) => permissionWarn(err, "conversations"));
  },

  renderMessage(m) {
    const own = m.userId === state.user.uid;
    const time = tsOf(m.createdAt) ? new Date(tsOf(m.createdAt)).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    const body = m.type === "meeting"
      ? `<div><i class="bi bi-camera-video-fill"></i> <strong>${escapeHtml(m.title || "Réunion")}</strong></div>
         <button class="btn btn-sm ${own ? "btn-light" : "btn-primary"} mt-1" data-join-meeting="${escapeHtml(m.meetingId)}" data-title="${escapeHtml(m.title || "")}">Rejoindre</button>`
      : linkify(escapeHtml(m.text || ""));
    return `<div class="chat-msg ${own ? "own" : ""}">
      <div class="msg-meta">${own ? "" : escapeHtml(m.userName || "") + " · "}${time}</div>
      <div class="msg-bubble">${body}</div></div>`;
  },

  markRead() {
    if (!this.openId) return;
    db.collection("conversations").doc(this.openId)
      .update({ [`lastRead.${state.user.uid}`]: firebase.firestore.FieldValue.serverTimestamp() })
      .catch(() => {});
  },

  async send(msg) {
    const id = this.openId;
    if (!id) return;
    const FV = firebase.firestore.FieldValue;
    try {
      await db.collection("conversations").doc(id).collection("messages").add({
        ...msg, userId: state.user.uid, userName: state.user.name, createdAt: FV.serverTimestamp(),
      });
      await db.collection("conversations").doc(id).update({
        lastMessage: msg.type === "meeting" ? `📹 ${msg.title}` : msg.text.slice(0, 200),
        lastAt: FV.serverTimestamp(),
        lastSenderId: state.user.uid,
        lastSenderName: state.user.name,
        [`lastRead.${state.user.uid}`]: FV.serverTimestamp(),
      });
    } catch (e) { permissionWarn(e, "conversations"); showToast("Message non envoyé : " + e.message, "danger"); }
  },

  async startMeeting() {
    const c = this.list.find((x) => x.id === this.openId);
    if (!c) return;
    try {
      const title = this.title(c);
      const ref = await newMeetingDoc(title);
      await this.send({ type: "meeting", meetingId: ref.id, title });
      joinMeeting(ref.id, title);
    } catch (e) { permissionWarn(e); showToast("Réunion impossible : " + e.message, "danger"); }
  },

  /* Ouvre (ou crée) une discussion avec une ou plusieurs personnes */
  async openWith(users, groupName = "") {
    users = users.filter(Boolean);
    if (!users.length) return;
    if (!firebaseReady) { showToast("Les discussions nécessitent Firebase", "warning"); return; }
    const me = state.user;
    const members = [me.uid, ...users.map((u) => u.uid)];
    const memberNames = { [me.uid]: me.name };
    users.forEach((u) => { memberNames[u.uid] = u.name; });
    const isGroup = users.length > 1;
    const FV = firebase.firestore.FieldValue;
    try {
      let id;
      if (!isGroup) {
        // Une seule discussion par paire : identifiant déterministe
        id = [me.uid, users[0].uid].sort().join("_");
        await db.collection("conversations").doc(id).set({ members, memberNames, isGroup: false }, { merge: true });
      } else {
        const ref = await db.collection("conversations").add({
          members, memberNames, isGroup: true, title: groupName || users.map((u) => u.name.split(" ")[0]).join(", "),
          createdBy: me.uid, createdAt: FV.serverTimestamp(), lastAt: FV.serverTimestamp(),
          lastMessage: "Groupe créé", lastSenderId: me.uid, lastSenderName: me.name,
        });
        id = ref.id;
      }
      document.querySelector('[data-bs-target="#home-chats-tab"]').click();
      this.open(id);
    } catch (e) { permissionWarn(e, "conversations"); showToast("Discussion impossible : " + e.message, "danger"); }
  },

  closeView(reset = true) {
    this.unsubMsgs?.();
    this.unsubMsgs = null;
    if (!reset) return;
    this.openId = null;
    $("#home-chats-tab .chat-layout")?.classList.remove("show-conv");
    const view = $("#conversation-view");
    if (view) view.innerHTML = `<div class="text-center text-muted py-5 small m-auto">
      <i class="bi bi-chat-square-text fs-1 d-block mb-2 opacity-50"></i>
      Choisissez une discussion ou démarrez-en une nouvelle</div>`;
    this.renderList();
  },
};
$("#conversations-list").addEventListener("click", (e) => {
  const item = e.target.closest("[data-conv]");
  if (item) Chats.open(item.dataset.conv);
});

/* Fenêtre « Nouvelle discussion » */
const NewConv = {
  selected: new Set(),
  open() {
    if (!firebaseReady) { showToast("Les discussions nécessitent Firebase", "warning"); return; }
    this.selected = new Set();
    $("#nc-search").value = "";
    $("#nc-group-name").value = "";
    this.render();
    bootstrap.Modal.getOrCreateInstance($("#newConversationModal")).show();
  },
  render() {
    const q = $("#nc-search").value.trim().toLowerCase();
    const people = Contacts.list.filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q));
    $("#nc-contacts").innerHTML = people.length
      ? people.map((u) => `<label class="d-flex align-items-center gap-2 py-1">
          <input type="checkbox" class="form-check-input mt-0" data-nc="${escapeHtml(u.uid)}" ${this.selected.has(u.uid) ? "checked" : ""} />
          <span class="presence-dot static ${presenceOf(u)}"></span>
          <span class="flex-fill">${escapeHtml(u.name || "")} <span class="text-muted">${escapeHtml(u.email || "")}</span></span>
        </label>`).join("")
      : '<div class="text-muted">Aucun contact trouvé. Vos collègues doivent d\'abord créer leur compte.</div>';
    $("#nc-group-name-wrap").style.display = this.selected.size > 1 ? "" : "none";
    $("#nc-create").disabled = this.selected.size === 0;
  },
};
$("#new-conversation-btn").addEventListener("click", () => NewConv.open());
$("#nc-search").addEventListener("input", () => NewConv.render());
$("#nc-contacts").addEventListener("change", (e) => {
  const cb = e.target.closest("[data-nc]");
  if (!cb) return;
  if (cb.checked) NewConv.selected.add(cb.dataset.nc);
  else NewConv.selected.delete(cb.dataset.nc);
  NewConv.render();
});
$("#nc-create").addEventListener("click", () => {
  const users = [...NewConv.selected].map((uid) => Contacts.find(uid));
  bootstrap.Modal.getInstance($("#newConversationModal"))?.hide();
  Chats.openWith(users, $("#nc-group-name").value.trim());
});

/* ---------- 5. Connexion Google et mot de passe oublié ---------- */
$("#google-signin-btn").addEventListener("click", async () => {
  if (!firebaseReady) { showToast("La connexion Google nécessite Firebase", "warning"); return; }
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
  } catch (err) {
    // Fenêtre bloquée (fréquent sur mobile) : on passe par une redirection
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(err.code)) {
      auth.signInWithRedirect(provider);
    } else if (err.code !== "auth/popup-closed-by-user") {
      showAuthError(humanizeAuthError(err));
    }
  }
});
$("#forgot-password-btn").addEventListener("click", async () => {
  if (!firebaseReady) { showToast("Nécessite Firebase", "warning"); return; }
  const email = $("#login-email").value.trim() || window.prompt("Votre adresse e-mail :") || "";
  if (!email) return;
  try {
    await auth.sendPasswordResetEmail(email.trim());
    showToast("📧 E-mail de réinitialisation envoyé (vérifiez aussi les spams)", "success");
  } catch (err) { showAuthError(humanizeAuthError(err)); }
});

/* ---------- 6. Réunions récurrentes ---------- */
const RRULES = {
  DAILY: "FREQ=DAILY",
  WEEKDAYS: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  WEEKLY: "FREQ=WEEKLY",
  MONTHLY: "FREQ=MONTHLY",
};
const RECURRENCE_LABELS = {
  DAILY: "tous les jours", WEEKDAYS: "du lundi au vendredi", WEEKLY: "chaque semaine", MONTHLY: "chaque mois",
};
/* Prochaine occurrence d'une réunion (récurrente ou non) à partir de maintenant */
function nextOccurrence(startMs, rec, fromMs = Date.now() - 15 * 60000) {
  if (!startMs || !rec || !RRULES[rec]) return startMs;
  const d = new Date(startMs);
  for (let i = 0; i < 3000 && d.getTime() < fromMs; i++) {
    if (rec === "MONTHLY") d.setMonth(d.getMonth() + 1);
    else if (rec === "WEEKLY") d.setDate(d.getDate() + 7);
    else {
      d.setDate(d.getDate() + 1);
      if (rec === "WEEKDAYS") while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    }
  }
  return d.getTime();
}

/* ---------- 7. Application installable (PWA) ---------- */
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("#install-app-btn").classList.remove("d-none");
});
$("#install-app-btn").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $("#install-app-btn").classList.add("d-none");
});
window.addEventListener("appinstalled", () => showToast("✅ MbokaTech est installé sur votre appareil", "success"));
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker :", e));
}
window.addEventListener("beforeunload", () => Presence.goOffline());
