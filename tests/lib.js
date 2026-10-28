// Banc d'essai MbokaTech : vrais appels entre plusieurs navigateurs
// (émulateurs Firebase + serveur PeerJS locaux, caméra/micro simulés).
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const NM = path.join(__dirname, "node_modules");
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = "http://localhost:5173/index.html?emulators";

const map = [
  [/cdn\.jsdelivr\.net\/npm\/bootstrap@5\.3\.3\/(.*)$/, (m) => `bootstrap/${m[1]}`],
  [/cdn\.jsdelivr\.net\/npm\/bootstrap-icons@1\.11\.3\/(.*)$/, (m) => `bootstrap-icons/${m[1]}`],
  [/cdn\.jsdelivr\.net\/npm\/@mediapipe\/selfie_segmentation@[^/]+\/(.*)$/, (m) => `@mediapipe/selfie_segmentation/${m[1]}`],
  [/gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/, (m) => `firebase/${m[1]}`],
  [/unpkg\.com\/peerjs@1\.5\.4\/dist\/peerjs\.min\.js/, () => "peerjs/dist/peerjs.min.js"],
  [/jspdf\/2\.5\.1\/jspdf\.umd\.min\.js/, () => "jspdf/dist/jspdf.umd.min.js"],
  [/jspdf-autotable\/3\.8\.2\/jspdf\.plugin\.autotable\.min\.js/, () => "jspdf-autotable/dist/jspdf.plugin.autotable.min.js"],
  [/docx@8\.5\.0\/build\/index\.umd\.js/, () => "docx/build/index.umd.js"],
  [/FileSaver\.js\/2\.0\.5\/FileSaver\.min\.js/, () => "file-saver/dist/FileSaver.min.js"],
];
const types = { js: "text/javascript", css: "text/css", wasm: "application/wasm", woff2: "font/woff2", woff: "font/woff", png: "image/png", html: "text/html", webmanifest: "application/json" };

const results = [];
const errors = {};
let failed = 0;
const check = (name, ok, extra = "") => { if (!ok) failed++; results.push(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); console.log(results[results.length - 1]); };

async function newUser(browser, label, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport, permissions: ["camera", "microphone"] });
  await ctx.route("**/*", async (route) => {
    const url = route.request().url();
    const u = new URL(url);
    if (u.hostname === "localhost" && u.port !== "5173") return route.continue(); // émulateurs, PeerJS
    if (url.startsWith("http://localhost:5173/")) {
      const f = path.join(ROOT, u.pathname.slice(1) || "index.html");
      return fs.existsSync(f) ? route.fulfill({ body: fs.readFileSync(f), contentType: types[f.split(".").pop()] }) : route.fulfill({ status: 404, body: "" });
    }
    for (const [re, fn] of map) {
      const m = url.match(re);
      if (m) {
        const f = path.join(NM, fn(m).split("?")[0]);
        if (fs.existsSync(f)) return route.fulfill({ body: fs.readFileSync(f), contentType: types[f.split(".").pop()] || "application/octet-stream", headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }
    return route.abort();
  });
  const page = await ctx.newPage();
  errors[label] = [];
  page.on("pageerror", (e) => errors[label].push(e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !/Failed to load resource|net::ERR|ERR_FAILED|favicon/.test(t)) errors[label].push(t);
    if (/permission-denied|PERMISSION_DENIED|Missing or insufficient permissions/.test(t)) errors[label].push("RÈGLES : " + t);
  });
  page.label = label;
  return page;
}

async function register(page, name, email) {
  await page.goto(BASE);
  await page.waitForTimeout(800);
  await page.click('[data-bs-target="#register-tab"]');
  await page.fill("#register-name", name);
  await page.fill("#register-email", email);
  await page.fill("#register-password", "secret123");
  await page.click("#register-form button[type=submit]");
  await page.waitForSelector("#home-page.active", { timeout: 15000 });
}

async function joinAsGuest(page, meetingId, name, email) {
  await page.goto(`${BASE}&join=${meetingId}`);
  await page.waitForSelector("#guestModal.show", { timeout: 15000 });
  await page.fill("#guest-name", name);
  await page.fill("#guest-email", email);
  await page.click("#guest-form button[type=submit]");
  await page.waitForSelector("#prejoin-page.active", { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.click("#prejoin-join-btn");
  await page.waitForSelector("#meeting-page.active", { timeout: 15000 });
}

/* Mesure ce qu'une page reçoit de chaque participant : images vidéo et niveau sonore */
async function mediaReport(page) {
  return page.evaluate(async () => {
    const out = {};
    const tiles = [...document.querySelectorAll("#videos-grid .video-tile.remote:not(.presenter)")];
    const ctx = new AudioContext();
    await ctx.resume();
    for (const tile of tiles) {
      const v = tile.querySelector("video");
      const s = v?.srcObject;
      const name = tile.querySelector(".tile-name")?.textContent || tile.id;
      const f0 = v?.getVideoPlaybackQuality?.().totalVideoFrames || 0;
      let peak = 0;
      const at = s?.getAudioTracks?.()[0];
      if (at) {
        const src = ctx.createMediaStreamSource(new MediaStream([at]));
        const an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
        const d = new Float32Array(an.fftSize);
        const t0 = performance.now();
        while (performance.now() - t0 < 2500) {
          an.getFloatTimeDomainData(d);
          for (const x of d) peak = Math.max(peak, Math.abs(x));
          await new Promise((r) => setTimeout(r, 50));
        }
        src.disconnect();
      } else {
        await new Promise((r) => setTimeout(r, 2500));
      }
      const f1 = v?.getVideoPlaybackQuality?.().totalVideoFrames || 0;
      out[name] = {
        videoFrames: f1 - f0, videoWidth: v?.videoWidth || 0,
        audioTrack: !!at, audioEnabled: at ? at.enabled && at.readyState === "live" : false,
        audioPeak: +peak.toFixed(3), paused: v?.paused, muted: v?.muted,
      };
    }
    ctx.close();
    return out;
  });
}

module.exports = { newUser, register, joinAsGuest, mediaReport, check, results, errors, BASE, get failed() { return failed; } };
