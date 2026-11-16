// ---------------------------------------------------------------------------
// Chart-Engine: Canvas-basierte, interaktive Dot-Histogramme (eine Bahn je
// Gruppe, Punkte oder Piktogramm-Figuren) und Streudiagramm.
// Es werden immer ALLE Datenpunkte gezeichnet – statt eine Stichprobe zu
// ziehen, schrumpft die Punktgröße und die Bahnen wachsen mit der Datenmenge.
// Abhängigkeit: D3 v7 (js/vendor/d3.min.js)
// ---------------------------------------------------------------------------
(() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const TAU = Math.PI * 2;
  const INK = "#17181d", MUTED = "#6b6f7a", GRID = "#eceae3", BASE = "#cbc7bc", ZONE = "#f6f5f1", VEIL = "rgba(255,255,255,.82)";
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const nfCache = {};
  const nf = (loc, d) => nfCache[loc + d] || (nfCache[loc + d] = new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d }));

  // Piktogramme (Toilettenschild-Stil) in einer 10 x 24 Box
  const HEAD = "M5 0.4A2.4 2.4 0 1 1 4.99 0.4Z";
  const PATH_MAN = new Path2D(HEAD +
    "M2.6 6H7.4Q9.2 6 9.2 7.8V14.4H8V8.6H7.5V23.6H5.45V15.2H4.55V23.6H2.5V8.6H2V14.4H0.8V7.8Q0.8 6 2.6 6Z");
  const PATH_WOMAN = new Path2D(HEAD +
    "M3 6H7Q8.4 6 8.7 7.3L9.4 13.4H8.2L7.6 9L9.4 17.2H0.6L2.4 9L1.8 13.4H0.6L1.3 7.3Q1.6 6 3 6Z" +
    "M3.4 17.2H4.8V23.6H3.4Z M5.2 17.2H6.6V23.6H5.2Z");

  class Chart {
    // cfg: { tipHtml(d), onSelect(d), onRender(chart) }
    constructor(el, cfg) {
      this.cfg = cfg;
      this.wrap = el.querySelector(".chart-wrap");
      this.cb = el.querySelector("canvas.base"); this.co = el.querySelector("canvas.over");
      this.tip = el.querySelector(".tip");
      this.cx = this.cb.getContext("2d"); this.ox = this.co.getContext("2d");
      this.pts = []; this.hov = null;
      this.selId = null; this.selPt = null;     // angeklickter Punkt
      this.hl = null; this.hlPts = [];          // per Suche hervorgehobene Person (Index spk)
      this.W = 0; this.H = 0; this.data = null; this.geo = null; this.dirty = false; this.visible = false;
      new ResizeObserver(() => {
        const w = Math.round(this.wrap.clientWidth);
        if (w && w !== this.W) { this.W = w; if (this.data && this.visible) this.render(); else this.dirty = true; }
      }).observe(this.wrap);
      this.co.addEventListener("pointermove", e => this.onMove(e));
      this.co.addEventListener("pointerleave", () => { this.hov = null; this.hideTip(); this.drawOverlay(); });
      this.co.addEventListener("click", e => this.onClick(e));
    }

    // ---- Daten / Zustand setzen ---------------------------------------------------
    // data: { mode: "lanes" | "scatter", recs, color(d), domain, locale, txt, … }
    setData(d) { this.data = d; this.dirty = true; if (this.visible) this.render(); }
    setVisible(v) {
      const was = this.visible; this.visible = v;
      if (v && !was && this.dirty && this.data) this.render();
    }
    select(id) {
      this.selId = id;
      this.selPt = id == null ? null : this.pts.find(p => p.d.id === id) || null;
      this.drawOverlay();
    }
    setHighlight(spk) {
      this.hl = spk;
      this.hlPts = spk == null ? [] : this.pts.filter(p => p.d.spk === spk);
      this.drawOverlay();
    }

    setCanvas(W, H) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.W = W; this.H = H;
      for (const [c, x] of [[this.cb, this.cx], [this.co, this.ox]]) {
        c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
        c.style.width = W + "px"; c.style.height = H + "px";
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      this.wrap.style.height = H + "px";
    }

    render() {
      if (!this.data) return;
      if (!this.W) this.W = Math.round(this.wrap.clientWidth);
      if (!this.W) { this.dirty = true; return; }
      this.dirty = false; this.hov = null; this.hideTip();
      const scatter = this.data.mode === "scatter";
      scatter ? this.layoutScatter() : this.layoutLanes();
      this.selPt = this.selId == null ? null : this.pts.find(p => p.d.id === this.selId) || null;
      this.hlPts = this.hl == null ? [] : this.pts.filter(p => p.d.spk === this.hl);
      const c = this.cx; c.clearRect(0, 0, this.W, this.H);
      scatter ? this.drawScatter(c) : this.drawLanes(c);
      if (!this.pts.length) this.drawEmpty(c);
      this.drawOverlay();
      if (this.cfg.onRender) this.cfg.onRender(this);
    }

    // Höhe, die die Grafik im Fenster idealerweise einnimmt (darüber wird gescrollt)
    targetH() { return window.innerHeight - (this.W < 520 ? 200 : 320); }

    // Surprisal-Skala. domain = { v: Stützstellen, k }: zwischen v[k] und v[n-1-k] linear,
    // die wenigen Extremwerte außerhalb werden in einer schmalen Randzone (zone px) in k
    // gleich breiten Stücken gestaucht – so bleibt jeder Punkt sichtbar, ohne dass
    // Ausreißer die Skala auseinanderziehen.
    surprisalScale(a, b, zone) {
      const { v, k } = this.data.domain, s = Math.sign(b - a) * zone, r = [];
      for (let i = 0; i <= k; i++) r.push(a + s * i / k);
      for (let i = 0; i <= k; i++) r.push(b - s * (k - i) / k);
      return d3.scaleLinear(v, r).clamp(true);
    }

    // ---- Bahnen-Layout (Dot-Histogramm) ---------------------------------------------
    // Alle Bahnen teilen sich eine Punktgröße; jede Bahn ist so hoch wie ihr höchster
    // Stapel. Gewählt wird die größte Punktgröße, mit der alles in targetH() passt –
    // reicht selbst die kleinste nicht, wächst die Grafik nach unten.
    layoutLanes() {
      const { recs, lanes, color, laneOf } = this.data, W = this.W, small = W < 520;
      const ml = 10, mr = 10, top = 2, headH = 21, gap = 10, minBody = 26, bottom = 46;
      const zone = Math.max(16, (W - ml - mr) * 0.04);
      const x = this.surprisalScale(ml, W - mr, zone);
      const laneIdx = new Map(lanes.map((l, i) => [l.key, i]));
      const list = recs.filter(r => laneIdx.has(laneOf(r))), n = list.length;
      const xp = new Float32Array(n), li = new Uint8Array(n);
      list.forEach((r, i) => { xp[i] = x(r.s); li[i] = laneIdx.get(laneOf(r)); });

      const maxH = Math.max(small ? 420 : 360, this.targetH());
      const measure = (w, h) => {
        const nb = Math.max(1, Math.floor((W - ml - mr) / w));
        const cnt = new Uint16Array(lanes.length * nb), peak = new Uint16Array(lanes.length);
        for (let i = 0; i < n; i++) {
          const b = clamp(Math.floor((xp[i] - ml) / w), 0, nb - 1), c = ++cnt[li[i] * nb + b];
          if (c > peak[li[i]]) peak[li[i]] = c;
        }
        const hs = Array.from(peak, p => headH + Math.max(minBody, p * h) + gap);
        return { nb, hs, total: top + d3.sum(hs) + bottom };
      };
      let fig = !!this.data.figures, size = 0, m = null;
      const dims = s => fig ? { w: s * 0.58, h: s } : { w: s, h: s };
      const fit = sizes => {
        for (const s of sizes) { const d = dims(s); m = measure(d.w, d.h); size = s; if (m.total <= maxH) return true; }
        return false;
      };
      if (fig) fit(d3.range(34, 9, -1));
      else {
        const minDot = small ? 1.2 : 1.5, sizes = [];
        for (let s = 11; s > minDot; s *= 0.94) sizes.push(s);
        sizes.push(minDot);
        fit(sizes);
      }

      const { w, h } = dims(size), nb = m.nb, tops = [];
      let yy = top; for (const hh of m.hs) { tops.push(yy); yy += hh; }
      this.setCanvas(W, Math.round(m.total));
      const cnt = new Uint16Array(lanes.length * nb);
      this.pts = list.map((r, i) => {
        const l = li[i], b = clamp(Math.floor((xp[i] - ml) / w), 0, nb - 1), k = cnt[l * nb + b]++;
        return { d: r, x: ml + b * w + w / 2, y: tops[l] + m.hs[l] - gap - (k + 0.5) * h, r: h / 2, color: color(r), fig: fig ? (r.sex === 1 ? 1 : 0) : -1 };
      });
      this.x = x;
      this.geo = { ml, mr, top, headH, gap, bottom, zone, tops, hs: m.hs, size, fig };
    }

    // ---- Streudiagramm ------------------------------------------------------------
    layoutScatter() {
      const { recs, color, xdomain, groups, xOf } = this.data, W = this.W, small = W < 520;
      const ml = small ? 40 : 50, mr = 10, top = 6, bottom = 46;
      const H = Math.round(clamp(Math.min(W * 0.66, this.targetH()), 320, 640));
      this.setCanvas(W, H);
      const zone = Math.max(14, (H - top - bottom) * 0.04);
      const x = d3.scaleLinear(xdomain, [ml, W - mr]);
      const y = this.surprisalScale(H - bottom, top, zone);
      const n = recs.length, r = n > 20000 ? 1.3 : n > 6000 ? 1.7 : n > 1500 ? 2.3 : 3;
      this.alpha = n > 20000 ? 0.45 : n > 6000 ? 0.55 : 0.7;
      this.pts = recs.map(d => ({ d, x: x(xOf(d)), y: y(d.s), r, color: color(d), fig: -1 }));
      // OLS-Trendlinien je Gruppe
      this.trends = (groups || []).map(g => {
        const pts = recs.filter(d => g.test(d));
        if (pts.length < 25) return null;
        const mx = d3.mean(pts, d => d.age), my = d3.mean(pts, d => d.s);
        let sxy = 0, sxx = 0;
        for (const d of pts) { sxy += (d.age - mx) * (d.s - my); sxx += (d.age - mx) ** 2; }
        if (!sxx) return null;
        const b = sxy / sxx, a = my - b * mx, ex = d3.extent(pts, d => d.age);
        return { color: g.color, x0: ex[0], x1: ex[1], y0: a + b * ex[0], y1: a + b * ex[1] };
      }).filter(Boolean);
      this.x = x; this.y = y;
      this.geo = { ml, mr, top, bottom, zone, size: r * 2, fig: false };
    }

    // ---- Zeichnen ---------------------------------------------------------------------
    // Achsenstriche der Surprisal-Skala (nur im linearen Teil)
    surprisalTicks(count) {
      const { v, k } = this.data.domain, ticks = d3.ticks(v[k], v[v.length - 1 - k], count);
      const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
      const dec = clamp(-Math.floor(Math.log10(step) + 1e-9), 0, 3);
      return { ticks, fmt: nf(this.data.locale, dec) };
    }

    drawLanes(c) {
      const { lanes, laneStats, txt, locale } = this.data, g = this.geo, W = this.W, small = W < 520;
      const baseY = i => Math.round(g.tops[i] + g.hs[i] - g.gap) + 0.5;
      const plotB = baseY(lanes.length - 1);
      const { ticks, fmt } = this.surprisalTicks(small ? 5 : 9);
      c.save();
      // Randzonen mit den gestauchten Extremwerten
      c.fillStyle = ZONE;
      c.fillRect(g.ml, g.top, g.zone, plotB - g.top); c.fillRect(W - g.mr - g.zone, g.top, g.zone, plotB - g.top);
      c.lineWidth = 1;
      c.strokeStyle = GRID; c.beginPath();
      for (const t of ticks) { const px = Math.round(this.x(t)) + 0.5; c.moveTo(px, g.top); c.lineTo(px, plotB); }
      c.stroke();
      c.strokeStyle = BASE; c.beginPath();
      lanes.forEach((l, i) => { c.moveTo(g.ml, baseY(i)); c.lineTo(W - g.mr, baseY(i)); });
      c.stroke();

      this.drawPoints(c);

      const f0 = nf(locale, 0), f2 = nf(locale, 2);
      lanes.forEach((l, i) => {
        const st = laneStats[l.key], ty = g.tops[i], n = st ? st.n : 0;
        // Bahn-Beschriftung: Name · Anzahl · Mittelwert
        c.textAlign = "left"; c.textBaseline = "top";
        c.fillStyle = l.color || INK; c.font = `700 13.5px ${FONT}`;
        c.fillText(l.label, g.ml, ty + 2);
        const lw = c.measureText(l.label).width;
        c.fillStyle = MUTED; c.font = `12.5px ${FONT}`;
        let sub = f0.format(n) + (small ? "" : " " + txt.unit);
        if (n) sub += ` · ${txt.avg} ${f2.format(st.mean)}`;
        c.fillText(sub, g.ml + lw + 8, ty + 3);
        if (n) {
          // Mittelwert: gestrichelte Linie, darüber ein kleiner Marker (falls dort kein Text steht)
          const mx = Math.round(this.x(st.mean)) + 0.5, hy = ty + g.headH;
          c.strokeStyle = INK; c.lineWidth = 1.3; c.setLineDash([4, 3]);
          c.beginPath(); c.moveTo(mx, hy - 2); c.lineTo(mx, baseY(i)); c.stroke(); c.setLineDash([]);
          if (mx - 4 > g.ml + lw + 8 + c.measureText(sub).width + 6) {
            c.fillStyle = INK; c.beginPath(); c.moveTo(mx - 4, hy - 7); c.lineTo(mx + 4, hy - 7); c.lineTo(mx, hy - 1); c.fill();
          }
        }
      });

      // Achse
      const yAx = plotB + 6;
      c.fillStyle = MUTED; c.font = `11.5px ${FONT}`; c.textAlign = "center"; c.textBaseline = "top";
      for (const t of ticks) c.fillText(fmt.format(t), this.x(t), yAx);
      c.font = `600 11.5px ${FONT}`; c.fillStyle = "#3d4049";
      c.textAlign = "left"; c.fillText(small ? txt.axisLowShort : txt.axisLow, g.ml, yAx + 19);
      c.textAlign = "right"; c.fillText(small ? txt.axisHighShort : txt.axisHigh, W - g.mr, yAx + 19);
      c.restore();
    }

    drawScatter(c) {
      const { txt } = this.data, { ml, mr, top, bottom, zone } = this.geo, W = this.W, H = this.H;
      const yt = this.surprisalTicks(6), xt = { ticks: this.x.ticks(W < 520 ? 6 : 10) };
      c.save();
      c.fillStyle = ZONE;
      c.fillRect(ml, top, W - ml - mr, zone); c.fillRect(ml, H - bottom - zone, W - ml - mr, zone);
      c.strokeStyle = GRID; c.lineWidth = 1; c.beginPath();
      for (const t of yt.ticks) { const y = Math.round(this.y(t)) + 0.5; c.moveTo(ml, y); c.lineTo(W - mr, y); }
      for (const t of xt.ticks) { const x = Math.round(this.x(t)) + 0.5; c.moveTo(x, top); c.lineTo(x, H - bottom); }
      c.stroke();
      c.fillStyle = MUTED; c.font = `11.5px ${FONT}`;
      c.textAlign = "right"; c.textBaseline = "middle";
      for (const t of yt.ticks) c.fillText(yt.fmt.format(t), ml - 6, this.y(t));
      c.textAlign = "center"; c.textBaseline = "top";
      for (const t of xt.ticks) c.fillText(String(t), this.x(t), H - bottom + 6);
      c.fillStyle = "#3d4049"; c.font = `600 12px ${FONT}`;
      c.fillText(txt.axisAge, (ml + W - mr) / 2, H - bottom + 25);
      c.save(); c.translate(10, (top + H - bottom) / 2); c.rotate(-Math.PI / 2);
      c.textBaseline = "middle"; c.fillText("Surprisal →", 0, 0); c.restore();

      c.globalAlpha = this.alpha;
      this.drawPoints(c);
      c.globalAlpha = 1;

      c.lineCap = "round";
      for (const t of this.trends) {
        for (const [col, lw] of [["#fff", 5], [t.color, 2.4]]) {
          c.strokeStyle = col; c.lineWidth = lw;
          c.beginPath(); c.moveTo(this.x(t.x0), this.y(t.y0)); c.lineTo(this.x(t.x1), this.y(t.y1)); c.stroke();
        }
      }
      c.restore();
    }

    figure(c, p) {
      const s = p.r * 2 / 24;
      c.save(); c.translate(p.x - 5 * s, p.y - p.r); c.scale(s, s);
      c.fill(p.fig === 1 ? PATH_WOMAN : PATH_MAN); c.restore();
    }

    drawPoints(c) {
      const pts = this.pts, g = this.geo;
      let last = null;
      if (g.fig) {
        for (const p of pts) { if (p.color !== last) c.fillStyle = last = p.color; this.figure(c, p); }
      } else if (g.size < 3.4) {
        // sehr kleine Punkte als Quadrate (schneller und bei der Größe nicht unterscheidbar)
        const s = Math.max(1, g.size * 0.84), o = s / 2;
        for (const p of pts) { if (p.color !== last) c.fillStyle = last = p.color; c.fillRect(p.x - o, p.y - o, s, s); }
      } else {
        const r = g.size * 0.45;
        c.beginPath();
        for (const p of pts) {
          if (p.color !== last) { if (last) c.fill(); c.beginPath(); c.fillStyle = last = p.color; }
          c.moveTo(p.x + r, p.y); c.arc(p.x, p.y, r, 0, TAU);
        }
        if (last) c.fill();
      }
    }

    drawEmpty(c) {
      c.save(); c.fillStyle = MUTED; c.font = `600 14px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(this.data.txt.empty, this.W / 2, (this.H - this.geo.bottom) / 2);
      c.restore();
    }

    // ---- Interaktion -----------------------------------------------------------------
    nearest(list, mx, my, reach) {
      let best = null, bd = Infinity;
      for (const p of list) {
        const dx = mx - p.x, dy = my - p.y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) return null;
      const lim = Math.max(best.r + 3, reach);
      return bd <= lim * lim ? best : null;
    }
    // hervorgehobene Punkte haben Vorrang, damit man sie zwischen den anderen trifft
    pick(mx, my) { return this.nearest(this.hlPts, mx, my, 9) || this.nearest(this.pts, mx, my, 7); }
    xy(e) { const r = this.co.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    onMove(e) {
      if (e.pointerType === "touch") return;
      const [x, y] = this.xy(e), p = this.pick(x, y);
      if (p !== this.hov) { this.hov = p; this.drawOverlay(); }
      this.co.style.cursor = p ? "pointer" : "default";
      if (p) this.showTip(p, x, y); else this.hideTip();
    }
    onClick(e) {
      // Mit der Maus gilt der Punkt, den Hover-Ring und Tooltip gerade zeigen: Der Klick meldet
      // gerundete Koordinaten, pointermove nicht – bei 1,5 px großen Punkten träfe eine eigene
      // Suche sonst oft den Nachbarn. Ohne Hover (Touch) wird an der Klickstelle gesucht.
      const [x, y] = this.xy(e), p = (e.pointerType !== "touch" && this.hov) || this.pick(x, y);
      if (!p) return;
      this.selId = p.d.id; this.selPt = p; this.drawOverlay();
      if (this.cfg.onSelect) this.cfg.onSelect(p.d);
    }
    showTip(p, x, y) {
      this.tip.innerHTML = this.cfg.tipHtml(p.d); this.tip.hidden = false;
      const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      let tx = x + 14, ty = y - th - 12;
      if (tx + tw > this.W - 4) tx = x - tw - 14;
      if (ty < 0) ty = y + 18;
      this.tip.style.transform = `translate(${Math.max(4, tx)}px, ${ty}px)`;
    }
    hideTip() { this.tip.hidden = true; }

    // Overlay: Hervorhebung der Suche, Auswahl- und Hover-Ring
    drawOverlay() {
      const c = this.ox, g = this.geo; c.clearRect(0, 0, this.W, this.H);
      if (!this.data || !g) return;
      if (this.hl != null) {
        c.fillStyle = VEIL;
        if (g.tops) g.tops.forEach((t, i) => c.fillRect(0, t + g.headH, this.W, g.hs[i] - g.headH - g.gap));
        else c.fillRect(g.ml, g.top, this.W - g.ml - g.mr, this.H - g.bottom - g.top);
        for (const p of this.hlPts) this.mark(c, p);
        // einzelne Treffer (Personen-Ansicht) zusätzlich einkreisen, sonst gehen sie unter
        if (this.hlPts.length <= 2) for (const p of this.hlPts) if (p !== this.selPt) this.ring(c, p, true);
      }
      if (this.selPt) this.ring(c, this.selPt, true);
      if (this.hov && this.hov !== this.selPt) this.ring(c, this.hov, false);
    }
    // Punkt deutlich sichtbar nachzeichnen (mindestens 3,4 px Radius, weißer Rand)
    mark(c, p) {
      c.save(); c.fillStyle = p.color;
      if (p.fig >= 0) this.figure(c, p);
      else {
        const r = Math.max(p.r * 0.9, 3.4);
        c.beginPath(); c.arc(p.x, p.y, r, 0, TAU); c.fill();
        c.strokeStyle = "#fff"; c.lineWidth = 1.2; c.stroke();
      }
      c.restore();
    }
    ring(c, p, strong) {
      c.save();
      if (p.fig < 0 && p.r < 3.4) this.mark(c, p);
      for (const [col, lw] of [["#fff", strong ? 5 : 4], [INK, strong ? 2.4 : 1.6]]) {
        c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
        if (p.fig >= 0) {
          const w = p.r * 0.84 + 7, h = p.r * 2 + 7;
          c.roundRect ? c.roundRect(p.x - w / 2, p.y - h / 2, w, h, 5) : c.rect(p.x - w / 2, p.y - h / 2, w, h);
        } else c.arc(p.x, p.y, Math.max(p.r, 3.4) + 3, 0, TAU);
        c.stroke();
      }
      c.restore();
    }
  }

  window.Chart = Chart;
})();
