// Scénario 2 : sécurité, contrôles de l'organisateur, mobile, appels directs, discussions
const { chromium } = require("playwright");
const L = require("./lib.js");
const { newUser, register, joinAsGuest, mediaReport, check, errors, BASE } = L;
const okAudio = (r) => Object.values(r).length > 0 && Object.values(r).every((x) => x.audioTrack && x.audioPeak > 0.02);
const waitFor = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

(async () => {
  const browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required",
      "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks"],
  });
  const stamp = Date.now();

  // Organisateur (compte) + réunion
  const host = await newUser(browser, "organisateur");
  await register(host, "Davi Hôte", `hote${stamp}@test.cd`);
  await host.click("#create-meeting-btn");
  await host.waitForSelector("#createMeetingModal.show");
  await host.fill("#new-meeting-title", "Sécurité E2E");
  await host.click("#create-meeting-submit");
  await host.waitForSelector("#prejoin-page.active");
  await host.waitForTimeout(800);
  await host.click("#prejoin-join-btn");
  await host.waitForSelector("#meeting-page.active");
  await host.waitForFunction(() => state.peerOpen === true, null, { timeout: 15000 });
  const meetingId = await host.evaluate(() => state.currentMeetingId);

  // ---------- 1. Invité sur téléphone Android : il doit être entendu ----------
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ANDROID_UA, isMobile: true, hasTouch: true, permissions: ["camera", "microphone"] });
  await mob.close();
  const g1 = await newUser(browser, "invité mobile", { width: 390, height: 844 });
  await g1.context().setExtraHTTPHeaders({});
  await g1.addInitScript((ua) => { Object.defineProperty(navigator, "userAgent", { get: () => ua }); }, ANDROID_UA);
  await joinAsGuest(g1, meetingId, "Grace Mobile", "grace@test.cd");
  await waitFor(host, () => [...document.querySelectorAll("#videos-grid .video-tile.remote video")].some((v) => v.videoWidth > 0), null, 30000);
  // L'organisateur active la transcription (comme en vrai par défaut)
  await host.waitForTimeout(2500);
  const mobileSkipped = await g1.evaluate(() => isMobileDevice() && !state.isTranscribing);
  check("Mobile : la reconnaissance vocale ne prend pas le micro", mobileSkipped);
  const rh = await mediaReport(host);
  check("Mobile : l'organisateur entend l'invité sur téléphone", okAudio(rh), JSON.stringify(Object.values(rh).map((x) => x.audioPeak)));

  // ---------- 2. Tentatives d'intrusion d'un invité anonyme ----------
  const attempts = await g1.evaluate(async (mid) => {
    const res = {};
    const t = async (k, fn) => { try { await fn(); res[k] = "AUTORISÉ"; } catch (e) { res[k] = e.code || e.message; } };
    await t("lister toutes les réunions", () => db.collection("meetings").get());
    await t("lire l'annuaire des comptes", () => db.collection("users").get());
    await t("lire les comptes rendus", () => db.collection("reports").get());
    await t("devenir propriétaire", () => db.collection("meetings").doc(mid).update({ ownerId: auth.currentUser.uid }));
    await t("verrouiller la réunion à la place de l'organisateur", () => db.collection("meetings").doc(mid).update({ "settings.locked": true }));
    await t("se nommer co-organisateur", () => db.collection("meetings").doc(mid).update({ coHostIds: [auth.currentUser.uid] }));
    await t("terminer la réunion", () => db.collection("meetings").doc(mid).update({ endedAt: new Date() }));
    await t("lire la réunion par son lien (normal)", () => db.collection("meetings").doc(mid).get());
    await t("partager son écran (normal)", () => db.collection("meetings").doc(mid).update({ presenterId: "x" }));
    return res;
  }, meetingId);
  console.log("  intrusion :", JSON.stringify(attempts));
  const denied = (k) => attempts[k] === "permission-denied";
  ["lister toutes les réunions", "lire l'annuaire des comptes", "lire les comptes rendus", "devenir propriétaire",
    "verrouiller la réunion à la place de l'organisateur", "se nommer co-organisateur", "terminer la réunion"].forEach((k) => check(`Sécurité : un invité ne peut pas ${k}`, denied(k), attempts[k]));
  check("Sécurité : un invité peut ouvrir la réunion de son lien", attempts["lire la réunion par son lien (normal)"] === "AUTORISÉ");
  check("Sécurité : un invité peut partager son écran", attempts["partager son écran (normal)"] === "AUTORISÉ");
  await g1.evaluate((mid) => db.collection("meetings").doc(mid).update({ presenterId: firebase.firestore.FieldValue.delete() }), meetingId).catch(() => {});

  // ---------- 3. Salle d'attente ----------
  await host.evaluate(() => { $("#side-panel").classList.remove("collapsed"); document.querySelector('[data-bs-target="#participants-pane"]').click(); });
  await host.click("#hs-waiting");
  await host.waitForTimeout(800);
  const g2 = await newUser(browser, "invité en attente");
  await g2.goto(`${BASE}&join=${meetingId}`);
  await g2.waitForSelector("#guestModal.show", { timeout: 15000 });
  await g2.fill("#guest-name", "Patrick Attente"); await g2.fill("#guest-email", "p@test.cd");
  await g2.click("#guest-form button[type=submit]");
  await g2.waitForSelector("#prejoin-page.active", { timeout: 15000 });
  await g2.waitForTimeout(600);
  await g2.click("#prejoin-join-btn");
  const waiting = await g2.waitForSelector("#waitingRoomModal.show", { timeout: 10000 }).then(() => true).catch(() => false);
  check("Salle d'attente : l'invité patiente", waiting);
  const hostSees = await waitFor(host, () => document.querySelector("#waiting-list")?.textContent.includes("Patrick Attente"));
  check("Salle d'attente : l'organisateur voit la demande", hostSees);
  await host.click("#waiting-list [data-approve]").catch(() => {});
  const admitted = await g2.waitForSelector("#meeting-page.active", { timeout: 15000 }).then(() => true).catch(() => false);
  check("Salle d'attente : l'invité admis entre dans la réunion", admitted);

  // ---------- 4. Verrouillage ----------
  await host.click("#hs-locked");
  await host.waitForTimeout(800);
  const g3 = await newUser(browser, "intrus");
  await g3.goto(`${BASE}&join=${meetingId}`);
  await g3.waitForSelector("#guestModal.show", { timeout: 15000 });
  await g3.fill("#guest-name", "Intrus"); await g3.fill("#guest-email", "i@test.cd");
  await g3.click("#guest-form button[type=submit]");
  await g3.waitForSelector("#prejoin-page.active", { timeout: 15000 });
  await g3.waitForTimeout(600);
  await g3.click("#prejoin-join-btn");
  await g3.waitForTimeout(3000);
  check("Verrouillage : un nouveau venu ne peut pas entrer", !(await g3.isVisible("#meeting-page.active")));
  await host.click("#hs-locked");
  await host.click("#hs-waiting");

  // ---------- 5. Expulsion ----------
  await host.waitForTimeout(1500);
  const kicked = await host.evaluate(async () => {
    const p = state.allParticipants.find((x) => x.name === "Patrick Attente");
    if (!p) return "absent";
    const orig = window.askConfirm; window.askConfirm = async () => true;
    await handleParticipantAction("kick", p.peerId, p.userId);
    window.askConfirm = orig;
    return "ok";
  });
  const out = await g2.waitForSelector("#home-page.active", { timeout: 15000 }).then(() => true).catch(() => false);
  check("Expulsion : le participant est sorti", kicked === "ok" && out, kicked);

  // ---------- 6. Co-organisateur (compte) ----------
  const acc = await newUser(browser, "collègue");
  await register(acc, "Aline Collègue", `aline${stamp}@test.cd`);
  await acc.goto(`${BASE}&join=${meetingId}`);
  await acc.waitForSelector("#prejoin-page.active", { timeout: 15000 });
  await acc.waitForTimeout(600);
  await acc.click("#prejoin-join-btn");
  await acc.waitForSelector("#meeting-page.active", { timeout: 15000 });
  await waitFor(host, () => state.allParticipants.some((p) => p.name === "Aline Collègue"));
  await host.evaluate(async () => {
    const p = state.allParticipants.find((x) => x.name === "Aline Collègue");
    await toggleCoHost(p.userId);
  });
  const coOk = await waitFor(acc, () => state.isOrganizer === true && document.querySelector("#host-controls").style.display !== "none");
  check("Co-organisateur : droits donnés en direct", coOk);
  const coCan = await acc.evaluate(async (mid) => { try { await db.collection("meetings").doc(mid).update({ "settings.chatEnabled": true }); return true; } catch (e) { return e.code; } }, meetingId);
  check("Co-organisateur : peut modifier les réglages (règles)", coCan === true, String(coCan));

  // ---------- 7. Fin, compte rendu, accueil ----------
  await host.evaluate(() => finishMeeting({ endAll: true }));
  await host.waitForSelector("#recapModal.show", { timeout: 30000 }).catch(() => {});
  check("Fin : récapitulatif affiché à l'organisateur", await host.isVisible("#recapModal"));
  await host.evaluate(() => hideModalSafe("#recapModal"));
  await host.waitForTimeout(1500);
  check("Accueil : la réunion apparaît dans « Mes réunions »", (await host.textContent("#meetings-list")).includes("Sécurité E2E"));
  const accHome = await acc.waitForSelector("#home-page.active", { timeout: 15000 }).then(() => true).catch(() => false);
  await acc.waitForTimeout(1500);
  check("Accueil du collègue : la réunion rejointe apparaît", accHome && (await acc.textContent("#meetings-list")).includes("Sécurité E2E"));

  // ---------- 8. Contacts, appel direct, discussion ----------
  await acc.click("#home-contacts-btn");
  const hostUid0 = await host.evaluate(() => state.user.uid);
  const seesHost = await waitFor(acc, (u) => !!document.querySelector(`#contacts-list [data-uid="${u}"]`) && document.querySelector(`#contacts-list [data-uid="${u}"]`).textContent.includes("Davi Hôte"), hostUid0, 20000);
  check("Contacts : le collègue voit l'organisateur", seesHost);
  const hostUid = await host.evaluate(() => state.user.uid);
  await acc.click(`#contacts-list [data-contact-call="${hostUid}"]`);
  const ring = await host.waitForSelector("#incomingCallModal.show", { timeout: 15000 }).then(() => true).catch(() => false);
  check("Appel direct : ça sonne chez l'organisateur", ring);
  if (ring) {
    await host.click("#incoming-accept");
    const both = (await host.waitForSelector("#prejoin-page.active", { timeout: 15000 }).then(() => true).catch(() => false)) &&
      (await acc.waitForSelector("#prejoin-page.active", { timeout: 15000 }).then(() => true).catch(() => false));
    check("Appel direct : accepté, les deux rejoignent l'appel", both);
    for (const p of [host, acc]) { await p.click("#prejoin-join-btn").catch(() => {}); }
    const callAudio = await waitFor(host, () => [...document.querySelectorAll("#videos-grid .video-tile.remote video")].some((v) => v.videoWidth > 0), null, 30000);
    const r = await mediaReport(host);
    if (!callAudio) for (const p of [host, acc]) console.log("  DIAG", p.label, await p.evaluate(() => JSON.stringify({
      page: document.querySelector(".page.active")?.id, mid: state.currentMeetingId, peerOpen: state.peerOpen, me: state.myPeerId,
      calls: Object.keys(state.calls), parts: (state.allParticipants || []).map((x) => x.name + ":" + x.peerId),
      modals: [...document.querySelectorAll(".modal.show")].map((m) => m.id),
    })));
    check("Appel direct : vidéo et son", callAudio && okAudio(r));
    await host.evaluate(() => finishMeeting());
    await acc.evaluate(() => finishMeeting());
    await host.waitForTimeout(1000);
    await host.evaluate(() => hideModalSafe("#recapModal"));
    await acc.evaluate(() => hideModalSafe("#recapModal"));
  }
  await acc.waitForTimeout(800);
  await acc.click("#home-contacts-btn");
  await acc.click(`#contacts-list [data-contact-chat="${hostUid}"]`);
  await acc.waitForSelector("#conv-input", { timeout: 15000 });
  await acc.fill("#conv-input", "Salut ! On se fait un point demain ?");
  await acc.press("#conv-input", "Enter");
  await host.click("#home-chats-btn");
  const convOk = await waitFor(host, () => document.querySelector("#conversations-list")?.textContent.includes("On se fait un point"), null, 15000);
  check("Discussion : le message arrive chez l'organisateur", convOk);
  const unread = await host.textContent("#chats-unread");
  check("Discussion : badge de message non lu", unread === "1", unread);

  for (const [k, v] of Object.entries(errors)) {
    const uniq = [...new Set(v)].filter((x) => !/permission-denied|Missing or insufficient/.test(x) || k === "organisateur" || k === "collègue");
    check(`Aucune erreur JS (${k})`, uniq.length === 0, uniq.slice(0, 3).join(" | "));
  }
  const ok = L.results.filter((r) => r.startsWith("✅")).length;
  console.log(`\n${ok}/${L.results.length} vérifications réussies`);
  await browser.close();
  process.exit(L.failed ? 1 : 0);
})().catch((e) => { console.error("ÉCHEC :", e.message); for (const [k, v] of Object.entries(errors)) console.error(k, [...new Set(v)].slice(0, 5)); process.exit(2); });
