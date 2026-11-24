// ELG Random Flights (Android). Everything is fetched online, like the PC version:
//   - current routes: Virtual Radar Server standing data (GitHub), downloaded per airline when needed
//   - live flights: OpenSky Network (anonymous), routes from VRS / adsbdb, aircraft from adsbdb / hexdb
//   - photos: Planespotters.net (exact aircraft), Wikimedia Commons, Google link as last resort
(() => {
"use strict";
const D = window.DATA;
const VRS = "https://raw.githubusercontent.com/vradarserver/standing-data/main/";
const CAT_EN = {"Comercial": "Airliner", "Regional": "Regional", "Carga": "Cargo", "Executiva": "Business jet",
  "Aviação geral": "General aviation", "Helicóptero": "Helicopter", "Militar": "Military"};
// WEB = the iPhone / browser version: browsers can't reach OpenSky (no CORS), so no live flights there
const WEB = !window.Native;
const SOURCES = ["All", `Current routes ${new Date().getFullYear()} (worldwide, real flight numbers)`]
  .concat(WEB ? [] : ["Live flights now (OpenSky ADS-B)"]);
const SRC_ALL = 0, SRC_CURRENT = 1, SRC_LIVE = 2;
const STATES_TTL = 5 * 60e3;     // OpenSky anonymous: ~100 global requests a day
const PHOTO_TTL = 24 * 3600e3;   // Planespotters allows keeping the JSON answer up to 24 h
const CARGO = new Set(D.cargo);

// ------------------------------------------------------------ http (native bridge, no CORS limits)
let reqId = 0;
const pending = {};
window.__nativeDone = (id, status) => {
  const p = pending[id]; delete pending[id];
  if (p) p({status, body: window.Native.take(id) || ""});
};
function http(url, headers) {
  if (window.Native) {
    const id = "r" + (++reqId);
    return new Promise(res => { pending[id] = res; window.Native.get(id, url, JSON.stringify(headers || {})); });
  }
  // browsers don't allow setting User-Agent; only send headers that need no CORS pre-check
  const h = {};
  if (headers && headers.Accept) h.Accept = headers.Accept;
  return fetch(url, {headers: h}).then(async r => ({status: r.status, body: await r.text()}),
    e => ({status: 0, body: String(e)}));
}
async function getJSON(url, headers) {
  const r = await http(url, headers);
  if (r.status !== 200) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
  return JSON.parse(r.body);
}
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } },
};
function userAgent() {
  const c = (store.get("contact") || "").trim();
  return {"User-Agent": c ? `ELG-Random-Flights-Android/1.0 (+${c})` : "ELG-Random-Flights-Android/1.0"};
}

// ------------------------------------------------------------ math (same rules as the PC app)
const rad = x => x * Math.PI / 180;
function distNM(a, b) {
  const p1 = rad(a[0]), p2 = rad(b[0]), dp = p2 - p1, dl = rad(b[1] - a[1]);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * 3440.065 * Math.asin(Math.sqrt(h)));
}
function bearing(a, b) {
  const p1 = rad(a[0]), p2 = rad(b[0]), dl = rad(b[1] - a[1]);
  const x = Math.sin(dl) * Math.cos(p2), y = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}
const pickOne = a => a[Math.floor(Math.random() * a.length)];
const uniform = (a, b) => a + Math.random() * (b - a);
function weighted(items) { // [[value, weight], ...]
  let x = Math.random() * items.reduce((s, i) => s + i[1], 0);
  for (const [v, w] of items) { x -= w; if (x <= 0) return v; }
  return items.length ? items[items.length - 1][0] : null;
}
function estimateFL(dist, lo, hi, hdg) {
  if (hi >= 200) {
    if (dist < 150) { lo = Math.min(lo, 200); hi = Math.min(hi, 260); }
    else if (dist < 350) { lo = Math.min(lo, 280); hi = Math.min(hi, 340); }
    hi = Math.max(lo, hi);
  }
  const odd = hdg < 180, opts = [];
  if (hi < 180) { for (let fl = lo - lo % 10 + 5; fl <= hi; fl += 10) if (Math.floor((fl - 5) / 10) % 2 === (odd ? 1 : 0)) opts.push(fl); }
  else { for (let fl = lo - lo % 10; fl <= hi; fl += 10) if (Math.floor(fl / 10) % 2 === (odd ? 1 : 0)) opts.push(fl); }
  return opts.length ? pickOne(opts) : lo;
}
const fmtAlt = fl => fl >= 180 ? "FL" + String(fl).padStart(3, "0") : (fl * 100).toLocaleString("en-US") + " ft";
const cruiseSpeed = flMax => flMax >= 300 ? 450 : flMax >= 200 ? 270 : flMax >= 60 ? 150 : 110;
function blockTime(dist, flMax) {
  const m = Math.floor(dist / cruiseSpeed(flMax) * 60 + (flMax >= 200 ? 25 : 10));
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}
const WIDEBODY = ["A30", "A310", "A33", "A34", "A35", "A38", "B74", "B76", "B77", "B78", "MD1", "DC1", "IL9", "L10", "A3S", "B2X"];
const TURBOPROP = ["AT4", "AT7", "DH8", "SF3", "SB2", "JS3", "JS4", "D32", "B19", "C20", "C08", "L41", "F50", "Q4", "AN2", "Y12", "MA6", "BE2", "PC1", "DHC"];
function typeRange(t, cat) {
  if (WIDEBODY.some(p => t.startsWith(p))) return 7800;
  if (TURBOPROP.some(p => t.startsWith(p))) return 1100;
  if (cat === "Regional") return 1900;
  if (["A21N", "A321", "B39M", "B753", "B752"].includes(t)) return 3900;
  return 3200;
}
function typeInfo(t) { // [name, category, seats, flMin, flMax]
  if (D.types[t]) return D.types[t];
  return [t, "Comercial", 0, 300, 390];
}

// ------------------------------------------------------------ names, flags, callsigns
const countryName = cc => D.countries[cc] || cc || "";
const flagEmoji = cc => cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map(c => 127397 + c.charCodeAt(0))) : "";
let RADIO = store.get("radio_cs") || {};
async function loadRadioCallsigns() {
  // Radio callsigns missing from the bundled list come from Wikidata (CC0), refreshed every 30 days.
  if (store.get("radio_cs_at") > Date.now() - 30 * 86400e3) return;
  const q = "SELECT ?icao ?cs ?end WHERE { ?item wdt:P230 ?icao . ?item wdt:P432 ?cs . OPTIONAL { ?item wdt:P576 ?end } }";
  try {
    const j = await getJSON("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q),
      {"Accept": "application/sparql-results+json", "User-Agent": "ELG-Random-Flights-Android/1.0 (flight sim app)"});
    const rows = j.results.bindings.sort((a, b) => ("end" in a) - ("end" in b));
    const out = {};
    for (const r of rows) {
      const icao = r.icao.value.trim().toUpperCase(), cs = r.cs.value.trim().toUpperCase();
      if (icao.length === 3 && cs && !out[icao]) out[icao] = cs;
    }
    RADIO = out; store.set("radio_cs", out); store.set("radio_cs_at", Date.now());
  } catch (e) { /* offline: keep the bundled callsigns */ }
}
function airline(icao) {
  const a = D.airlines[icao];
  if (!a) return null;
  return {icao, name: a[0], callsign: a[1] || RADIO[icao] || "", country: a[2]};
}
function airport(icao) {
  const a = D.airports[icao];
  return a ? {icao, name: a[0], city: a[1], cc: a[2], pos: [a[3], a[4]]} : null;
}

// ------------------------------------------------------------ VRS route files (downloaded per airline)
const routeCache = new Map();
async function routeFile(code, digit) {
  const key = code + "-" + digit;
  if (routeCache.has(key)) return routeCache.get(key);
  const r = await http(`${VRS}routes/schema-01/${code[0]}/${key}.csv`);
  if (r.status !== 200 && r.status !== 404) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
  const rows = [];
  if (r.status === 200) {
    for (const line of r.body.split(/\r?\n/).slice(1)) {
      const c = line.split(",");
      if (c.length < 5) continue;
      const aps = c[4].trim().toUpperCase().split("-").filter(Boolean);
      if (aps.length < 2 || aps.some(a => !D.airports[a])) continue;
      rows.push([c[0].trim().toUpperCase(), c[2].trim(), aps]);
    }
  }
  if (routeCache.size > 40) routeCache.delete(routeCache.keys().next().value);
  routeCache.set(key, rows);
  return rows;
}
function filesOf(code) {
  const spec = D.routes[code] ? D.routes[code][0] : null;
  return !spec ? [] : spec === "a" ? ["all"] : [...spec];
}
async function vrsRoute(cs) {
  const code = cs.slice(0, 3), files = filesOf(code);
  if (!files.length) return null;
  const f = files[0] === "all" ? "all" : cs[3];
  if (!files.includes(f)) return null;
  const row = (await routeFile(code, f)).find(r => r[0] === cs);
  return row ? row[2] : null;
}

// ------------------------------------------------------------ OpenSky live states
let STATES = null, statesAt = 0, statesMsg = "";
async function liveStates(force) {
  if (WEB) return null;
  if (!force && STATES && Date.now() - statesAt < STATES_TTL) return STATES;
  try {
    const j = await getJSON("https://opensky-network.org/api/states/all", userAgent());
    STATES = (j.states || []).filter(s => s[1] && s[1].trim() && !s[8] && s[5] != null && s[6] != null)
      .map(s => ({hex: s[0], cs: s[1].trim().toUpperCase(), pos: [s[6], s[5]], alt: s[7], vrate: s[11]}));
    statesAt = Date.now();
    statesMsg = `${STATES.length.toLocaleString("en-US")} aircraft in the air (OpenSky, ${new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})})`;
  } catch (e) {
    statesMsg = e.status === 429 ? "OpenSky daily limit reached for now: live flights come back later (current routes still work)"
      : "OpenSky not reachable right now: " + e.message;
    if (!STATES) throw new Error(statesMsg);
  }
  if (window.showStatus) window.showStatus();
  return STATES;
}

// ------------------------------------------------------------ aircraft by ICAO 24-bit address
const acCache = new Map();
async function aircraftFor(hex) {
  hex = hex.toUpperCase();
  if (acCache.has(hex)) return acCache.get(hex);
  let ac = null;
  try {
    const j = await getJSON("https://api.adsbdb.com/v0/aircraft/" + hex, userAgent());
    const a = j.response && j.response.aircraft;
    if (a && a.icao_type) ac = {reg: a.registration, type: a.icao_type.toUpperCase(),
      model: [a.manufacturer, a.type].filter(Boolean).join(" "), owner: a.registered_owner,
      op: (a.registered_owner_operator_flag_code || "").toUpperCase()};
  } catch (e) { /* not known there */ }
  if (!ac) {
    try {
      const a = await getJSON("https://hexdb.io/api/v1/aircraft/" + hex, userAgent());
      if (a && a.ICAOTypeCode) ac = {reg: a.Registration, type: a.ICAOTypeCode.toUpperCase(),
        model: [a.Manufacturer, a.Type].filter(Boolean).join(" "), owner: a.RegisteredOwners,
        op: (a.OperatorFlagCode || "").toUpperCase()};
    } catch (e) { /* not known there */ }
  }
  if (!ac) {
    try {
      const r = await http(`${VRS}aircraft/schema-01/${hex[0]}/${hex.slice(0, 2)}/${hex.slice(0, 3)}.csv`);
      const line = r.status === 200 && r.body.split(/\r?\n/).find(l => l.toUpperCase().startsWith(hex + ","));
      if (line) { const c = line.split(","); if (c[2]) ac = {reg: c[1], type: c[2].toUpperCase(), model: c[5], owner: c[7], op: c[8]}; }
    } catch (e) { /* ignore */ }
  }
  if (ac && ac.type === "ZZZZ") ac = null;
  acCache.set(hex, ac);
  return ac;
}

// ------------------------------------------------------------ filters
function legOK(f, d, a, dist) {
  return (!f.dep || d.cc === f.dep) && (!f.arr || a.cc === f.arr) &&
    (f.dmin == null || dist >= f.dmin) && (f.dmax == null || dist <= f.dmax);
}
const typeOK = (f, t) => !f.model || t === f.model;
function airlineMayMatch(code, f) {
  const r = D.routes[code];
  if (!r) return false;
  if (f.airline && code !== f.airline) return false;
  if (f.dep && !r[2].includes(f.dep)) return false;
  if (f.arr && !r[3].includes(f.arr)) return false;
  if (f.category === "Carga" && !CARGO.has(code)) return false;
  if (f.category && ["Executiva", "Aviação geral", "Helicóptero", "Militar"].includes(f.category)) return false;
  if (f.model && !(D.fleet[code] && D.fleet[code][f.model])) return false;
  return true;
}
// country codes are stored as concatenated pairs ("BRUSPT"): check on even positions only
for (const r of Object.values(D.routes)) for (const i of [2, 3]) {
  const s = r[i]; r[i] = {s, includes(cc) { for (let k = 0; k < s.length; k += 2) if (s.substr(k, 2) === cc) return true; return false; }};
}

// ------------------------------------------------------------ source 1: current routes
function typeForRoute(code, dist, f, cargo) {
  const fl = D.fleet[code];
  if (!fl) return null;
  const cands = [];
  for (const [t, e] of Object.entries(fl)) {
    if (f.model && t !== f.model) continue;
    const tcat = typeInfo(t)[1];
    if (!["Comercial", "Regional", "Carga"].includes(tcat)) continue;
    if ((f.category === "Comercial" || f.category === "Regional") && tcat !== f.category) continue;
    const rng = typeRange(t, tcat);
    if (dist > rng) continue;
    let w = e[0] * (dist < 1500 && rng > 7000 ? 0.1 : 1);
    if (cargo && tcat === "Carga") w *= 3;
    cands.push([t, w]);
  }
  return cands.length ? weighted(cands) : null;
}
async function drawCurrent(f) {
  const codes = Object.keys(D.routes).filter(c => airlineMayMatch(c, f));
  if (!codes.length) return null;
  // with a country filter, an airline that flies to many countries has only a share of its routes there
  const share = c => (f.dep ? D.routes[c][2].s.length / 2 : 1) * (f.arr ? D.routes[c][3].s.length / 2 : 1);
  const pool = codes.map(c => [c, D.routes[c][1] / share(c)]);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = weighted(pool), files = filesOf(code);
    const rows = await routeFile(code, pickOne(files));
    const cargo = CARGO.has(code);
    const legs = [];
    for (const [cs, num, aps] of rows) {
      for (let i = 0; i < aps.length - 1; i++) {
        if (aps[i] === aps[i + 1]) continue;
        const d = airport(aps[i]), a = airport(aps[i + 1]);
        if (legOK(f, d, a, distNM(d.pos, a.pos))) legs.push([cs, num, i, aps.length - 1, d, a]);
      }
    }
    for (let tries = 0; tries < 6 && legs.length; tries++) {
      const [cs, num, i, n, d, a] = legs.splice(Math.floor(Math.random() * legs.length), 1)[0];
      const dist = distNM(d.pos, a.pos);
      let t = typeForRoute(code, dist, f, cargo), reg = null, hex = null, regNote = "", live = null;
      // Is this exact flight in the air right now? Then the real aircraft is known.
      live = STATES && STATES.find(s => s.cs === cs);
      if (live) {
        const ac = await aircraftFor(live.hex);
        if (ac && typeOK(f, ac.type)) { t = ac.type; reg = ac.reg; hex = live.hex; regNote = "the aircraft flying this flight right now"; }
      }
      if (!t) continue; // like the PC app: skip flights without an aircraft model
      if (!reg) {
        const regs = (D.fleet[code] && D.fleet[code][t] || []).slice(1);
        if (regs.length) { reg = pickOne(regs); regNote = "likely aircraft from the current fleet"; }
      }
      const [name, tcat, seats, flMin, flMax] = typeInfo(t);
      const cat = cargo ? "Carga" : tcat;
      if (f.category && cat !== f.category) continue;
      return {
        kind: `Real current route (Virtual Radar / adsb.lol)${n > 1 ? `  ·  leg ${i + 1} of ${n}` : ""}`,
        category: cat, callsign: cs, flightNumber: num || cs.slice(3), airline: airline(code), operator: null,
        dep: d, arr: a, dist, type: t, model: name + (live && hex ? "" : " · likely model"),
        fl: estimateFL(dist, flMin, flMax, bearing(d.pos, a.pos)), flMax, flNote: "estimated",
        seats: cargo ? 0 : seats, reg, hex, regNote, live: !!(live && hex),
      };
    }
  }
  return null;
}

// ------------------------------------------------------------ source 2: live flights (OpenSky)
async function routeForLive(s, budget) {
  let aps = null;
  try { aps = await vrsRoute(s.cs); } catch (e) { /* GitHub busy */ }
  if (!aps && budget.adsbdb-- > 0) {
    try {
      const j = await getJSON("https://api.adsbdb.com/v0/callsign/" + s.cs, userAgent());
      const r = j.response && j.response.flightroute;
      if (r && r.origin && r.destination) aps = [r.origin.icao_code, r.destination.icao_code].map(x => (x || "").toUpperCase());
    } catch (e) { /* unknown callsign */ }
  }
  if (!aps || aps.some(a => !D.airports[a])) return null;
  // multi-leg flights: the leg the aircraft is on now (smallest detour through its position)
  let best = null;
  for (let i = 0; i < aps.length - 1; i++) {
    if (aps[i] === aps[i + 1]) continue;
    const d = airport(aps[i]), a = airport(aps[i + 1]), leg = distNM(d.pos, a.pos);
    const detour = distNM(d.pos, s.pos) + distNM(s.pos, a.pos) - leg;
    if (!best || detour < best.detour) best = {d, a, leg, detour, i, n: aps.length - 1};
  }
  // the route database can be outdated: the aircraft must really be near that route
  if (!best || best.detour > Math.max(150, best.leg * 0.25)) return null;
  return best;
}
async function drawLive(f) {
  const states = await liveStates();
  let cands = states.filter(s => {
    const code = s.cs.slice(0, 3);
    if (!/^[A-Z]{3}\d/.test(s.cs)) return false;
    if (D.routes[code]) return airlineMayMatch(code, f);
    return !f.airline && !f.dep && !f.arr && !!D.airlines[code]; // routes via adsbdb
  });
  if (f.airline) cands = cands.filter(s => s.cs.startsWith(f.airline));
  const budget = {adsbdb: 3};
  for (let tries = 0; tries < 10 && cands.length; tries++) {
    const s = cands.splice(Math.floor(Math.random() * cands.length), 1)[0];
    const r = await routeForLive(s, budget);
    if (!r || !legOK(f, r.d, r.a, r.leg)) continue;
    const ac = await aircraftFor(s.hex);
    if (!ac || !typeOK(f, ac.type)) continue;
    const code = s.cs.slice(0, 3), cargo = CARGO.has(code);
    const [name, tcat, seats, flMin, flMax] = typeInfo(ac.type);
    const cat = cargo ? "Carga" : tcat;
    if (f.category && cat !== f.category) continue;
    const altFt = (s.alt || 0) * 3.28084;
    const cruising = altFt > 10000 && Math.abs(s.vrate || 0) < 2.5;
    return {
      kind: `Real flight in the air now (OpenSky ADS-B)${r.n > 1 ? `  ·  leg ${r.i + 1} of ${r.n}` : ""}`,
      category: cat, callsign: s.cs, flightNumber: s.cs.slice(3), airline: airline(code),
      operator: D.airlines[code] ? null : ac.owner, dep: r.d, arr: r.a, dist: r.leg, type: ac.type,
      model: D.types[ac.type] ? name : (ac.model || ac.type), fl: cruising ? Math.round(altFt / 1000) * 10
        : estimateFL(r.leg, flMin, flMax, bearing(r.d.pos, r.a.pos)), flMax,
      flNote: cruising ? "actual (ADS-B)" : "estimated", seats: cargo ? 0 : seats,
      reg: ac.reg || null, hex: s.hex, regNote: "actual aircraft of this flight", live: true,
    };
  }
  return null;
}

// ------------------------------------------------------------ photos (same chain as the PC app)
const compact = t => String(t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function airlineNames(name) {
  const out = [];
  for (let part of String(name || "").split(/\s*[/,(]\s*/).reverse()) {
    part = part.replace(/^[\s)]+|[\s)]+$/g, "");
    if (part.length >= 3 && !out.includes(part)) out.push(part);
  }
  return out;
}
function modelTokens(model, type) {
  const name = model.split(" · ")[0].split(" (")[0];
  let toks = [];
  for (const t of name.split(/[\s/]+/)) {
    const head = t.split("-")[0];
    const m = compact(/\d/.test(head) ? head : t).match(/^[a-z]*\d+/);
    if (m && m[0].length >= 2) toks.push(m[0]);
  }
  toks = toks.slice(0, 1);
  if (toks.length && name.toUpperCase().split(/\s+/).includes("MAX")) toks.push("max");
  return toks.length ? toks : (type && type !== "ZZZZ" ? [type.toLowerCase()] : []);
}
function titleHas(title, t) {
  if (title.includes(t)) return true;
  const digits = t.replace(/^[a-z]+/, "");
  return digits.length >= 3 && digits !== t && title.includes(digits);
}
class PhotoError extends Error {}
async function planespotters(reg, hex) {
  const key = `${hex || ""}|${reg || ""}`.toUpperCase();
  if (key === "|") return null;
  const cache = store.get("ps_cache") || {}, now = Date.now();
  for (const k in cache) if (now - cache[k].at > PHOTO_TTL) delete cache[k];
  if (cache[key]) return cache[key].photo;
  const urls = [];
  if (hex) urls.push("https://api.planespotters.net/pub/photos/hex/" + hex.toUpperCase());
  if (reg) urls.push("https://api.planespotters.net/pub/photos/reg/" + encodeURIComponent(reg));
  let ph = null, err = null;
  for (const u of urls) {
    let photos;
    try { photos = (await getJSON(u, userAgent())).photos || []; }
    catch (e) { err = e.status ? `Planespotters answered ${e.status}` : "no connection to Planespotters"; continue; }
    // the photo must be of the SAME registration (the Planespotters link contains it)
    if (reg) photos = photos.filter(p => compact(p.link).includes(compact(reg)));
    if (photos.length) {
      const p = photos[0];
      ph = {src: (p.thumbnail_large || p.thumbnail || {}).src, photographer: p.photographer, link: p.link, taken: p.date_taken};
      break;
    }
  }
  if (!ph && err) throw new PhotoError(err);
  cache[key] = {at: now, photo: ph};
  store.set("ps_cache", cache);
  return ph && ph.src ? ph : null;
}
async function commonsPhoto(names, loose, model, tokens) {
  if (!(names.length || loose.length) || !tokens.length) return null;
  let queries = [];
  for (const n of (names.length ? names : loose).slice(0, 2)) queries.push(`${n} ${model}`, `${n} ${tokens[0]}`);
  if (loose.length) queries.push(`${loose[0]} ${tokens[0]}`);
  queries = [...new Set(queries)];
  const full = names.map(compact), part = loose.map(compact), looseHits = [];
  for (const q of queries) {
    const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({action: "query", format: "json",
      generator: "search", gsrnamespace: 6, gsrlimit: 20, gsrsearch: q, prop: "imageinfo", iiprop: "url|extmetadata",
      iiurlwidth: 800, iiextmetadatafilter: "Artist|LicenseShortName", origin: "*"});
    let pages;
    try { pages = Object.values(((await getJSON(url, userAgent())).query || {}).pages || {}); } catch (e) { continue; }
    pages.sort((a, b) => (a.index || 99) - (b.index || 99));
    for (const pg of pages) {
      const title = compact(pg.title);
      if (!/(jpg|jpeg|png)$/.test(title) || !tokens.every(t => titleHas(title, t))) continue;
      if (full.some(n => title.includes(n))) { const m = commonsMeta(pg); if (m) return m; }
      if (part.some(w => title.includes(w))) looseHits.push(pg);
    }
  }
  for (const pg of looseHits) { const m = commonsMeta(pg); if (m) return m; }
  return null;
}
function commonsMeta(pg) {
  const ii = (pg.imageinfo || [{}])[0], meta = ii.extmetadata || {};
  const div = document.createElement("div"); div.innerHTML = (meta.Artist || {}).value || "";
  if (!ii.thumburl) return null;
  return {src: ii.thumburl, photographer: (div.textContent.trim() || "?").slice(0, 60),
    license: (meta.LicenseShortName || {}).value || "", link: ii.descriptionurl, kind: "commons"};
}
async function findPhoto(fl) {
  const al = fl.airline;
  const names = al ? airlineNames(al.name) : (fl.operator ? [fl.operator] : []);
  const loose = names.map(n => n.split(" ")[0]).concat(al ? [al.callsign, al.icao] : []).filter(w => w && w.length >= 3);
  const model = fl.model.split(" · ")[0].split(" (")[0];
  const exact = !!(fl.reg || fl.hex);
  let meta = null, err = null;
  if (exact) {
    try { meta = await planespotters(fl.reg, fl.hex); } catch (e) { err = e.message; }
  }
  if (!meta && al && D.fleet[al.icao] && D.fleet[al.icao][fl.type]) {
    // no exact photo: another aircraft of the same airline and model (same livery)
    const others = D.fleet[al.icao][fl.type].slice(1).filter(r => r !== fl.reg);
    for (const reg of others) {
      try { meta = await planespotters(reg, null); } catch (e) { meta = null; }
      if (meta) { meta = Object.assign({}, meta, {kind: "similar", similarReg: reg}); break; }
    }
  }
  if (!meta) {
    try { meta = await commonsPhoto(names, loose, model, modelTokens(fl.model, fl.type)); } catch (e) { meta = null; }
  }
  if (!meta) return {none: true, reason: err || (exact ? "not on Planespotters yet" : "the source does not report the registration")};
  const taken = meta.taken ? ` · photo from ${meta.taken.slice(0, 4)}` : "";
  meta.credit = meta.kind === "commons"
    ? `Illustrative photo (same airline and model, may be another aircraft) · © ${meta.photographer} / Wikimedia Commons, ${meta.license}`
    : meta.kind === "similar"
      ? `Illustrative photo: ${meta.similarReg}, another aircraft of the same airline and model · © ${meta.photographer || "?"} / Planespotters.net${taken}`
      : `© ${meta.photographer || "?"} / Planespotters.net${taken}`;
  return meta;
}

// ------------------------------------------------------------ draw
async function pickFlight(f) {
  const order = WEB || f.source === SRC_CURRENT ? [drawCurrent] : f.source === SRC_LIVE ? [drawLive]
    : (Math.random() < 0.5 ? [drawCurrent, drawLive] : [drawLive, drawCurrent]);
  let lastErr = null;
  for (const fn of order) {
    try { const fl = await fn(f); if (fl) return fl; }
    catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return null;
}

window.ELG = {WEB, D, SOURCES, CAT_EN, countryName, flagEmoji, airline, pickFlight, findPhoto, liveStates, loadRadioCallsigns,
  typeInfo, fmtAlt, blockTime, bearing, http, store, statesInfo: () => ({msg: statesMsg, fresh: STATES && Date.now() - statesAt < STATES_TTL})};
})();
