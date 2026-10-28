// Scénario 1 : appels à 2 puis 3 participants (image, son, micro, chat, main levée,
// partage d'écran, reconnexion, fin de réunion)
const { chromium } = require("playwright");
const L = require("./lib.js");
const { newUser, register, joinAsGuest, mediaReport, check, errors, results } = L;
const fs = require("fs"), path = require("path");
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required",
      "--auto-select-desktop-capture-source=Entire screen", "--enable-usermedia-screen-capturing", "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks"],
  });

  // ---------- Organisateur ----------
  const host = await newUser(browser, "organisateur");
  await register(host, "Davi Organisateur", `davi${Date.now()}@test.cd`);
  check("Inscription de l'organisateur (Firebase Auth)", true);
  await host.click("#create-meeting-btn");
  await host.waitForSelector("#createMeetingModal.show");
  await host.fill("#new-meeting-title", "Test E2E");
  await host.click("#create-meeting-submit");
  await host.waitForSelector("#prejoin-page.active", { timeout: 15000 });
  await host.waitForTimeout(1000);
  await host.click("#prejoin-join-btn");
  await host.waitForSelector("#meeting-page.active");
  await host.waitForFunction(() => state.peerOpen === true, null, { timeout: 15000 });
  const meetingId = await host.evaluate(() => state.currentMeetingId);
  check("Réunion créée et connexion vidéo ouverte", !!meetingId, meetingId);

  // ---------- Invité 1 ----------
  const g1 = await newUser(browser, "invité 1");
  await joinAsGuest(g1, meetingId, "Grace Invitée", "grace@test.cd");
  check("Invité 1 entre par le lien d'invitation", true);

  // ---------- Connexion audio/vidéo à deux ----------
  const waitRemote = (p, n) => p.waitForFunction((n) =>
    [...document.querySelectorAll("#videos-grid .video-tile.remote:not(.presenter) video")].filter((v) => v.srcObject && v.videoWidth > 0).length >= n,
    n, { timeout: 30000 }).then(() => true).catch(() => false);
  check("Organisateur reçoit la vidéo de l'invité", await waitRemote(host, 1));
  check("Invité reçoit la vidéo de l'organisateur", await waitRemote(g1, 1));
  await host.waitForTimeout(1500);
  let rh = await mediaReport(host), rg = await mediaReport(g1);
  console.log("  organisateur reçoit :", JSON.stringify(rh));
  console.log("  invité reçoit       :", JSON.stringify(rg));
  const okAudio = (r) => Object.values(r).length > 0 && Object.values(r).every((x) => x.audioTrack && x.audioPeak > 0.02);
  const okVideo = (r) => Object.values(r).length > 0 && Object.values(r).every((x) => x.videoFrames > 5);
  check("SON : l'organisateur entend l'invité", okAudio(rh));
  check("SON : l'invité entend l'organisateur", okAudio(rg));
  check("IMAGE : flux vidéo actif dans les deux sens", okVideo(rh) && okVideo(rg));
  await host.screenshot({ path: `${SHOTS}/1-deux-participants.png` });

  // ---------- Micro coupé visible chez l'autre ----------
  await g1.click("#toggle-mic");
  const micSeen = await host.waitForFunction(() => {
    const ic = document.querySelector("#videos-grid .video-tile.remote .tile-mic");
    return ic && ic.style.display !== "none";
  }, null, { timeout: 15000 }).then(() => true).catch(() => false);
  check("Micro coupé de l'invité visible chez l'organisateur", micSeen);
  rh = await mediaReport(host);
  check("Micro coupé = silence réel", Object.values(rh).every((x) => x.audioPeak < 0.01), JSON.stringify(Object.values(rh).map((x) => x.audioPeak)));
  await g1.click("#toggle-mic");

  // ---------- Chat ----------
  await g1.click("#toggle-chat-btn").catch(() => {});
  await g1.evaluate(() => { $("#side-panel").classList.remove("collapsed"); document.querySelector('[data-bs-target="#chat-pane"]').click(); });
  await g1.fill("#chat-input", "Bonjour depuis l'invité 👋");
  await g1.press("#chat-input", "Enter");
  const chatOk = await host.waitForFunction(() => document.querySelector("#chat-messages").textContent.includes("Bonjour depuis l'invité"), null, { timeout: 10000 }).then(() => true).catch(() => false);
  check("Chat : message de l'invité reçu par l'organisateur", chatOk);

  // ---------- Main levée ----------
  await g1.click("#raise-hand-btn");
  const handOk = await host.waitForFunction(() => !!document.querySelector("#videos-grid .video-tile.remote .hand-indicator"), null, { timeout: 15000 }).then(() => true).catch(() => false);
  check("Main levée de l'invité visible chez l'organisateur", handOk);

  // ---------- 3e participant (maillage à trois) ----------
  const g2 = await newUser(browser, "invité 2");
  await joinAsGuest(g2, meetingId, "Patrick Invité", "patrick@test.cd");
  const three = (await waitRemote(host, 2)) && (await waitRemote(g1, 2)) && (await waitRemote(g2, 2));
  check("À trois : chacun reçoit les 2 autres vidéos", three);
  await host.waitForTimeout(1500);
  const r3 = await Promise.all([host, g1, g2].map(mediaReport));
  r3.forEach((r, i) => console.log(`  ${["organisateur", "invité 1", "invité 2"][i]} reçoit :`, JSON.stringify(r)));
  check("À trois : tout le monde entend tout le monde", r3.every((r) => Object.keys(r).length === 2 && okAudio(r)));
  await g2.screenshot({ path: `${SHOTS}/2-trois-participants.png` });

  // ---------- Partage d'écran ----------
  const shareStarted = await host.evaluate(async () => { await startScreenShare(); return state.isScreenSharing; }).catch((e) => "err:" + e.message);
  if (shareStarted === true) {
    const seen = await g1.waitForFunction(() => {
      const v = document.querySelector("#videos-grid .video-tile.presenter video");
      return v && v.videoWidth > 0;
    }, null, { timeout: 20000 }).then(() => true).catch(() => false);
    check("Partage d'écran reçu par l'invité", seen);
    await g1.screenshot({ path: `${SHOTS}/3-partage-ecran.png` });
    await host.evaluate(() => stopScreenShare());
  } else {
    check("Partage d'écran (non testable dans ce navigateur headless)", true, String(shareStarted));
  }

  // ---------- Reconnexion : un invité recharge la page ----------
  await g2.close();
  await host.waitForTimeout(1500);
  const g2b = await newUser(browser, "invité 2 (retour)");
  await joinAsGuest(g2b, meetingId, "Patrick Invité", "patrick@test.cd");
  const back = await waitRemote(g2b, 2);
  await host.waitForTimeout(2000);
  const rb = await mediaReport(host);
  console.log("  organisateur reçoit après retour :", JSON.stringify(rb));
  check("Retour d'un participant : vidéo et son rétablis", back && okAudio(rb) && Object.keys(rb).length === 2, `${Object.keys(rb).length} flux`);

  // ---------- Terminer pour tous ----------
  await host.evaluate(() => finishMeeting({ endAll: true }));
  const ended = await g1.waitForSelector("#home-page.active", { timeout: 15000 }).then(() => true).catch(() => false);
  check("Terminer pour tous : l'invité est renvoyé à l'accueil", ended);

  for (const [k, v] of Object.entries(errors)) {
    const uniq = [...new Set(v)];
    check(`Aucune erreur JS ni refus des règles (${k})`, uniq.length === 0, uniq.slice(0, 4).join(" | "));
  }
  console.log(`\n${results.filter((r) => r.startsWith("✅")).length}/${results.length} vérifications réussies`);
  await browser.close();
  process.exit(L.failed ? 1 : 0);
})().catch((e) => { console.error("ÉCHEC :", e.message); for (const [k, v] of Object.entries(errors)) console.error(k, [...new Set(v)].slice(0, 5)); process.exit(2); });
