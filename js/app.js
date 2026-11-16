// ---------------------------------------------------------------------------
// App: Daten laden, Sprache, Ansichten (Tabs), Filter, Suche, Detail-Panel,
// Top 5. Die Grafiken selbst zeichnet js/charts.js.
// ---------------------------------------------------------------------------
(() => {
  const S = window.SITE, I18N = window.I18N;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  // Suche ohne Rücksicht auf Groß-/Kleinschreibung und Akzente (ö findet auch o)
  const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

  const AFD_BLUE = "#009EE0", GREY = "#b4b7bf", ACCENT = "#5f6b2d";
  const PARTY_COLOR = { "AFD": "#009EE0", "CDU/CSU": "#222222", "SPD": "#E3000F", "GRUENE": "#1FAF12", "FDP": "#F5C400", "DIELINKE": "#BE3075" };
  const PARTY_ORDER = ["AFD", "CDU/CSU", "SPD", "GRUENE", "FDP", "DIELINKE"];
  const PIDX = Object.fromEntries(PARTY_ORDER.map((p, i) => [p, i]));
  const textColor = p => p === "FDP" ? "#a17f00" : PARTY_COLOR[p];   // Gelb ist als Schrift zu hell

  // Analysen (Tabs). unit = Start-Einheit; figures = Personen als Piktogramme
  const SECTIONS = [
    { key: "party", mode: "lanes", unit: "speech" },
    { key: "sex", mode: "lanes", unit: "person", figures: true },
    { key: "edu", mode: "lanes", unit: "speech" },
    { key: "age", mode: "scatter", unit: "speech" },
    { key: "gov", mode: "lanes", unit: "speech" }
  ];
  const SEC = Object.fromEntries(SECTIONS.map(s => [s.key, s]));
  const VIEWS = ["overview", ...SECTIONS.map(s => s.key), "top"];

  // Kernergebnisse für die Startseite: vorhergesagte Werte aus dem Regressionsmodell
  // des Blogbeitrags (nicht aus den Rohdaten berechnet).
  const RESULT_SCALE = [2.10, 2.22];
  const RESULTS = [
    { key: "party", rows: [{ l: "party.AFD", v: 2.20, c: AFD_BLUE }, { l: "res.others", v: 2.15, c: GREY }] },
    { key: "gov", rows: [{ l: "gov.0", v: 2.18, c: ACCENT }, { l: "gov.1", v: 2.13, c: GREY }] },
    { key: "sex", rows: [{ l: "sex.0", v: 2.16, c: ACCENT }, { l: "sex.1", v: 2.14, c: GREY }] },
    { key: "age", quali: [["res.q.age", "res.q.up", true], ["res.q.edu", "res.q.none"], ["res.q.mig", "res.q.none"]] }
  ];
  const TOP_N = 5, TOP_MIN_SPEECHES = 10;
  // Längenfilter der Top-5-Reden (Tokens). Kurze Reden haben systematisch höhere Surprisal.
  const TOP_LEN = { gt500: d => d.tok > 500, le500: d => d.tok <= 500, gt1000: d => d.tok > 1000 };

  // ---- Sprache ------------------------------------------------------------------
  const LANGS = ["de", "en"];
  let lang = (() => {
    const q = new URLSearchParams(location.search).get("lang");
    if (LANGS.includes(q)) return q;
    try { const s = localStorage.getItem("lang"); if (LANGS.includes(s)) return s; } catch (e) { /* Speicher gesperrt */ }
    return (navigator.language || "de").toLowerCase().startsWith("de") ? "de" : "en";
  })();
  let F;   // Zahlen- und Datumsformate der aktiven Sprache
  const t = (k, v) => {
    let s = I18N[lang][k]; if (s == null) s = I18N.de[k] ?? k;
    return v ? s.replace(/\{(\w+)\}/g, (m, n) => v[n] ?? m) : s;
  };
  const partyLabel = p => t("party." + p);
  function makeFormats() {
    const loc = lang === "de" ? "de-DE" : "en-GB";
    const nf = d => new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
    const dt = o => iso => new Date(iso + "T12:00:00").toLocaleDateString(loc, o);
    F = { loc, f0: new Intl.NumberFormat(loc), f1: nf(1), f2: nf(2),
      date: dt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }),
      dateShort: dt({ day: "2-digit", month: "2-digit", year: "numeric" }) };
  }

  // ---- State ---------------------------------------------------------------------
  const state = { parties: new Set(PARTY_ORDER), y0: 0, y1: 9999, hlAfd: false };
  const topState = { unit: "person", len: "gt500" };
  let rows = [], ymin = 2017, ymax = 2025, demo = false, domain = {}, fcache = null;
  const charts = {}, units = {}, stale = new Set();
  const selected = {};   // angeklickter Punkt je Analyse
  const focus = {};      // per Suche hervorgehobene Person (spk) je Analyse
  const detail = {};     // im Detail-Panel gezeigter Datensatz je Analyse
  const people = {};     // suchbare Personen je Analyse (im aktuellen Filter)
  const sortedBy = {};   // sortierte Surprisal-Werte je Analyse (für Perzentile)
  SECTIONS.forEach(s => units[s.key] = s.unit);

  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  async function loadData() {
    let j;
    try {
      const r = await fetch(S.dataUrl, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      j = await r.json();
    } catch (e) {
      const r = await fetch(S.demoUrl);
      if (!r.ok) throw new Error(S.dataUrl + " / " + S.demoUrl);
      j = await r.json();
    }
    demo = !!(j.meta && j.meta.demo);
    const rng = mulberry32(42), seq = {};
    const spk = j.speakers.map(([name, sex, edu, mig]) => ({ name, sex: sex < 0 ? null : sex, edu: edu > 0 ? edu : null, mig: mig < 0 ? null : mig }));
    rows = j.rows.map((r, i) => {
      const sp = spk[r[1]];
      // ti = Position der Rede in der Textdatei ihrer Person (data/texts/<spk>.json)
      return { id: i, ti: seq[r[1]] = (seq[r[1]] ?? -1) + 1, date: r[0], year: +r[0].slice(0, 4), spk: r[1], name: sp.name, party: j.parties[r[2]], s: r[3], age: r[4] >= 0 ? r[4] : null,
        gov: r[5], tok: r[6], sex: sp.sex, edu: sp.edu, mig: sp.mig, r: rng(), n: 1, person: false };
    }).filter(d => d.party in PIDX);
    // Feste Reihenfolge: nach Fraktion, darin zufällig. So bilden die Fraktionen in
    // jedem Stapel zusammenhängende Farbbänder.
    rows.sort((a, b) => PIDX[a.party] - PIDX[b.party] || a.r - b.r);
    ymin = d3.min(rows, d => d.year); ymax = d3.max(rows, d => d.year);
    state.y0 = ymin; state.y1 = ymax;
    // Feste Skalen für Reden und für Personen-Durchschnitte: Die mittleren 99,5 bzw. 99 %
    // liegen im linearen Teil, die Extremwerte (Anteil q je Seite) staucht die Grafik am
    // Rand. Stützstellen dort bei q/4 und q/2, damit sich die Ausreißer verteilen.
    const scaleOf = (list, q) => {
      const ss = list.map(d => d.s).sort(d3.ascending), qs = [0, q / 4, q / 2, q];
      return { v: [...qs.map(p => d3.quantile(ss, p)), ...qs.map(p => d3.quantile(ss, 1 - p)).reverse()], k: qs.length - 1 };
    };
    domain = { speech: scaleOf(rows, 0.0025), person: scaleOf(toPersons(rows), 0.005) };
  }

  const activeParties = () => PARTY_ORDER.filter(p => state.parties.has(p));
  function filtered() {
    if (!fcache) fcache = rows.filter(d => state.parties.has(d.party) && d.year >= state.y0 && d.year <= state.y1);
    return fcache;
  }
  // mode: "spk" = genau eine Zeile pro Person (für Geschlecht, Bildung, Alter);
  //       "party" = je Person und Fraktion; "gov" = je Person und Regierungsstatus
  function toPersons(list, mode = "spk") {
    const m = new Map();
    const most = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];
    for (const d of list) {
      const k = mode === "party" ? d.spk + "|" + d.party : mode === "gov" ? d.spk + "|" + d.gov : String(d.spk);
      let g = m.get(k);
      if (!g) { g = { id: "p" + k, spk: d.spk, name: d.name, sex: d.sex, edu: d.edu, mig: d.mig, r: d.r, ss: 0, aa: 0, an: 0, tt: 0, n: 0, d0: d.date, d1: d.date, person: true, pc: {}, gc: {} }; m.set(k, g); }
      g.ss += d.s; g.tt += d.tok; g.n++; if (d.age != null) { g.aa += d.age; g.an++; }
      g.pc[d.party] = (g.pc[d.party] || 0) + 1; g.gc[d.gov] = (g.gc[d.gov] || 0) + 1;
      if (d.date < g.d0) g.d0 = d.date; if (d.date > g.d1) g.d1 = d.date;
    }
    return [...m.values()].map(g => {
      const { pc, gc, ss, aa, an, tt, ...rest } = g;
      return { ...rest, party: most(pc), gov: +most(gc), s: ss / g.n, tok: tt / g.n, age: an ? Math.round(aa / an * 10) / 10 : null };
    });
  }

  const colorOf = d => state.hlAfd ? (d.party === "AFD" ? AFD_BLUE : GREY) : PARTY_COLOR[d.party];

  // ---- Kern: Daten je Grafik bauen -------------------------------------------------
  function buildChart(sec) {
    const key = sec.key, unit = units[key];
    let list = filtered();
    if (key === "sex") list = list.filter(d => d.sex != null);
    if (key === "edu") list = list.filter(d => d.edu);
    if (key === "age") list = list.filter(d => d.age != null);

    // Personen für die Suche (alle, die in dieser Grafik vorkommen)
    const seen = new Map();
    for (const d of list) if (!seen.has(d.spk)) seen.set(d.spk, { spk: d.spk, name: d.name, party: d.party, norm: norm(d.name) });
    people[key] = [...seen.values()];

    if (unit === "person") list = toPersons(list, key === "party" ? "party" : key === "gov" ? "gov" : "spk");
    // Streudiagramm: zufällige Zeichenreihenfolge, damit keine Fraktion die anderen überdeckt
    if (sec.mode === "scatter") list = [...list].sort((a, b) => a.r - b.r);
    else if (unit === "person") list.sort((a, b) => PIDX[a.party] - PIDX[b.party] || a.r - b.r);
    sortedBy[key] = list.map(d => d.s).sort((a, b) => a - b);

    const data = {
      mode: sec.mode, recs: list, color: colorOf, domain: domain[unit], locale: F.loc,
      txt: { unit: t("n." + unit), avg: t("avg"), axisLow: t("axis.low"), axisHigh: t("axis.high"), axisLowShort: t("axis.lowShort"),
        axisHighShort: t("axis.highShort"), axisAge: t("axis.age"), empty: t("chart.empty") }
    };
    if (sec.mode === "scatter") {
      const ages = list.map(d => d.age);
      data.xdomain = ages.length ? [Math.floor(d3.min(ages) / 5) * 5 - 1, Math.ceil(d3.max(ages) / 5) * 5 + 1] : [25, 85];
      // Alter liegt je Rede nur in ganzen Jahren vor -> innerhalb des Jahres streuen
      data.xOf = d => d.person ? d.age : d.age + ((d.r * 7919) % 1 - 0.5) * 0.8;
      data.groups = state.hlAfd
        ? [{ color: AFD_BLUE, test: d => d.party === "AFD" }, { color: "#6b6f7a", test: d => d.party !== "AFD" }]
        : activeParties().map(p => ({ color: PARTY_COLOR[p], test: d => d.party === p }));
    } else {
      let lanes, laneOf;
      if (key === "party") {
        lanes = activeParties().map(p => ({ key: p, label: partyLabel(p), color: state.hlAfd && p !== "AFD" ? null : textColor(p) }));
        laneOf = d => d.party;
      } else if (key === "sex") { lanes = [0, 1].map(k => ({ key: k, label: t("sex." + k) })); laneOf = d => d.sex; }
      else if (key === "edu") { lanes = [3, 2, 1].map(k => ({ key: k, label: t("edu." + k) })); laneOf = d => d.edu; }
      else { lanes = [0, 1].map(k => ({ key: k, label: t("gov." + k) })); laneOf = d => d.gov; }
      const laneStats = {};
      for (const l of lanes) {
        const v = list.filter(d => laneOf(d) === l.key);
        laneStats[l.key] = { n: v.length, mean: mean(v.map(d => d.s)) };
      }
      // Figuren (Geschlecht), sobald genau eine Fraktion gewählt ist – bei allen wären es zu viele
      Object.assign(data, { lanes, laneOf, laneStats, figures: !!sec.figures && unit === "person" && activeParties().length === 1 });
    }
    return data;
  }

  function legendHtml(key) {
    const items = state.hlAfd ? [{ c: AFD_BLUE, l: partyLabel("AFD") }, { c: GREY, l: t("legend.others") }]
      : key === "party" ? [] : activeParties().map(p => ({ c: PARTY_COLOR[p], l: partyLabel(p) }));
    const extra = SEC[key].mode === "scatter" ? `<span><i class="line"></i>${esc(t("legend.trend"))}</span>` : `<span><i class="dash"></i>${esc(t("legend.mean"))}</span>`;
    return items.map(l => `<span><i style="background:${l.c}"></i>${esc(l.l)}</span>`).join("") + extra;
  }

  // Eine Analyse neu aufbauen und zeichnen
  function update(key) {
    const sec = SEC[key], el = $(`#view-${key}`), ch = charts[key];
    const data = buildChart(sec);
    stale.delete(key);
    if (focus[key] != null && !people[key].some(p => p.spk === focus[key])) clearFocus(key);
    if (selected[key]) selected[key] = data.recs.find(d => d.id === selected[key].id) || null;
    ch.selId = selected[key] ? selected[key].id : null;
    ch.hl = focus[key] ?? null;
    ch.setData(data);
    // Detail-Panel folgt Filter, Einheit und Sprache: Auswahl bzw. gesuchte Person neu aufbauen
    if (selected[key]) showDetail(key, selected[key]);
    else if (focus[key] != null) showDetail(key, personOf(focus[key]));
    else hideDetail(key);
    $$(".seg.useg button", el).forEach(b => b.classList.toggle("on", b.dataset.unit === units[key]));
    $(".legend", el).innerHTML = legendHtml(key);
  }

  // Einleitungssatz passend zu dem, was die Grafik tatsächlich zeichnet
  function setLede(key, figures) {
    const what = units[key] === "speech" ? "speech" : figures ? "figure" : "person";
    $(`#view-${key} .lede`).textContent = t("lede." + what) + " " + t("lede." + SEC[key].mode);
  }

  // ---- Detail-Panel ----------------------------------------------------------------------
  const personOf = spk => toPersons(filtered().filter(d => d.spk === spk))[0];
  function tipHtml(d) {
    const sub = d.person ? `${F.f0.format(d.n)} ${t("n.speech")} · Ø ${F.f2.format(d.s)}` : `${F.dateShort(d.date)} · ${F.f2.format(d.s)}`;
    return `<b>${esc(d.name)}</b><br><span style="color:${PARTY_COLOR[d.party]}">●</span> ${esc(partyLabel(d.party))} · ${sub}`;
  }
  // Initialen im Kreis, Rahmen in Parteifarbe
  function avatarHtml(d) {
    const initials = d.name.split(/\s+/).filter(Boolean).slice(-2).map(x => x[0]).join("").toUpperCase();
    return `<div class="avatar" style="--c:${PARTY_COLOR[d.party]}">${esc(initials)}</div>`;
  }
  function showDetail(key, d) {
    if (!d) return hideDetail(key);
    detail[key] = d;
    const el = $(`#view-${key} .detail`), ss = sortedBy[key] || [], unit = units[key];
    // „höher als 100 %“ wäre für den Höchstwert falsch -> bei 99 deckeln
    const pct = ss.length ? Math.min(99, Math.round(d3.bisectLeft(ss, d.s) / ss.length * 100)) : null;
    const col = PARTY_COLOR[d.party];
    const row = (k, v) => `<div><dt>${esc(t(k))}</dt><dd>${v}</dd></div>`;
    const na = t("d.na");
    el.querySelector(".detail-body").innerHTML = `
      <div class="d-head">${avatarHtml(d)}
        <div><div class="d-name">${esc(d.name)}</div><span class="chip-party" style="--c:${col}">${esc(partyLabel(d.party))}</span></div></div>
      <div class="d-score"><span class="d-big">${F.f2.format(d.s)}</span>
        <span class="d-sub">${esc(t(d.person ? "d.avg" : "d.surprisal"))}${pct != null ? " · " + esc(t("d.pct", { p: pct, u: t("n." + unit) })) : ""}</span>
        <div class="d-bar"><i style="left:${pct ?? 50}%;background:${col}"></i></div></div>
      <dl>
        ${d.person ? row("d.speeches", F.f0.format(d.n)) + row("d.period", d.d0 === d.d1 ? F.dateShort(d.d0) : F.dateShort(d.d0) + " – " + F.dateShort(d.d1))
          : row("d.date", F.date(d.date))}
        ${row("d.sex", d.sex == null ? na : esc(t("sex.one." + d.sex)))}
        ${row(d.person ? "d.ageAvg" : "d.age", d.age == null ? na : esc(t("d.years", { a: d.person ? F.f1.format(d.age) : d.age })))}
        ${row("d.edu", d.edu ? esc(t("edu." + d.edu)) : na)}
        ${row("d.mig", d.mig == null ? na : esc(t(d.mig ? "d.yes" : "d.no")))}
        ${row("d.role", esc(t("role." + d.gov)))}
        ${d.person ? "" : row("d.len", esc(t("d.tokens", { n: F.f0.format(d.tok) })))}
      </dl>
      ${focus[key] === d.spk ? "" : `<button type="button" class="link d-hl" data-spk="${d.spk}">${esc(t("d.hl"))}</button>`}
      <div class="d-text"></div>`;
    fillSpeeches(el.querySelector(".d-text"), d, true);
    el.classList.add("has-data", "open");
  }
  function hideDetail(key) {
    detail[key] = null;
    $(`#view-${key} .detail`).classList.remove("has-data", "open");
  }

  // ---- Redetexte (eine Datei je Person, erst bei Bedarf geladen) ---------------------------
  const textCache = {};
  function loadTexts(spk) {
    if (!textCache[spk]) {
      textCache[spk] = fetch(`${S.textUrl}/${spk}.json`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
      textCache[spk].catch(() => { delete textCache[spk]; });   // beim nächsten Klick neu versuchen
    }
    return textCache[spk];
  }
  function fillText(p, d) {
    p.textContent = t("text.loading");
    loadTexts(d.spk).then(a => { p.textContent = a[d.ti] || t("text.na"); p.classList.toggle("muted", !a[d.ti]); }, () => { p.textContent = t("text.na"); });
  }
  // d = Rede: ihr Text. d = Person: alle ihre Reden im Filter zum Aufklappen
  // (der Text einer Rede wird erst beim Aufklappen eingesetzt).
  function fillSpeeches(host, d, heading) {
    const list = d.person ? filtered().filter(x => x.spk === d.spk).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.ti - b.ti) : [d];
    const h = heading ? `<h4>${esc(d.person ? t("text.many", { n: F.f0.format(list.length) }) : t("text.one"))}</h4>` : "";
    if (!d.person) { host.innerHTML = h + `<p class="sp-text muted" lang="de"></p>`; return fillText(host.lastChild, d); }
    host.innerHTML = h + `<div class="sp-list">` + list.map((x, i) => `<details data-i="${i}"><summary><span>${F.dateShort(x.date)}</span><span>${esc(t("d.tokens", { n: F.f0.format(x.tok) }))}</span><b>${F.f2.format(x.s)}</b></summary><p class="sp-text muted" lang="de"></p></details>`).join("") + `</div>`;
    // toggle steigt nicht auf -> in der Capture-Phase abfangen
    host.querySelector(".sp-list").addEventListener("toggle", e => {
      const p = e.target.lastChild;
      if (e.target.open && !p.dataset.done) { p.dataset.done = 1; fillText(p, list[+e.target.dataset.i]); }
    }, true);
  }

  // ---- Suche: Person im Plot hervorheben ------------------------------------------------
  function setFocus(key, spk) {
    focus[key] = spk;
    selected[key] = null; charts[key].select(null);
    charts[key].setHighlight(spk);
    if (spk == null) hideDetail(key); else showDetail(key, personOf(spk));
  }
  function clearFocus(key) {
    focus[key] = null;
    const box = $(`#view-${key} .search`);
    $("input", box).value = ""; $(".clr", box).hidden = true;
    charts[key].hl = null;
  }
  function setupSearch(key, el) {
    const box = $(".search", el), inp = $("input", box), list = $(".sugg", box), clr = $(".clr", box);
    let items = [], act = -1;
    const mark = () => $$("li[data-i]", list).forEach((li, i) => li.classList.toggle("act", i === act));
    const close = () => { list.hidden = true; act = -1; inp.setAttribute("aria-expanded", "false"); };
    const open = () => {
      const q = norm(inp.value.trim());
      clr.hidden = !inp.value;
      if (!q) return close();
      const rank = p => p.norm.startsWith(q) ? 0 : p.norm.includes(" " + q) ? 1 : 2;
      items = (people[key] || []).filter(p => p.norm.includes(q))
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "de")).slice(0, 8);
      list.innerHTML = items.length
        ? items.map((p, i) => `<li role="option" data-i="${i}"><i style="background:${PARTY_COLOR[p.party]}"></i><span>${esc(p.name)}</span><small>${esc(partyLabel(p.party))}</small></li>`).join("")
        : `<li class="none">${esc(t("search.none"))}</li>`;
      act = items.length ? 0 : -1; mark();
      list.hidden = false; inp.setAttribute("aria-expanded", "true");
    };
    const choose = p => { inp.value = p.name; clr.hidden = false; close(); inp.blur(); setFocus(key, p.spk); };
    inp.addEventListener("input", () => { if (focus[key] != null) setFocus(key, null); open(); });
    inp.addEventListener("focus", () => { if (focus[key] == null) open(); });
    inp.addEventListener("blur", () => setTimeout(close, 150));
    inp.addEventListener("keydown", e => {
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && items.length && !list.hidden) {
        e.preventDefault(); act = (act + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; mark();
      } else if (e.key === "Enter" && !list.hidden && items[act]) { e.preventDefault(); choose(items[act]); }
      else if (e.key === "Escape") close();
    });
    // pointerdown statt click: sonst schließt das blur-Ereignis die Liste vor dem Klick
    list.addEventListener("pointerdown", e => {
      const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); choose(items[+li.dataset.i]); }
    });
    clr.addEventListener("click", () => { inp.value = ""; clr.hidden = true; close(); setFocus(key, null); inp.focus(); });
    // Knopf im Detail-Panel: alle Reden der gezeigten Person hervorheben
    $(".detail", el).addEventListener("click", e => {
      const b = e.target.closest(".d-hl"); if (!b) return;
      const p = (people[key] || []).find(p => p.spk === +b.dataset.spk);
      if (p) { inp.value = p.name; clr.hidden = false; setFocus(key, p.spk); }
    });
  }

  // ---- UI-Aufbau -------------------------------------------------------------------------
  function buildSections() {
    $("#sections").innerHTML = SECTIONS.map(s => `
    <section class="view" id="view-${s.key}" data-view="${s.key}" hidden>
      <header class="vhead">
        <div><h2 data-i18n="sec.${s.key}.title"></h2><p class="lede"></p></div>
        <p class="vstats" aria-live="polite"></p>
      </header>
      <div class="card">
        <div class="tools">
          <div class="seg useg" role="group" data-i18n-aria="unit.aria">
            <button type="button" data-unit="speech" data-i18n="unit.speech"></button>
            <button type="button" data-unit="person" data-i18n="unit.person"></button>
          </div>
          <div class="search">
            <input type="text" inputmode="search" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" data-i18n-ph="search.ph" data-i18n-aria="search.ph">
            <button type="button" class="clr" data-i18n-aria="search.clear" hidden>×</button>
            <ul class="sugg" role="listbox" hidden></ul>
          </div>
          <div class="legend"></div>
        </div>
        <div class="grid">
          <div class="chart-wrap"><canvas class="base" role="img" data-i18n-aria="sec.${s.key}.title"></canvas><canvas class="over"></canvas><div class="tip" hidden></div></div>
          <aside class="detail" aria-live="polite">
            <button type="button" class="close" data-i18n-aria="d.close">×</button>
            <div class="empty" data-i18n="d.empty"></div>
            <div class="detail-body"></div>
          </aside>
        </div>
      </div>
      <div class="below">
        ${S.showFindings === false ? "" : `<p class="finding"><b data-i18n="finding.k"></b> <span data-i18n="sec.${s.key}.finding"></span></p>`}
        <p class="desc-note" data-i18n="info.desc"></p>
        <details class="varinfo"><summary data-i18n="info.k"></summary><p><span data-i18n="sec.${s.key}.info"></span> <span data-i18n="info.common"></span></p></details>
      </div>
    </section>`).join("");

    SECTIONS.forEach(sec => {
      const key = sec.key, el = $(`#view-${key}`);
      charts[key] = new Chart(el, { tipHtml, onSelect: d => { selected[key] = d; showDetail(key, d); }, onRender: ch => setLede(key, ch.geo.fig) });
      $$(".seg.useg button", el).forEach(b => b.addEventListener("click", () => {
        if (units[key] === b.dataset.unit) return;
        // Punkte der einen Einheit gibt es in der anderen nicht -> Auswahl verwerfen
        units[key] = b.dataset.unit; selected[key] = null; update(key);
      }));
      $(".close", el).addEventListener("click", () => $(".detail", el).classList.remove("open"));
      setupSearch(key, el);
    });
  }

  function buildFilters() {
    $("#chips").innerHTML = PARTY_ORDER.map(p => `<button type="button" class="chip on" data-p="${p}" style="--c:${PARTY_COLOR[p]}"><i></i><span data-i18n="party.${p}"></span></button>`).join("");
    const yrs = d3.range(ymin, ymax + 1), opt = sel => yrs.map(y => `<option ${y === sel ? "selected" : ""}>${y}</option>`).join("");
    $("#y0").innerHTML = opt(state.y0); $("#y1").innerHTML = opt(state.y1);

    $$("#chips .chip").forEach(b => b.addEventListener("click", () => {
      const p = b.dataset.p;
      if (!state.parties.has(p)) state.parties.add(p); else if (state.parties.size > 1) state.parties.delete(p);
      changed();
    }));
    $("#allP").addEventListener("click", () => { state.parties = new Set(PARTY_ORDER); changed(); });
    $("#onlyAfd").addEventListener("click", () => { state.parties = new Set(["AFD"]); changed(); });
    const setYears = e => {
      let a = +$("#y0").value, b = +$("#y1").value;
      if (a > b) { if (e.target.id === "y0") b = a; else a = b; }
      state.y0 = a; state.y1 = b; changed();
    };
    $("#y0").addEventListener("change", setYears); $("#y1").addEventListener("change", setYears);
    $("#hlAfd").addEventListener("change", e => { state.hlAfd = e.target.checked; changed(); });
    $("#reset").addEventListener("click", () => {
      Object.assign(state, { parties: new Set(PARTY_ORDER), y0: ymin, y1: ymax, hlAfd: false }); changed();
    });
    $("#ftoggle").addEventListener("click", () => {
      const o = $("#filterbar").classList.toggle("open"); $("#ftoggle").setAttribute("aria-expanded", o); setHdr();
    });
  }
  function syncFilters() {
    $$("#chips .chip").forEach(b => { const on = state.parties.has(b.dataset.p); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    $("#y0").value = state.y0; $("#y1").value = state.y1; $("#hlAfd").checked = state.hlAfd;
    const act = activeParties();
    const span = state.y0 === state.y1 ? String(state.y0) : `${state.y0}–${state.y1}`;
    $("#fsum").textContent = `${act.length === PARTY_ORDER.length ? t("f.allParties") : act.map(partyLabel).join(", ")} · ${span}`;
    const list = filtered();
    const stats = list.length
      ? t("f.stats", { n: F.f0.format(list.length), p: F.f0.format(new Set(list.map(d => d.spk)).size), s: F.f2.format(mean(list.map(d => d.s))) })
      : t("f.empty");
    $$(".vstats").forEach(el => { el.textContent = stats; });
  }
  // Filter geändert: alles als veraltet markieren, nur die sichtbare Ansicht neu rechnen
  function changed() {
    fcache = null;
    SECTIONS.forEach(s => stale.add(s.key));
    syncFilters();
    const v = currentView();
    if (SEC[v]) update(v); else if (v === "top") renderTop();
  }

  // ---- Ansichten (Tabs über den Hash) -----------------------------------------------------
  const currentView = () => { const h = location.hash.slice(1); return VIEWS.includes(h) ? h : "overview"; };
  function buildNav() {
    $("#nav").innerHTML = VIEWS.map(v => `<a href="#${v}" data-v="${v}" data-i18n="nav.${v}"></a>`).join("");
  }
  function showView() {
    const v = currentView();
    $$(".view").forEach(el => { el.hidden = el.dataset.view !== v; });
    $$("#nav a").forEach(a => {
      const on = a.dataset.v === v; a.classList.toggle("active", on);
      if (on) { a.setAttribute("aria-current", "page"); a.scrollIntoView({ block: "nearest", inline: "center" }); } else a.removeAttribute("aria-current");
    });
    $("#filterbar").hidden = v === "overview";
    setHdr();
    for (const k in charts) charts[k].setVisible(false);
    if (SEC[v]) { if (stale.has(v)) update(v); charts[v].setVisible(true); }
    if (v === "top") renderTop();
    window.scrollTo(0, 0);
  }
  function setHdr() {
    const f = $("#filterbar");
    document.documentElement.style.setProperty("--hdr", ($(".topbar").offsetHeight + (f.hidden ? 0 : f.offsetHeight)) + "px");
  }

  // ---- Startseite: Ergebnis-Boxen, Autoren, Blog-Link ---------------------------------------
  function renderResults() {
    const pos = v => (v - RESULT_SCALE[0]) / (RESULT_SCALE[1] - RESULT_SCALE[0]) * 100;
    $("#results").innerHTML = RESULTS.map(r => {
      let body;
      if (r.rows) {
        const [a, b] = r.rows, lo = Math.min(pos(a.v), pos(b.v)), hi = Math.max(pos(a.v), pos(b.v));
        body = r.rows.map(x => `<div class="res-row"><i style="background:${x.c}"></i><span>${esc(t(x.l))}</span><b>${F.f2.format(x.v)}</b></div>`).join("") +
          `<div class="dumb" aria-hidden="true"><span style="left:${lo}%;width:${hi - lo}%"></span>${r.rows.map(x => `<i style="left:${pos(x.v)}%;background:${x.c}"></i>`).join("")}
            <small>${F.f2.format(RESULT_SCALE[0])}</small><small>${F.f2.format(RESULT_SCALE[1])}</small></div>`;
      } else {
        body = r.quali.map(([l, v, up]) => `<div class="res-row q"><span>${esc(t(l))}</span><b class="${up ? "up" : ""}">${esc(t(v))}</b></div>`).join("");
      }
      return `<a class="res" href="#${r.key}">
        <div class="res-k">${esc(t(`res.${r.key}.k`))}</div>
        <div class="res-body">${body}</div>
        <p>${esc(t(`res.${r.key}.t`))}</p>
        <span class="res-more">${esc(t("res.more"))} <span aria-hidden="true">→</span></span>
      </a>`;
    }).join("");
  }
  function renderTeam() {
    $("#team").innerHTML = S.team.map(m => `
      <a class="member" href="${esc(m.linkedin)}" target="_blank" rel="noopener" title="${esc(t("team.on", { name: m.name }))}">
        <span class="ph" data-ini="${esc(m.name.split(" ").map(x => x[0]).join(""))}">${m.photo ? `<img alt="" src="${esc(m.photo)}">` : ""}</span>
        <span class="mn">${esc(m.name)}<small>LinkedIn ↗</small></span>
      </a>`).join("");
    // ohne Foto bleiben die Initialen stehen
    $$("#team img").forEach(img => img.addEventListener("error", () => img.remove()));
  }
  function renderBlogLinks() {
    const url = (S.blogUrl && (S.blogUrl[lang] || S.blogUrl.de)) || "#", placeholder = url === "#";
    $$(".bloglink").forEach(a => {
      a.href = url;
      if (placeholder) { a.title = t("blog.soon"); a.removeAttribute("target"); a.removeAttribute("rel"); }
      else { a.removeAttribute("title"); a.target = "_blank"; a.rel = "noopener"; }
      a.onclick = placeholder ? e => e.preventDefault() : null;
    });
  }
  function renderFacts() {
    $("#f-n").textContent = F.f0.format(rows.length);
    $("#f-spk").textContent = F.f0.format(new Set(rows.map(d => d.spk)).size);
  }

  // ---- Top 5 -------------------------------------------------------------------------------
  let topItems = new Map();   // angezeigte Einträge nach id
  function renderTop() {
    const person = topState.unit === "person";
    let list = filtered();
    if (person) list = toPersons(list).filter(d => d.n >= TOP_MIN_SPEECHES);
    else list = list.filter(TOP_LEN[topState.len]);
    const sorted = [...list].sort((a, b) => a.s - b.s);
    const item = (d, i) => `
      <li>
        <div class="tp-row" role="button" tabindex="0" aria-expanded="false" data-id="${d.id}" data-spk="${d.spk}">
        <span class="rk">${i + 1}</span>
        ${avatarHtml(d)}
        <div class="tp-main">
          <div class="tp-name">${esc(d.name)} <span class="chip-party" style="--c:${PARTY_COLOR[d.party]}">${esc(partyLabel(d.party))}</span></div>
          <div class="tp-meta">${person ? `${F.f0.format(d.n)} ${esc(t("n.speech"))}`
            : `${F.dateShort(d.date)} · ${esc(t("d.tokens", { n: F.f0.format(d.tok) }))}`} · ${esc(t("role." + d.gov))}</div>
        </div>
        <b class="tp-val">${F.f2.format(d.s)}</b>
        <button type="button" class="tp-show" data-id="${d.id}" data-spk="${d.spk}" title="${esc(t("top.show"))}" aria-label="${esc(t("top.show"))}">→</button>
        </div>
        <div class="tp-body" hidden></div>
      </li>`;
    const fill = (sel, items) => { $(sel).innerHTML = items.length ? items.map(item).join("") : `<li class="none">${esc(t("top.none"))}</li>`; };
    topItems = new Map(sorted.slice(0, TOP_N).concat(sorted.slice(-TOP_N)).map(d => [String(d.id), d]));
    fill("#topLow", sorted.slice(0, TOP_N));
    fill("#topHigh", sorted.slice(-TOP_N).reverse());
    $$("#topUnit button").forEach(b => b.classList.toggle("on", b.dataset.unit === topState.unit));
    $("#topMinWrap").hidden = person;
    $("#topMin").innerHTML = Object.keys(TOP_LEN).map(k => `<option value="${k}" ${k === topState.len ? "selected" : ""}>${esc(t("top.len." + k))}</option>`).join("");
    $("#topNote").textContent = person ? t("top.personNote", { n: TOP_MIN_SPEECHES }) : t("top.lenNote");
  }
  function setupTop() {
    $$("#topUnit button").forEach(b => b.addEventListener("click", () => { topState.unit = b.dataset.unit; renderTop(); }));
    $("#topMin").addEventListener("change", e => { topState.len = e.target.value; renderTop(); });
    // „Im Plot zeigen“: zur Fraktions-Grafik springen und Rede bzw. Person markieren
    // Klick auf einen Eintrag: Rede (bzw. alle Reden der Person) darunter aufklappen
    const toggle = row => {
      const body = row.nextElementSibling, open = body.hidden;
      body.hidden = !open; row.setAttribute("aria-expanded", open);
      if (open && !body.dataset.done) { body.dataset.done = 1; fillSpeeches(body, topItems.get(row.dataset.id)); }
    };
    $("#view-top").addEventListener("keydown", e => {
      if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("tp-row")) { e.preventDefault(); toggle(e.target); }
    });
    $("#view-top").addEventListener("click", e => {
      const row = e.target.closest(".tp-row");
      if (row && !e.target.closest(".tp-show, a")) return toggle(row);   // Foto-Link klappt nicht auf
      const b = e.target.closest(".tp-show"); if (!b) return;
      const key = "party", spk = +b.dataset.spk;
      units[key] = topState.unit; stale.add(key);
      clearFocus(key); selected[key] = null;
      if (topState.unit === "person") {
        focus[key] = spk;
        $(`#view-${key} .search input`).value = rows.find(d => d.spk === spk).name;
        $(`#view-${key} .search .clr`).hidden = false;
      } else selected[key] = rows.find(d => d.id === +b.dataset.id);
      location.hash = "#" + key;
    });
  }

  // ---- Sprache anwenden ----------------------------------------------------------------------
  function applyLang() {
    makeFormats();
    document.documentElement.lang = lang;
    document.title = t("doc.title");
    $('meta[name="description"]').content = t("doc.desc");
    $$("[data-i18n]").forEach(el => { el.innerHTML = t(el.dataset.i18n); });
    $$("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    $$("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    $$(".lang button").forEach(b => { const on = b.dataset.lang === lang; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    renderBlogLinks();
  }
  function setLang(l) {
    if (l === lang) return;
    lang = l;
    try { localStorage.setItem("lang", l); } catch (e) { /* Speicher gesperrt */ }
    applyLang(); renderFacts(); renderResults(); renderTeam(); syncFilters();
    SECTIONS.forEach(s => stale.add(s.key));
    // nicht sichtbare Analysen: Detail-Panel jetzt übersetzen, die Grafik folgt beim Öffnen
    const v = currentView();
    for (const s of SECTIONS) if (s.key !== v && detail[s.key]) showDetail(s.key, detail[s.key]);
    if (SEC[v]) update(v); else if (v === "top") renderTop();
    setHdr();
  }

  // ---- Start --------------------------------------------------------------------------------
  (async function init() {
    buildNav(); buildSections(); applyLang();
    $$(".lang button").forEach(b => b.addEventListener("click", () => setLang(b.dataset.lang)));
    renderResults(); renderTeam();
    try {
      await loadData();
    } catch (e) {
      $("main").innerHTML = `<div class="error"><b>${t("err.title")}</b><br>${esc(e.message)}<br>${t("err.hint")}</div>`;
      return;
    }
    $("#demoBanner").hidden = !demo;
    buildFilters(); setupTop(); applyLang(); renderFacts(); syncFilters();
    SECTIONS.forEach(s => stale.add(s.key));
    addEventListener("hashchange", showView);
    addEventListener("resize", setHdr);
    showView();
  })();
})();
