/* MbokaTech — Vague 3 : assistant automatique (transcription, enregistrement,
   compte rendu de fin), présence, co-organisateurs, comptes rendus, accueil */

/* ---------- 1. Assistant de réunion : démarrage automatique et rôles ---------- */
const Assistant = {
  joinedAt: 0, autoStarted: false, coHost: false, transcriptToastShown: false, mem: {},

  onEntered(meetingId) {
    this.joinedAt = Date.now();
    this.autoStarted = false;
    this.coHost = false;
    this.transcriptToastShown = false;
    this.recordJoin(meetingId);
    if (firebaseReady) rt.updateMeeting(meetingId, { attendeeIds: rt.union(state.user.uid) }).catch(() => {});
    if (state.isOrganizer) setTimeout(() => this.autoStart(), 1500);
  },

  /* Transcription et enregistrement lancés tout seuls, selon les réglages de la réunion */
  autoStart() {
    if (this.autoStarted || !state.currentMeetingId || !state.isOrganizer) return;
    this.autoStarted = true;
    const st = meetingSettings();
    const speechOk = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    if (st.autoTranscribe && speechOk && !state.isTranscribing) startTranscription();
    if (st.autoRecord && !state.isRecording) startRecording();
  },

  onMeetingDoc(data) {
    const uid = state.user?.uid;
    const isCo = (data.coHostIds || []).includes(uid) && state.meetingOwnerId !== uid;
    if (isCo !== this.coHost) {
      this.coHost = isCo;
      this.applyRole(isCo);
    }
    if (data.transcriptionActive && !state.isOrganizer && !this.transcriptToastShown) {
      this.transcriptToastShown = true;
      showToast("🔴 La réunion est transcrite pour le compte rendu automatique", "info");
    }
  },

  /* Donne (ou retire) les droits d'organisateur à un co-organisateur, en direct */
  applyRole(isCo) {
    const owner = state.meetingOwnerId === state.user.uid;
    state.isOrganizer = owner || isCo;
    const host = state.isOrganizer;
    $("#host-controls").style.display = host ? "" : "none";
    const aiTab = document.querySelector('[data-bs-target="#ai-pane"]');
    if (aiTab) aiTab.style.display = host ? "" : "none";
    $("#toggle-ai-btn").style.display = host ? "" : "none";
    const tBtn = $("#toggle-transcription-btn");
    if (tBtn) { tBtn.disabled = !host; tBtn.classList.toggle("opacity-50", !host); }
    if (host && firebaseReady && !state.unsubWaiting) {
      state.unsubWaiting = syncWaitingRoom(state.currentMeetingId);
    } else if (!host && typeof state.unsubWaiting === "function") {
      state.unsubWaiting();
      state.unsubWaiting = null;
      $("#waiting-room").style.display = "none";
    }
    if (!host) document.querySelector('[data-bs-target="#chat-pane"]')?.click();
    applyMeetingPolicies();
    renderParticipantsList();
    if (!owner) {
      showToast(isCo ? "⭐ Vous êtes maintenant co-organisateur" : "Vos droits de co-organisateur ont été retirés", isCo ? "success" : "secondary");
    }
  },

  /* ----- Rapport de présence ----- */
  async recordJoin(meetingId) {
    const u = state.user;
    const row = {
      uid: u.uid, name: u.name, email: u.email || "",
      isGuest: !!u.isGuest, isOwner: state.meetingOwnerId === u.uid || (!firebaseReady && state.isOrganizer),
    };
    if (!firebaseReady) {
      const m = (this.mem[meetingId] = this.mem[meetingId] || {});
      const r = (m[u.uid] = m[u.uid] || { ...row, firstJoinAt: Date.now(), totalMs: 0, sessions: 0 });
      r.sessions++;
      r.lastJoinAt = Date.now();
      return;
    }
    const FV = firebase.firestore.FieldValue;
    const ref = db.collection("meetings").doc(meetingId).collection("attendance").doc(u.uid);
    try {
      const snap = await ref.get();
      await ref.set({
        ...row,
        ...(snap.exists ? {} : { firstJoinAt: FV.serverTimestamp(), totalMs: 0 }),
        lastJoinAt: FV.serverTimestamp(),
        sessions: FV.increment(1),
      }, { merge: true });
    } catch (e) { permissionWarn(e, "attendance"); }
  },

  onLeaving() {
    const meetingId = state.currentMeetingId;
    if (!meetingId || !this.joinedAt) return;
    const ms = Date.now() - this.joinedAt;
    this.joinedAt = 0;
    if (!firebaseReady) {
      const r = this.mem[meetingId]?.[state.user.uid];
      if (r) { r.totalMs += ms; r.lastLeaveAt = Date.now(); }
      return;
    }
    const FV = firebase.firestore.FieldValue;
    db.collection("meetings").doc(meetingId).collection("attendance").doc(state.user.uid)
      .set({ totalMs: FV.increment(ms), lastLeaveAt: FV.serverTimestamp() }, { merge: true })
      .catch(() => {});
  },

  async getAttendance(meetingId) {
    let rows = [];
    if (!firebaseReady) {
      rows = Object.values(this.mem[meetingId] || {}).map((r) => ({ ...r }));
    } else {
      const snap = await db.collection("meetings").doc(meetingId).collection("attendance").get();
      rows = snap.docs.map((d) => d.data());
    }
    const now = Date.now();
    return rows.map((r) => {
      const join = tsOf(r.lastJoinAt), leave = tsOf(r.lastLeaveAt);
      const present = join && (!leave || join > leave);
      // Pour une personne encore présente, on ajoute le temps en cours
      const totalMs = (r.totalMs || 0) + (present && join ? Math.max(0, now - join) : 0);
      return { ...r, present, totalMs, first: tsOf(r.firstJoinAt), last: present ? 0 : leave };
    }).sort((a, b) => a.first - b.first);
  },

  async downloadAttendanceCSV(meetingId, title) {
    if (!meetingId) return;
    try {
      const rows = await this.getAttendance(meetingId);
      if (!rows.length) { showToast("Aucune présence enregistrée pour cette réunion", "warning"); return; }
      const fmt = (t) => (t ? new Date(t).toLocaleString("fr-FR") : "");
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [
        ["Nom", "E-mail", "Rôle", "Première arrivée", "Dernier départ", "Durée (min)", "Connexions"].map(q).join(";"),
        ...rows.map((r) => [
          r.name, r.email,
          r.isOwner ? "Organisateur" : r.isGuest ? "Invité" : "Participant",
          fmt(r.first), r.present ? "encore présent" : fmt(r.last),
          Math.round(r.totalMs / 60000), r.sessions || 1,
        ].map(q).join(";")),
      ];
      // BOM pour qu'Excel lise correctement les accents
      downloadBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `Presence_${safeName(title)}.csv`);
    } catch (e) {
      permissionWarn(e, "attendance");
      showToast("Rapport de présence indisponible : " + e.message, "danger");
    }
  },
};

$("#attendance-csv-btn").addEventListener("click", () =>
  Assistant.downloadAttendanceCSV(state.currentMeetingId, state.currentMeetingTitle));

async function toggleCoHost(userId) {
  if (!state.currentMeetingId || !userId) return;
  const on = !(state.meetingData?.coHostIds || []).includes(userId);
  try {
    await rt.updateMeeting(state.currentMeetingId, { coHostIds: on ? rt.union(userId) : rt.without(userId) });
    showToast(on ? "⭐ Co-organisateur nommé" : "Droits de co-organisateur retirés", "success");
  } catch (e) { permissionWarn(e); }
}

/* ---------- 2. Fin de réunion : compte rendu automatique + récapitulatif ---------- */
function showBusy(text) {
  let el = document.getElementById("busy-overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "busy-overlay";
    el.innerHTML = '<div class="busy-box"><div class="spinner-border text-primary mb-3"></div><div class="fw-semibold" id="busy-text"></div></div>';
    document.body.appendChild(el);
  }
  $("#busy-text").textContent = text;
  el.style.display = "flex";
}
function hideBusy() {
  const el = document.getElementById("busy-overlay");
  if (el) el.style.display = "none";
}

async function finishMeeting({ endAll = false } = {}) {
  if (!state.currentMeetingId || state.finishing) return;
  state.finishing = true;
  const meetingId = state.currentMeetingId;
  const title = state.currentMeetingTitle;
  const durationMs = Date.now() - (state.meetingStartTime || Date.now());
  const people = new Set((state.allParticipants || []).map((p) => p.userId)).size || 1;
  const entries = (state.transcriptEntries?.length ? state.transcriptEntries : state.localTranscriptEntries) || [];
  const meta = getReportMeta();
  let report = null;

  try {
    if (endAll) await endMeetingForAll();
    if (state.isOrganizer && meetingSettings().autoReport) {
      showBusy("✨ L'IA rédige le compte rendu de la réunion…");
      try { report = (await generateReport()) || null; } catch (e) { console.warn(e); }
    }
    if (report && !firebaseReady) Reports.addLocal(report, meta, meetingId);
    const reportId = state.lastReportId;
    leaveMeeting();
    showRecap({ title, durationMs, people, interventions: entries.length, report, reportId, meetingId, meta });
  } finally {
    hideBusy();
    state.finishing = false;
  }
}

function showRecap(r) {
  $("#recap-title").textContent = r.title || "Réunion";
  $("#recap-duration").textContent = fmtDuration(r.durationMs);
  $("#recap-people").textContent = r.people;
  $("#recap-words").textContent = r.interventions;
  const box = $("#recap-report");
  const openBtn = $("#recap-open-report");
  if (r.report) {
    box.innerHTML = `<div class="alert alert-success mb-0"><div class="fw-semibold mb-1"><i class="bi bi-stars"></i> Compte rendu prêt</div>${escapeHtml((r.report.summary || "").slice(0, 280))}${(r.report.summary || "").length > 280 ? "…" : ""}</div>`;
    openBtn.style.display = "";
    openBtn.onclick = () => {
      bootstrap.Modal.getInstance($("#recapModal"))?.hide();
      Reports.open({
        ...r.report, id: r.reportId, meetingId: r.meetingId, meetingTitle: r.title,
        createdAt: new Date(), ownerName: state.user.name,
      });
    };
  } else {
    box.innerHTML = "";
    openBtn.style.display = "none";
  }
  bootstrap.Modal.getOrCreateInstance($("#recapModal")).show();
}

/* ---------- 3. Comptes rendus : liste, lecture, exports, e-mail de suivi ---------- */
const Reports = {
  list: [], unsub: null, current: null,

  load() {
    this.unsub?.();
    this.unsub = null;
    if (!firebaseReady || !state.user) { this.render(); return; }
    this.unsub = db.collection("reports").where("ownerId", "==", state.user.uid).limit(200).onSnapshot(
      (snap) => {
        this.list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => tsOf(b.createdAt) - tsOf(a.createdAt));
        this.render();
      },
      (err) => permissionWarn(err, "reports")
    );
  },

  addLocal(report, meta, meetingId) {
    this.list.unshift({
      ...report, id: "local-" + Date.now(), meetingId,
      meetingTitle: meta.title, createdAt: new Date(), aiUsed: "local",
    });
    this.render();
  },

  render() {
    const el = $("#reports-list");
    $("#reports-count").textContent = this.list.length;
    $("#stat-reports").textContent = Math.max(Number($("#stat-reports").textContent) || 0, this.list.length);
    if (!this.list.length) {
      el.innerHTML = `<div class="text-center text-muted py-5 small">
        <i class="bi bi-stars fs-1 d-block mb-2 opacity-50"></i>
        Les comptes rendus générés par l'IA apparaîtront ici</div>`;
      return;
    }
    el.innerHTML = this.list.map((r) => {
      const d = new Date(tsOf(r.createdAt) || Date.now());
      const when = d.toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const counts = `${(r.decisions || []).length} décision(s) · ${(r.actions || []).length} action(s)`;
      return `<div class="meeting-row report-row" data-report="${escapeHtml(r.id)}">
        <div class="meeting-icon"><i class="bi bi-file-earmark-text-fill"></i></div>
        <div class="meeting-info">
          <div class="meeting-title">${escapeHtml(r.meetingTitle || "Réunion")}</div>
          <div class="meeting-meta"><i class="bi bi-clock"></i> ${when} · ${counts}</div>
          <div class="meeting-meta text-truncate">${escapeHtml((r.summary || "").slice(0, 140))}</div>
        </div>
        <div class="ms-3 d-flex gap-2 flex-shrink-0">
          <button class="btn btn-sm btn-primary" data-report-open="${escapeHtml(r.id)}"><i class="bi bi-eye"></i> <span class="d-none d-md-inline">Lire</span></button>
        </div>
      </div>`;
    }).join("");
    applyHomeSearch();
  },

  find(id) { return this.list.find((r) => r.id === id); },

  meta(r) {
    const d = new Date(tsOf(r.createdAt) || Date.now());
    const names = new Set();
    (r.transcript || "").split("\n").forEach((line) => {
      const m = line.match(/^([^:]{2,40}) : /);
      if (m) names.add(m[1].trim());
    });
    return {
      title: r.meetingTitle || "Réunion",
      dateStr: d.toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
      timeStr: d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      organizerName: r.ownerName || state.user?.name || "Organisateur",
      participants: names.size ? [...names] : [state.user?.name || "Organisateur"],
      meetingId: r.meetingId || "",
    };
  },

  async open(r) {
    this.current = r;
    const meta = this.meta(r);
    $("#rm-title").textContent = meta.title;
    $("#rm-meta").textContent = `${meta.dateStr} · ${meta.timeStr}${r.aiUsed ? " · " + r.aiUsed : ""}`;
    const list = (items, empty) => (items || []).length
      ? `<ul class="mb-0">${items.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : `<div class="text-muted small"><em>${empty}</em></div>`;
    $("#rm-body").innerHTML = `
      <div class="ai-section"><div class="ai-section-title"><i class="bi bi-file-text-fill text-primary"></i>Résumé</div>
        <div class="ai-section-body">${escapeHtml(r.summary || "—")}</div></div>
      <div class="ai-section"><div class="ai-section-title"><i class="bi bi-check2-square text-success"></i>Décisions</div>
        <div class="ai-section-body">${list(r.decisions, "Aucune décision")}</div></div>
      <div class="ai-section"><div class="ai-section-title"><i class="bi bi-list-task text-warning"></i>Actions</div>
        <div class="ai-section-body">${list(r.actions, "Aucune action")}</div></div>
      <div class="ai-section"><div class="ai-section-title"><i class="bi bi-pin-angle-fill text-danger"></i>Points importants</div>
        <div class="ai-section-body">${list(r.keypoints, "Aucun point")}</div></div>
      <div class="ai-section"><div class="ai-section-title"><i class="bi bi-person-check-fill text-primary"></i>Présence</div>
        <div class="ai-section-body" id="rm-attendance"><span class="spinner-border spinner-border-sm"></span></div></div>
      ${r.transcript ? `<details class="small"><summary class="fw-semibold">Transcription complète</summary>
        <pre class="small mt-2 mb-0" style="white-space:pre-wrap;max-height:300px;overflow:auto;">${escapeHtml(r.transcript)}</pre></details>` : ""}`;
    bootstrap.Modal.getOrCreateInstance($("#reportModal")).show();

    const box = $("#rm-attendance");
    try {
      const rows = r.meetingId ? await Assistant.getAttendance(r.meetingId) : [];
      box.innerHTML = rows.length
        ? `<table class="table table-sm mb-0 small"><thead><tr><th>Nom</th><th>Arrivée</th><th>Durée</th></tr></thead><tbody>${rows.map((x) => `
            <tr><td>${escapeHtml(x.name || "")}${x.isOwner ? ' <span class="badge bg-primary-subtle text-primary">organisateur</span>' : ""}</td>
            <td>${x.first ? new Date(x.first).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
            <td>${Math.max(1, Math.round(x.totalMs / 60000))} min</td></tr>`).join("")}</tbody></table>`
        : '<span class="text-muted"><em>Présence non enregistrée</em></span>';
    } catch (e) {
      box.innerHTML = '<span class="text-muted"><em>Présence indisponible</em></span>';
    }
  },

  followUpEmail(r) {
    const meta = this.meta(r);
    const bullets = (items) => (items || []).map((x) => `- ${x}`).join("\n") || "- (aucune)";
    return {
      subject: `Compte rendu — ${meta.title} (${meta.dateStr})`,
      body: `Bonjour à tous,

Merci pour votre participation à la réunion « ${meta.title} » du ${meta.dateStr} à ${meta.timeStr}.

RÉSUMÉ
${r.summary || ""}

DÉCISIONS
${bullets(r.decisions)}

ACTIONS À MENER
${bullets(r.actions)}

POINTS IMPORTANTS
${bullets(r.keypoints)}

Cordialement,
${state.user?.name || ""}`,
    };
  },
};

$("#reports-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-report-open]") || e.target.closest(".report-row");
  if (!b) return;
  const r = Reports.find(b.dataset.reportOpen || b.dataset.report);
  if (r) Reports.open(r);
});
$("#rm-pdf").addEventListener("click", () => {
  const r = Reports.current;
  if (r) exportReportPDFDirect(r, Reports.meta(r));
});
$("#rm-word").addEventListener("click", () => {
  const r = Reports.current;
  if (r) exportReportWordDirect(r, Reports.meta(r));
});
$("#rm-csv").addEventListener("click", () => {
  const r = Reports.current;
  if (r) Assistant.downloadAttendanceCSV(r.meetingId, r.meetingTitle);
});
$("#rm-email").addEventListener("click", () => {
  const r = Reports.current;
  if (!r) return;
  const { subject, body } = Reports.followUpEmail(r);
  // Les liens mailto sont limités en longueur : au-delà, on copie le texte
  const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (url.length > 1900) {
    copyText(`${subject}\n\n${body}`, "E-mail copié : collez-le dans votre messagerie");
  } else {
    window.location.href = url;
  }
});
$("#rm-copy").addEventListener("click", () => {
  const r = Reports.current;
  if (!r) return;
  const { subject, body } = Reports.followUpEmail(r);
  copyText(`${subject}\n\n${body}`, "Compte rendu copié");
});

/* ---------- 4. Accueil : prochaine réunion et recherche ---------- */
let nextMeetingTimer = null;
function onMeetingsRendered(docs) {
  const now = Date.now();
  const upcoming = docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => tsOf(m.scheduledAt) > now - 15 * 60000)
    .sort((a, b) => tsOf(a.scheduledAt) - tsOf(b.scheduledAt))[0];
  const box = $("#next-meeting");
  clearInterval(nextMeetingTimer);
  setTimeout(applyHomeSearch, 0);
  if (!upcoming) {
    box.innerHTML = `<div class="text-muted small">Prochaine réunion</div>
      <div class="small fw-semibold mt-2 text-muted">Aucune réunion planifiée</div>`;
    return;
  }
  const paint = () => {
    const t = tsOf(upcoming.scheduledAt);
    const diff = t - Date.now();
    let when;
    if (diff <= 0) when = '<span class="badge bg-danger">En cours</span>';
    else if (diff < 3600000) when = `dans ${Math.ceil(diff / 60000)} min`;
    else if (diff < 86400000) when = `dans ${Math.floor(diff / 3600000)} h ${Math.round((diff % 3600000) / 60000)} min`;
    else when = new Date(t).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    box.innerHTML = `<div class="text-muted small">Prochaine réunion</div>
      <div class="fw-semibold text-truncate mt-1" title="${escapeHtml(upcoming.title || "")}">${escapeHtml(upcoming.title || "Réunion")}</div>
      <div class="small text-primary">${when}</div>
      <button class="btn btn-sm btn-primary mt-1 py-0" id="next-meeting-join">Rejoindre</button>`;
    $("#next-meeting-join").onclick = () => joinMeeting(upcoming.id, upcoming.title);
  };
  paint();
  nextMeetingTimer = setInterval(paint, 30000);
}

function applyHomeSearch() {
  const q = ($("#home-search")?.value || "").trim().toLowerCase();
  document.querySelectorAll("#meetings-list .meeting-row, #reports-list .meeting-row").forEach((row) => {
    row.style.display = !q || row.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}
$("#home-search").addEventListener("input", applyHomeSearch);
