// notfound.js - the 404 page.
//
// A Lower Streets wall where someone has sprayed the missing address as "404", and Nullgrid Civic
// Works' municipal scrubber drone (the same airframe as on the home page, after city_scrubber.js)
// comes to clean it off. When the wall is clean, the operator walks over and sprays it back, and
// the drone returns. It goes on as long as anyone watches.
//
// Click the operator to change their colour, the drone to paint over its lens (it wobbles and stops
// work for a while), or the clean wall to have the operator spray it again straight away. Nothing
// is marked: the same rule as the home page. With reduced motion asked for, one still frame.
(function () {
    "use strict";

    var REDUCE = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    var canvas = document.getElementById("scene");
    var ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
    var hero = document.getElementById("hero");
    var copy = document.querySelector(".hero-copy");

    var OP_COLOURS = ["#FF1493", "#00DFFF", "#39FF14", "#FF3E00", "#8A2BE2"];
    var OP = { w: 26, h: 38, speed: 150, sprayTime: 1.4 };
    var SCRUB = { col: "#FFA41B", body: "#15171e", glass: "#FFD27A", solvent: "#9FE7FF",
        scale: 1.25, padDrop: 24, speed: 150, workSpeed: 108, cleanTime: 6.5, blindTime: 6, firstAt: 2, returnAfter: 4.5 };
    var WALL = { col: "#00DFFF", body: "rgb(0,31,36)" };
    var DRIPS = [[-0.36, 0.55], [0.02, 0.9], [0.31, 0.4]];        // [across the word, length in tag sizes]

    var W = 0, H = 0, DPR = 1, K = 1, gy = 0, wall = null, tagX = 0, tagY = 0, tagS = 60, tagW = 100;
    var bg = null, clock = 0, last = 0, rafId = 0;
    var op = { x: -1, home: 0, dir: 1, colour: 0, state: "idle", t0: 0, respAt: 0, wanderAt: 2, target: 0 };
    var tag = { p: 1, alpha: 1, col: OP_COLOURS[0] };
    var scrub = { x: 0, y: 0, dir: -1, state: "away", at: SCRUB.firstAt, pad: 0, prog: 0, blindUntil: 0, paint: null, sparkAt: 0 };
    var bits = [], rain = [];

    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function rgbOf(hex) {
        var n = parseInt(hex.slice(1), 16);
        return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255);
    }
    function rgba(hex, a) { return "rgba(" + rgbOf(hex) + "," + a + ")"; }
    function rng(seed) {
        var s = seed >>> 0;
        return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }
    function near(x, y, tx, ty, r) { return Math.abs(x - tx) <= r && Math.abs(y - ty) <= r; }
    function pPath(c, pts, close) {
        c.beginPath();
        for (var i = 0; i < pts.length; i += 2) { if (i) c.lineTo(pts[i], pts[i + 1]); else c.moveTo(pts[i], pts[i + 1]); }
        if (close) c.closePath();
    }
    function roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
        c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
        c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
        c.closePath();
    }

    // ─── The modem's lines, with the address that was asked for ───────────
    function runBoot() {
        var el = document.getElementById("boot");
        if (!el) return;
        var path = "/";
        try { path = decodeURIComponent(window.location.pathname || "/"); } catch (e) { path = window.location.pathname || "/"; }
        path = path.replace(/[^\x20-\x7E]/g, "?").toUpperCase();
        if (path.length > 28) path = path.slice(0, 27) + "~";
        var lines = ["ATDT UNTRUSTEDNETWORK.DEV" + (path === "/" ? "" : path), "CONNECT 14400", "> GET " + path, "404 // ADDRESS SCRUBBED"];
        var text = lines.join("\n"), cursor = document.createElement("span");
        cursor.className = "cursor";
        if (REDUCE) { el.textContent = text; return; }
        var i = 0;
        (function type() {
            i = Math.min(text.length, i + 2);
            el.textContent = text.slice(0, i);
            el.appendChild(cursor);
            if (i < text.length) setTimeout(type, 22);
        })();
    }

    // ─── Layout and the still layer: sky, distant towers, the wall, the street ───
    function layout() {
        var r = canvas.getBoundingClientRect();
        W = r.width; H = r.height;
        if (W < 10 || H < 10) return false;
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
        K = clamp(Math.min(W / 1100, H / 760), 0.62, 1.05);
        gy = H - 46 * K;
        var cb = copy ? copy.getBoundingClientRect().bottom - r.top + 26 * K : H * 0.5;
        var ww = Math.min(W - 40 * K, 860 * K), wh = clamp(gy - cb, 170 * K, 430 * K);
        wall = { x: (W - ww) / 2, w: ww, top: gy - wh, h: wh };
        tagS = clamp(Math.min(wh * 0.34, ww * 0.2), 52 * K, 128 * K);
        ctx.font = "bold " + tagS.toFixed(1) + "px cyber, monospace";
        tagW = ctx.measureText("404").width;
        tagX = wall.x + ww * 0.56;
        tagY = gy - 34 * K - tagS * 0.5;
        op.home = wall.x + ww * 0.14;
        if (op.x < 0) op.x = op.home; else op.x = clamp(op.x, 20 * K, W - 20 * K);
        if (scrub.state === "away") { scrub.x = W + 70 * K; scrub.y = tagY - 60 * K; }
        else { scrub.x = clamp(scrub.x, 0, W + 70 * K); }
        rain = [];
        if (!REDUCE) for (var i = 0; i < Math.round(W / 18); i++) rain.push({ x: Math.random() * W, y: Math.random() * H, v: (380 + Math.random() * 220) * K });
        drawBackground();
        return true;
    }
    function drawBackground() {
        bg = document.createElement("canvas");
        bg.width = canvas.width; bg.height = canvas.height;
        var c = bg.getContext("2d"), i, j, x, w, h, rnd = rng(404);
        c.setTransform(DPR, 0, 0, DPR, 0, 0);
        var sky = c.createLinearGradient(0, 0, 0, gy);
        sky.addColorStop(0, "#030309"); sky.addColorStop(1, "#0b0a1e");
        c.fillStyle = sky; c.fillRect(0, 0, W, gy);
        // distant towers, with a few lit windows
        x = -20 * K;
        while (x < W) {
            w = (70 + rnd() * 110) * K; h = (gy - wall.top) * (0.7 + rnd() * 0.75);
            c.fillStyle = "#0c0b1c"; c.fillRect(x, gy - h, w, h);
            for (j = gy - h + 14 * K; j < gy - 20 * K; j += 22 * K) {
                for (i = x + 10 * K; i < x + w - 14 * K; i += 18 * K) {
                    if (rnd() < 0.16) { c.fillStyle = rnd() < 0.5 ? "rgba(0,223,255,0.16)" : "rgba(255,20,147,0.14)"; c.fillRect(i, j, 6 * K, 8 * K); }
                }
            }
            x += w + (8 + rnd() * 30) * K;
        }
        // the wall: a dark front with one neon edge, windows above, a roller shutter, and room for paint
        c.fillStyle = WALL.body; c.fillRect(wall.x, wall.top, wall.w, wall.h);
        c.fillStyle = "#141028"; c.fillRect(wall.x, wall.top - 4 * K, wall.w, 4 * K);
        var winTop = wall.top + 22 * K, winBot = tagY - tagS * 0.75;
        for (j = winTop; j + 26 * K < winBot; j += 46 * K) {
            for (i = wall.x + 36 * K; i + 18 * K < wall.x + wall.w - 30 * K; i += 54 * K) {
                c.fillStyle = rnd() < 0.3 ? "rgba(0,223,255,0.55)" : "rgba(0,223,255,0.12)";
                c.fillRect(i, j, 18 * K, 26 * K);
            }
        }
        c.strokeStyle = "rgba(0,223,255,0.08)"; c.lineWidth = 1;
        for (j = wall.top + 30 * K; j < gy; j += 30 * K) { c.beginPath(); c.moveTo(wall.x + 6 * K, j); c.lineTo(wall.x + wall.w - 6 * K, j); c.stroke(); }
        var sx = wall.x + wall.w * 0.86 - 34 * K, sh = 76 * K, sw = 68 * K;          // the roller shutter
        if (sx > tagX + tagW * 0.6 + 20 * K) {
            c.fillStyle = "#0a1416"; c.fillRect(sx, gy - sh, sw, sh);
            c.strokeStyle = "rgba(0,223,255,0.22)";
            for (j = gy - sh + 6 * K; j < gy - 2; j += 6 * K) { c.beginPath(); c.moveTo(sx + 2, j); c.lineTo(sx + sw - 2, j); c.stroke(); }
            c.strokeStyle = "rgba(0,223,255,0.45)"; c.strokeRect(sx + 0.5, gy - sh + 0.5, sw - 1, sh - 1);
            c.fillStyle = "#FFD24A"; c.fillRect(sx + sw - 12 * K, gy - sh + 8 * K, 5 * K, 5 * K);
        }
        c.strokeStyle = rgba(WALL.col, 0.45); c.lineWidth = 1.5;
        c.strokeRect(wall.x + 0.75, wall.top + 0.75, wall.w - 1.5, wall.h - 1.5);
        // the street
        c.fillStyle = "#06060d"; c.fillRect(0, gy, W, H - gy);
        c.strokeStyle = "rgba(0,223,255,0.35)"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, gy + 0.75); c.lineTo(W, gy + 0.75); c.stroke();
        c.fillStyle = "rgba(255,255,255,0.07)";
        for (i = 10 * K; i < W; i += 70 * K) c.fillRect(i, gy + 22 * K, 34 * K, 3 * K);
    }

    // ─── Loose bits: paint mist, solvent sparks ───────────────────────────
    function addBit(x, y, vx, vy, col, size, life, grav) {
        bits.push({ x: x, y: y, vx: vx, vy: vy, col: col, s: size, life: life, max: life, g: grav === undefined ? 300 * K : grav });
    }
    function updateBits(dt) {
        for (var i = bits.length - 1; i >= 0; i--) {
            var p = bits[i];
            p.life -= dt;
            if (p.life <= 0) { bits.splice(i, 1); continue; }
            p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
            if (p.y > gy - 1) { p.y = gy - 1; p.vx = 0; p.vy = 0; }
        }
    }
    function drawBits() {
        ctx.save();
        bits.forEach(function (p) {
            ctx.globalAlpha = Math.min(1, p.life / (p.max * 0.5));
            ctx.fillStyle = p.col;
            ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
        });
        ctx.restore();
    }

    // ─── The tag ──────────────────────────────────────────────────────────
    function drawTag() {
        if (tag.p <= 0 || tag.alpha <= 0) return;
        ctx.save();
        ctx.translate(tagX, tagY);
        ctx.rotate(-0.035);
        if (tag.p < 1) { ctx.beginPath(); ctx.rect(-tagW / 2 - tagS * 0.2, -tagS, (tagW + tagS * 0.4) * tag.p, tagS * 3); ctx.clip(); }
        ctx.font = "bold " + tagS.toFixed(1) + "px cyber, monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.globalAlpha = tag.alpha;
        ctx.shadowColor = tag.col; ctx.shadowBlur = 10 * DPR * tag.alpha;
        ctx.fillStyle = tag.col;
        ctx.fillText("404", 0, 0);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.6 * tag.alpha;
        DRIPS.forEach(function (d) {
            var len = d[1] * tagS * 0.45 * tag.p, dx = d[0] * tagW, dy = tagS * 0.3;
            ctx.fillRect(dx - 1, dy, 2, len);
            ctx.fillRect(dx - 1.6, dy + len, 3.2, 3.2);
        });
        ctx.restore();
    }

    // ─── The operator: walks to the wall and sprays the address back ─────
    function updateOperator(t, dt) {
        var sprayX = tagX - tagW / 2 - 26 * K;
        if (op.state === "idle") {
            if (tag.p <= 0 && t >= op.respAt) { op.state = "toWall"; return; }
            if (!REDUCE && t >= op.wanderAt) {                                        // a few steps either way at home
                op.target = op.home + (Math.random() - 0.5) * 60 * K;
                op.wanderAt = t + 3 + Math.random() * 3;
            }
            walkTo(op.target || op.home, dt, 0.4);
        } else if (op.state === "toWall") {
            if (walkTo(sprayX, dt, 1)) { op.dir = 1; op.state = "spraying"; op.t0 = t; tag.col = OP_COLOURS[op.colour]; tag.alpha = 1; tag.p = 0; }
        } else if (op.state === "spraying") {
            tag.p = clamp((t - op.t0) / OP.sprayTime, 0, 1);
            var hx = op.x + 12 * K, hy = gy - OP.h * K * 0.8;
            for (var i = 0; i < 2; i++) {
                var ty = tagY + (Math.random() - 0.5) * tagS * 0.5, tx = tagX - tagW / 2 + tagW * tag.p;
                addBit(hx, hy, (tx - hx) * 2.6, (ty - hy) * 2.6, rgba(tag.col, 0.5), 2 * K, 0.38, 0);
            }
            if (tag.p >= 1) { op.state = "back"; scrub.at = t + SCRUB.returnAfter; }
        } else if (op.state === "back") {
            if (walkTo(op.home, dt, 1)) { op.state = "idle"; op.wanderAt = t + 2; op.target = op.home; }
        }
    }
    function walkTo(x, dt, pace) {
        var d = x - op.x, step = OP.speed * K * pace * dt;
        if (Math.abs(d) <= step) { op.x = x; return true; }
        op.dir = d > 0 ? 1 : -1;
        op.x += op.dir * step;
        return false;
    }
    function drawOperator() {
        var col = OP_COLOURS[op.colour], w = OP.w * K, h = OP.h * K, x = op.x - w / 2, y = gy - h;
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(x - 2 * K, gy, w + 4 * K, 3);
        ctx.shadowColor = rgba(col, 0.6); ctx.shadowBlur = 12 * DPR;
        ctx.fillStyle = col; roundRect(ctx, x, y, w, h, 4 * K); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#FFFFFF";
        var ex = op.x + op.dir * 3 * K, es = 3.5 * K;
        ctx.fillRect(ex - 6 * K, y + 9 * K, es, es);
        ctx.fillRect(ex + 2.5 * K, y + 9 * K, es, es);
        if (op.state === "spraying") {                                                // the can, held up to the wall
            ctx.fillStyle = "#c8ccd6"; ctx.fillRect(op.x + 10 * K, y + 4 * K, 5 * K, 9 * K);
            ctx.fillStyle = col; ctx.fillRect(op.x + 10 * K, y + 2 * K, 5 * K, 2 * K);
        }
        ctx.restore();
    }

    // ─── The scrubber drone ───────────────────────────────────────────────
    function updateScrubber(t, dt) {
        var s = scrub, workY = tagY - SCRUB.padDrop * K - 4 * K;
        if (t < s.blindUntil) {                                                       // painted over: it wobbles and drifts
            s.pad = Math.max(0, s.pad - dt * 3);
            s.x += s.dir * 20 * K * dt;
            s.y += Math.sin(t * 2.2) * 6 * K * dt;
            if (t >= s.sparkAt) { s.sparkAt = t + 0.18; addBit(s.x + (Math.random() - 0.5) * 22 * K, s.y + 8 * K, (Math.random() - 0.5) * 40 * K, -10 * K, "rgba(200,235,255,0.8)", 1.8 * K, 0.45, 220 * K); }
            return;
        }
        if (s.paint) s.paint = null;
        if (s.state === "away") {
            s.x = W + 70 * K; s.y = workY - 40 * K; s.pad = 0;
            if (tag.p >= 1 && op.state === "idle" && t >= s.at) s.state = "going";
        } else if (s.state === "going") {
            var tx = tagX - tagW * 0.3, dx = tx - s.x, dy = workY - s.y, d = Math.sqrt(dx * dx + dy * dy);
            var step = (d > 140 * K ? SCRUB.speed * 1.6 : SCRUB.workSpeed) * K * dt;          // quick across the street, slow on the approach
            if (Math.abs(dx) > 2 * K) s.dir = dx >= 0 ? 1 : -1;
            if (d <= step) { s.x = tx; s.y = workY; s.state = "cleaning"; s.prog = 0; }
            else { s.x += dx / d * step; s.y += dy / d * step; }
        } else if (s.state === "cleaning") {
            if (s.pad < 1) { s.pad = Math.min(1, s.pad + dt * 3.6); return; }
            s.prog += dt;
            var sweep = Math.sin(s.prog * 1.5) * tagW * 0.34;
            s.dir = Math.cos(s.prog * 1.5) >= 0 ? 1 : -1;
            s.x = tagX + sweep; s.y = workY;
            tag.alpha = Math.max(0, 1 - s.prog / SCRUB.cleanTime);
            if (t >= s.sparkAt) {
                s.sparkAt = t + 0.1;
                addBit(s.x + (Math.random() - 0.5) * 26 * K, tagY + (Math.random() - 0.5) * 18 * K, (Math.random() - 0.5) * 36 * K, -16 * K, "rgba(200,235,255,0.7)", 1.6 * K, 0.4, 180 * K);
            }
            if (s.prog >= SCRUB.cleanTime) { tag.p = 0; tag.alpha = 1; s.state = "leaving"; s.dir = 1; op.respAt = t + 2.5; }
        } else if (s.state === "leaving") {
            s.pad = Math.max(0, s.pad - dt * 3);
            s.x += SCRUB.speed * K * dt;
            s.y += clamp(workY - 40 * K - s.y, -60 * K * dt, 60 * K * dt);
            if (s.x > W + 70 * K) s.state = "away";
        }
    }
    function owPoly(c, pts) { pPath(c, pts, true); c.fill(); c.stroke(); }
    function owPod(c, x, y, w, h) {
        owPoly(c, [x - w / 2, y, x + w / 2, y, x + w / 2, y + h - 3, x + w / 2 - 3, y + h, x - w / 2 + 3, y + h, x - w / 2, y + h - 3]);
        c.fillStyle = "rgba(255,255,255,0.22)"; c.fillRect(x - w / 2 + 2, y + 2, w - 4, 0.8); c.fillRect(x - w / 2 + 2, y + 4, w - 4, 0.8);
        c.fillStyle = "rgba(210,220,235,0.75)"; c.fillRect(x - w / 2 + 3, y + h, w - 6, 1.2);
        c.fillStyle = "rgba(210,220,235,0.10)";
        pPath(c, [x - w / 2 + 3, y + h + 1, x + w / 2 - 3, y + h + 1, x + w / 2, y + h + 7, x - w / 2, y + h + 7], true); c.fill();
    }
    function hazardBand(c, x, y, w, h, col, back) {
        var n = Math.max(1, Math.round(w / (h * 2))), p = w / n, sw = p / 2, k, sx;
        c.save();
        c.fillStyle = back; c.fillRect(x, y, w, h);
        c.beginPath(); c.rect(x, y, w, h); c.clip();
        c.fillStyle = col;
        for (k = -1; k <= n; k++) { sx = x + (k + 0.5) * p - h / 2 - sw / 2; pPath(c, [sx, y + h, sx + h, y, sx + h + sw, y, sx + sw, y + h], true); c.fill(); }
        c.restore();
    }
    function drawEyePaint(c, color) {
        c.save();
        c.fillStyle = color; c.strokeStyle = color;
        c.globalAlpha = 0.9;
        pPath(c, [-6.8, -0.4, -5.9, -4.6, -3.1, -6.3, -1.2, -5.2, 1.6, -6.8, 4.4, -4.9, 4.9, -2.1, 3.1, -0.6, 3.6, 1.4, 1.2, 2.2, -0.9, 4.6, -3.6, 3.8, -5.2, 4.4, -6.1, 2.1], true);
        c.fill();
        c.globalAlpha = 0.85;
        c.fillRect(-4.6, 3.6, 1.3, 6.4);
        c.restore();
    }
    function drawScrubber(t) {
        var s = scrub;
        if (s.state === "away" && t >= s.blindUntil) return;
        var c = ctx, sk = SCRUB.scale * K, bob = REDUCE ? 0 : Math.sin(t * 2.4 + s.x * 0.01) * 1.5 * K;
        var sx = s.x, sy = s.y + bob, edge = SCRUB.col, k, a;
        c.save();
        c.lineJoin = "miter";
        if (s.pad > 0) {                                                              // the scrubbing pad on its arm
            var pr = 11 * sk * s.pad, py = sy + SCRUB.padDrop * K * s.pad;
            c.strokeStyle = "#3a3f4a"; c.lineWidth = 3 * K;
            c.beginPath(); c.moveTo(sx, sy + 9 * sk); c.lineTo(sx - s.dir * 4 * K, sy + (9 * sk + SCRUB.padDrop * K * s.pad) / 2 + 3 * K); c.lineTo(sx, py); c.stroke();
            c.fillStyle = "#1c1f28"; c.beginPath(); c.arc(sx, py, pr, 0, Math.PI * 2); c.fill();
            c.strokeStyle = edge; c.lineWidth = 1.2 * K; c.stroke();
            var a0 = (s.state === "cleaning" && !REDUCE) ? t * 11 : 0;
            c.strokeStyle = "rgba(255,210,122,0.5)"; c.lineWidth = K;
            c.beginPath();
            for (k = 0; k < 6; k++) {
                a = a0 + k * Math.PI / 3;
                c.moveTo(sx + Math.cos(a) * pr * 0.3, py + Math.sin(a) * pr * 0.3);
                c.lineTo(sx + Math.cos(a) * pr * 0.85, py + Math.sin(a) * pr * 0.85);
            }
            c.stroke();
        }
        c.translate(sx, sy);
        if (t < s.blindUntil && !REDUCE) c.rotate(Math.sin(t * 2.8) * 0.14);
        c.scale(s.dir * sk, sk);
        c.fillStyle = SCRUB.body; c.strokeStyle = edge; c.lineWidth = 1.2;
        owPod(c, -22, -11, 12, 8); c.fillStyle = SCRUB.body;
        owPod(c, 22, -11, 12, 8); c.fillStyle = SCRUB.body;
        owPoly(c, [-15, -13, -5, -13, -3, -11, -5, -9, -15, -9, -16, -11]);                // solvent tank
        c.fillStyle = "rgba(159,231,255,0.7)"; c.fillRect(-13, -12, 6, 2);
        c.fillStyle = "#3a3f4a"; c.fillRect(-4, -12.5, 5, 3.5);
        c.fillStyle = SCRUB.solvent; c.fillRect(-2.5, -11.5, 2, 2);
        c.fillStyle = SCRUB.body; c.strokeStyle = edge; c.lineWidth = 1.2;                   // top deck and spar
        c.fillRect(-22, -15, 44, 2); c.strokeRect(-22, -15, 44, 2);
        c.fillRect(-16, -9, 32, 3); c.strokeRect(-16, -9, 32, 3);
        c.fillStyle = "rgba(255,210,122,0.85)"; c.fillRect(-15, -7.6, 1.6, 1.2); c.fillRect(13.4, -7.6, 1.6, 1.2);
        c.fillStyle = SCRUB.body; c.shadowBlur = 3 * DPR; c.shadowColor = SCRUB.col;         // hull, hazard keel
        owPoly(c, [-17, -6, 13, -6, 17, 0, 12, 9, -13, 9, -17, 4]);
        c.shadowBlur = 0;
        hazardBand(c, -12, 6, 22, 3, SCRUB.col, "#1a1a1a");
        c.fillStyle = "#000000"; c.strokeStyle = edge; c.lineWidth = 1;                      // the amber lens
        c.beginPath(); c.arc(4, 1, 5, 0, Math.PI * 2); c.fill(); c.stroke();
        if (!s.paint) {
            c.fillStyle = SCRUB.glass; c.shadowBlur = 6 * DPR; c.shadowColor = SCRUB.col;
            c.beginPath(); c.arc(4, 1, 3.4, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
            c.fillStyle = "rgba(255,255,255,0.6)"; c.fillRect(5, -1, 1.4, 1.4);
        } else {
            c.save(); c.translate(4, 1); c.scale(0.82, 0.82); drawEyePaint(c, s.paint); c.restore();
        }
        c.restore();
    }

    // ─── Rain, and the frame ──────────────────────────────────────────────
    function drawRain(dt) {
        ctx.save();
        ctx.strokeStyle = "rgba(160,200,255,0.12)"; ctx.lineWidth = 1;
        ctx.beginPath();
        rain.forEach(function (d) {
            d.y += d.v * dt; d.x -= d.v * 0.08 * dt;
            if (d.y > gy) { d.y = -10; d.x = Math.random() * (W + 40); }
            ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + 1.5 * K, d.y - 12 * K);
        });
        ctx.stroke();
        ctx.restore();
    }
    function frame(t, dt) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(bg, 0, 0);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        drawTag();
        drawOperator();
        drawBits();
        drawScrubber(t);
        if (!REDUCE) drawRain(dt);
    }
    function loop(now) {
        rafId = requestAnimationFrame(loop);
        var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
        last = now; clock += dt;
        updateOperator(clock, dt);
        updateScrubber(clock, dt);
        updateBits(dt);
        frame(clock, dt);
    }

    // ─── Clicks ───────────────────────────────────────────────────────────
    function setOperatorColour(i) {
        op.colour = i % OP_COLOURS.length;
        var root = document.documentElement.style;
        root.setProperty("--op", OP_COLOURS[op.colour]);
        root.setProperty("--op-rgb", rgbOf(OP_COLOURS[op.colour]));
    }
    function onClick(e) {
        var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, pad = Math.max(16, 18 * K);
        if (near(x, y, op.x, gy - OP.h * K / 2, Math.max(pad, OP.h * K / 2 + 4))) { setOperatorColour(op.colour + 1); return; }
        if (scrub.state !== "away" && near(x, y, scrub.x, scrub.y, pad + 6 * K)) {
            scrub.blindUntil = clock + SCRUB.blindTime; scrub.paint = OP_COLOURS[op.colour];
            scrub.dir = scrub.x > tagX ? 1 : -1;
            return;
        }
        if (tag.p <= 0 && op.state === "idle" && x > wall.x && x < wall.x + wall.w && y > wall.top && y < gy) op.respAt = clock;
    }

    function start() {
        runBoot();
        if (!ctx || !canvas || !hero) return;
        if (!layout()) { setTimeout(start, 120); return; }
        if (REDUCE) {                                                                 // one still: the drone at work on the wall
            scrub.state = "cleaning"; scrub.pad = 1; scrub.x = tagX + tagW * 0.12; scrub.y = tagY - SCRUB.padDrop * K - 4 * K;
            tag.alpha = 0.7;
            frame(0, 0);
        } else {
            rafId = requestAnimationFrame(loop);
        }
        canvas.addEventListener("click", onClick);
        hero.addEventListener("click", function (e) { if (e.target === hero || e.target.classList.contains("scene-room")) onClick(e); });
        var timer = 0;
        function relayout() {
            clearTimeout(timer);
            timer = setTimeout(function () { if (layout() && REDUCE) frame(0, 0); }, 100);
        }
        if (window.ResizeObserver) new ResizeObserver(relayout).observe(canvas); else window.addEventListener("resize", relayout);
        if (document.fonts && document.fonts.load) document.fonts.load("bold 40px cyber").then(relayout);
    }

    start();
})();
