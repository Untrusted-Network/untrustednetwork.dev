(function () {
    "use strict";

    var REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var hero = document.getElementById("hero");

    // ─── Boot lines ────────────────────────────────────────────────────────
    // Typed lines are what the caller keys in; the others are the answers.
    var BOOT = [
        { text: "ATDT UNTRUSTEDNETWORK.DEV", typed: true },
        { text: "CONNECT 14400", typed: false },
        { text: "> MODE 0", typed: true },
        { text: "Ready", typed: false }
    ];
    var BOOT_CHAR_MS = 26, BOOT_LINE_MS = 260;
    var booting = false;

    function runBoot() {
        var el = document.getElementById("boot");
        if (!el || booting) return;
        var cursor = document.createElement("span");
        cursor.className = "cursor";
        var done = function () {
            el.textContent = BOOT.map(function (l) { return l.text; }).join("\n") + "\n";
            el.appendChild(cursor);
            hero.classList.remove("booting");
            booting = false;
        };
        if (REDUCE) { done(); return; }

        booting = true;
        hero.classList.add("booting");
        // Whatever happens to the typing, the title is never left hidden.
        var safety = setTimeout(done, 6000);
        var out = "", li = 0, ci = 0;
        var paint = function () { el.textContent = out; el.appendChild(cursor); };
        var step = function () {
            if (!booting) return;
            if (li >= BOOT.length) { clearTimeout(safety); done(); return; }
            var line = BOOT[li];
            if (line.typed && ci < line.text.length) {
                out += line.text.charAt(ci++);
                paint();
                setTimeout(step, BOOT_CHAR_MS);
                return;
            }
            if (!line.typed) out += line.text;
            out += "\n"; li++; ci = 0;
            paint();
            setTimeout(step, BOOT_LINE_MS);
        };
        paint();
        setTimeout(step, 350);
    }

    // ─── Street scene ──────────────────────────────────────────────────────
    // A stretch of Lower Streets, drawn the way the game draws it (city_render_buildings.js,
    // city_render_signage.js, cityLampPost): the numbers below are the game's own, in its pixels,
    // and K scales them to the page.
    var canvas = document.getElementById("scene");
    var ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
    var hudEl = document.getElementById("hud");
    var heatFill = document.getElementById("heatFill");

    var W = 0, H = 0, K = 1, DPR = 1;
    var layer = null;       // sky, backdrop, facades and street, drawn once per resize
    var S = null;           // layout of the current scene
    var rain = [];

    var BUILDINGS = [
        { name: "MARKET ROW",   hex: "#00DFFF", w: 620, h: 380, ent: 0 },
        { name: "PIXEL ARCADE", hex: "#FF1493", w: 560, h: 430, ent: 3 },
        { name: "SUBGRID HUB",  hex: "#8A2BE2", w: 600, h: 400, ent: 1 },
        { name: "CHIP CLINIC",  hex: "#39FF14", w: 640, h: 440, ent: 0 },
        { name: "GRID TOWER",   hex: "#00DFFF", w: 520, h: 460, ent: 3 },
        { name: "CIPHER STACK", hex: "#FF1493", w: 600, h: 410, ent: 1 }
    ];
    var GAPS = [260, 300, 240, 320, 280, 300];
    var FACADE = { winW: 18, winH: 26, gapX: 36, gapY: 46, pad: 36, storeH: 114, bayW: 60, corner: 10, edge: 4, edgeAlpha: 0.42, signY: 134, plateH: 20 };
    var FAR = [
        { body: "#160720", win: "#6a1456" },
        { body: "#0a0c1c", win: "#263a70" },
        { body: "#1c0826", win: "#86186a" }
    ];
    var LAMP = { poleH: 168, baseW: 12, baseH: 38, taperH: 10, doorW: 8, doorTop: 35, doorBot: 23 };
    // Overwatch hardware: black body, grey edge, red only in the eye and the beam.
    var CAM = { body: "#000000", edge: "#6E6E6E", eye: "#FF0000", sweep: 0.75, half: 0.2, rate: 0.45, downFor: 12, height: 150 };
    var OP = { w: 26, h: 38, speed: 150 };
    var OP_COLOURS = ["#FF1493", "#00DFFF", "#39FF14", "#FF3E00", "#8A2BE2"];
    var HEAT = { rise: 34, fall: 14, grace: 1.2, tag: 20, cam: 30 };
    var SCAN = { range: 900, time: 0.7, show: 6 };
    var TAGS = ["10 PRINT", "GOTO 10", "NO CARRIER", "+++ATH0", "READY."];
    var TAG_MAX = 8;

    var op = { x: 0, dir: 1, target: 0, wanderAt: 0, colour: 0 };
    var drone = { x: 0, y: 0 };
    var tags = [], tagNext = 0, scan = null, camDownUntil = 0;
    var heat = 0, seen = false, lastSeen = -10, lastPointer = -10, lastHud = -1;

    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    // The scene's own clock: the time of the frame being drawn. Clicks are stamped with it, since
    // performance.now() runs a little ahead of the frame time and would give a negative age.
    var clock = 0;
    function now() { return clock; }

    function rng(seed) {
        return function () {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
        };
    }

    function rgbOf(hex) {
        var n = parseInt(hex.slice(1), 16);
        return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255);
    }
    function rgba(hex, a) { return "rgba(" + rgbOf(hex) + "," + a + ")"; }

    function build() {
        var r = canvas.getBoundingClientRect();
        var oldW = W, broken = S ? S.lamps.map(function (l) { return l.broken; }) : [];
        W = Math.max(1, Math.round(r.width));
        H = Math.max(1, Math.round(r.height));
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        K = clamp(Math.min(W / 1100, H / 760), 0.62, 1.2);
        canvas.width = Math.round(W * DPR);
        canvas.height = Math.round(H * DPR);

        var rand = rng(8086);
        var gy = H - Math.round(86 * K);
        S = { gy: gy, far: [], near: [], lamps: [], cam: null };

        var x = -40 * K, w, h;
        while (x < W + 40) {
            w = (90 + rand() * 120) * K;
            h = Math.min((200 + rand() * 260) * K, H * 0.62);
            S.far.push({ x: x, w: w, h: h, pal: FAR[Math.floor(rand() * FAR.length)], seed: Math.floor(rand() * 1e6) });
            x += w + (rand() < 0.3 ? rand() * 30 * K : 0);
        }

        x = -200 * K;
        var i = 0, def, gap;
        while (x < W + 40) {
            def = BUILDINGS[i % BUILDINGS.length];
            w = def.w * K;
            h = Math.min(def.h * K, H * 0.42);
            S.near.push({ x: x, w: w, h: h, def: def, idx: i });
            gap = GAPS[i % GAPS.length] * K;
            // the lamp's light falls a little to its right, so the post stands left of the gap's middle
            S.lamps.push({ x: x + w + gap / 2 - 22 * K, broken: !!broken[i] });
            x += w + gap;
            i++;
        }

        // The camera hangs on whichever building shows most of itself.
        var best = null, bestVis = 0;
        S.near.forEach(function (b) {
            var vis = Math.min(b.x + b.w, W) - Math.max(b.x, 0);
            if (vis > bestVis) { bestVis = vis; best = b; }
        });
        if (best) {
            var lo = Math.max(best.x, 0) + 70 * K, hi = Math.min(best.x + best.w, W) - 70 * K;
            S.cam = { x: clamp(best.x + best.w * 0.8, lo, Math.max(lo, hi)), y: gy - CAM.height * K };
        }

        layer = document.createElement("canvas");
        layer.width = canvas.width;
        layer.height = canvas.height;
        var c = layer.getContext("2d");
        c.setTransform(DPR, 0, 0, DPR, 0, 0);
        drawStatic(c);

        rain.length = 0;
        var n = Math.round(W / 16);
        for (i = 0; i < n; i++) {
            rain.push({ x: Math.random() * (W + 120), y: Math.random() * H, len: (10 + Math.random() * 14) * K, spd: (300 + Math.random() * 180) * K });
        }

        tags.length = 0;
        op.x = oldW ? clamp(op.x * W / oldW, 30, W - 30) : W * 0.62;
        op.target = op.x;
        drone.x = op.x; drone.y = gy - (OP.h + 26) * K;
    }

    function line(c, x1, y1, x2, y2) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }

    function roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
        c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
        c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
        c.closePath();
    }

    function drawStatic(c) {
        var gy = S.gy;
        c.fillStyle = "#050510";
        c.fillRect(0, 0, W, H);

        S.far.forEach(function (b) {
            var rand = rng(b.seed), top = gy - b.h, wx, wy;
            c.fillStyle = b.pal.body;
            c.fillRect(b.x, top, b.w, b.h);
            c.fillStyle = b.pal.win;
            for (wx = b.x + 14 * K; wx < b.x + b.w - 16 * K; wx += 26 * K) {
                for (wy = top + 22 * K; wy < gy - 30 * K; wy += 34 * K) {
                    if (rand() < 0.22) c.fillRect(wx, wy, 8 * K, 16 * K);
                }
            }
        });

        S.near.forEach(function (b) { drawBuilding(c, b); });

        // Street: kerb line, lane dashes and the two service conduits under it. The foot of the band
        // is left clear for the HEAT readout.
        var sh = H - gy, x;
        c.fillStyle = "#0a0a14";
        c.fillRect(0, gy, W, sh);
        c.fillStyle = "#3a2a66";
        c.fillRect(0, gy, W, 2);
        c.fillStyle = "#22222e";
        for (x = 10; x < W; x += 62 * K) c.fillRect(x, gy + sh * 0.2, 22 * K, 2);
        c.fillStyle = "rgba(0,160,190,0.45)";
        c.fillRect(0, gy + sh * 0.38, W, 2);
        for (x = 90; x < W; x += 300 * K) c.fillRect(x, gy + sh * 0.38 - 2, 6, 6);
        c.fillStyle = "rgba(200,110,20,0.4)";
        c.fillRect(0, gy + sh * 0.54, W, 2);
        for (x = 240; x < W; x += 300 * K) c.fillRect(x, gy + sh * 0.54 - 2, 6, 6);
    }

    // One facade, in the game's pixels with the origin at its foot on the street.
    function drawBuilding(c, b) {
        var F = FACADE, hex = b.def.hex, w = b.w / K, h = b.h / K, top = -h, sfTop = -F.storeH;
        var doorX = w / 2, col, row, x, y;
        c.save();
        c.translate(b.x, S.gy);
        c.scale(K, K);

        c.fillStyle = "#0b0718";
        c.fillRect(0, top, w, h);
        c.fillStyle = rgba(hex, 0.03);
        c.fillRect(0, top, w, h);

        // The window grid, padded evenly, with no window behind the name plate.
        c.font = "bold 11px cyber, monospace";
        var textW = c.measureText(b.def.name).width;
        var signY = Math.max(-F.signY, top + 12 + F.plateH / 2);
        var boxL = doorX - textW / 2 - 18, boxR = doorX + textW / 2 + 18, boxT = signY - F.plateH / 2 - 4;
        var ncols = Math.max(1, Math.floor((w - 2 * F.pad - F.winW) / F.gapX) + 1);
        var padX = (w - ((ncols - 1) * F.gapX + F.winW)) / 2;
        var zoneH = h - F.storeH;
        var nrows = Math.max(1, Math.floor((zoneH - 2 * F.pad - F.winH) / F.gapY) + 1);
        var padY = (zoneH - ((nrows - 1) * F.gapY + F.winH)) / 2;
        c.lineWidth = 1;
        for (row = 0; row < nrows; row++) {
            y = top + padY + row * F.gapY;
            for (col = 0; col < ncols; col++) {
                x = padX + col * F.gapX;
                if (x < boxR && x + F.winW > boxL && y + F.winH > boxT) continue;
                if (Math.sin(col * 7.3 + row * 4.7 + b.idx * 13.1) > 0.35) {
                    c.fillStyle = rgba(hex, 0.3);
                    c.fillRect(x, y, F.winW, F.winH);
                } else {
                    c.strokeStyle = rgba(hex, 0.1);
                    c.strokeRect(x, y, F.winW, F.winH);
                }
            }
        }

        // Ground storey: fascia line, glazed bays either side of the door, the entrance.
        c.fillStyle = "#0b0718";
        c.fillRect(0, sfTop, w, F.storeH);
        c.strokeStyle = rgba(hex, 0.45);
        c.lineWidth = 1.5;
        line(c, 0, sfTop, w, sfTop);
        var seed = rng(b.idx * 977 + 5);
        var bays = function (startX, spaceW) {
            var n = Math.floor((spaceW - 30) / F.bayW);
            if (n < 1) return;
            var x0 = startX + (spaceW - (n * F.bayW - 8)) / 2, bw = F.bayW - 14, i, sx;
            for (i = 0; i < n; i++) {
                sx = x0 + i * F.bayW;
                if (seed() > 0.42) { c.fillStyle = rgba(hex, 0.09); c.fillRect(sx, sfTop + 16, bw, F.storeH - 28); }
                c.strokeStyle = rgba(hex, 0.32);
                c.lineWidth = 1;
                c.strokeRect(sx, sfTop + 16, bw, F.storeH - 28);
                line(c, sx + bw / 2, sfTop + 16, sx + bw / 2, -12);
                if (seed() > 0.5) { c.fillStyle = rgba(hex, 0.35); c.fillRect(sx + 4, sfTop + 5, bw - 8, 2); }
                if (i < n - 1) { c.fillStyle = rgba(hex, 0.18); c.fillRect(sx + bw + 2, sfTop + 12, 10, F.storeH - 20); }
            }
        };
        bays(4, doorX - 36 - 4);
        bays(doorX + 36, w - 4 - (doorX + 36));

        c.fillStyle = "#06040e";
        c.fillRect(doorX - 22, -64, 44, 64);
        c.strokeStyle = rgba(hex, 0.3);
        c.lineWidth = 1;
        c.strokeRect(doorX - 22, -64, 44, 64);
        line(c, doorX, -64, doorX, 0);
        drawEntrance(c, b.def.ent, doorX, hex);

        c.strokeStyle = rgba(hex, 0.4);
        c.lineWidth = 1.5;
        line(c, 0, 0, w, 0);

        // Roof: a dark cap and the deck rail.
        c.fillStyle = "#141028";
        c.fillRect(0, top - 4, w, 4);
        c.strokeStyle = rgba(hex, 0.3);
        c.lineWidth = 1;
        line(c, 14, top - 18, w - 14, top - 18);
        for (x = 14; x <= w - 13.5; x += (w - 28) / Math.round((w - 28) / 46)) line(c, x, top - 18, x, top - 4);

        // The frame, last: both sides and the roof line as one stroke with true arcs at the corners.
        var fw = F.edge, cr = F.corner, lx = fw / 2, rx = w - fw / 2, ty = top + fw / 2;
        c.strokeStyle = rgba(hex, F.edgeAlpha);
        c.lineWidth = fw;
        c.lineJoin = "round";
        c.beginPath();
        c.moveTo(lx, 0);
        c.lineTo(lx, ty + cr);
        c.arc(lx + cr, ty + cr, cr, Math.PI, 1.5 * Math.PI);
        c.lineTo(rx - cr, ty);
        c.arc(rx - cr, ty + cr, cr, 1.5 * Math.PI, 2 * Math.PI);
        c.lineTo(rx, 0);
        c.stroke();

        // The name plate, mounted over the door.
        c.strokeStyle = "#251d38";
        c.lineWidth = 2;
        line(c, doorX, signY + F.plateH / 2, doorX, signY + F.plateH / 2 + 10);
        c.fillStyle = "rgba(4,2,10,0.9)";
        c.fillRect(doorX - textW / 2 - 12, signY - F.plateH / 2, textW + 24, F.plateH);
        c.strokeStyle = hex;
        c.lineWidth = 1.5;
        c.shadowBlur = 2 * K * DPR;
        c.shadowColor = hex;
        c.strokeRect(doorX - textW / 2 - 12, signY - F.plateH / 2, textW + 24, F.plateH);
        c.shadowBlur = 0;
        c.fillStyle = hex;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(b.def.name, doorX, signY + 1);
        c.restore();
    }

    function drawEntrance(c, type, cx, hex) {
        var dTop = -64, hw = 30;
        c.strokeStyle = rgba(hex, 0.55);
        c.lineWidth = 2;
        if (type === 0) {                   // arched portal
            c.beginPath();
            c.moveTo(cx - hw, 0); c.lineTo(cx - hw, dTop + 8);
            c.arc(cx, dTop + 8, hw, Math.PI, 0);
            c.lineTo(cx + hw, 0); c.stroke();
        } else if (type === 1) {            // stepped pillars and a lintel bar
            c.strokeRect(cx - hw, dTop - 4, 9, 68);
            c.strokeRect(cx + hw - 9, dTop - 4, 9, 68);
            c.fillStyle = rgba(hex, 0.45);
            c.fillRect(cx - hw, dTop - 12, hw * 2, 6);
        } else {                            // recessed double frame
            c.strokeRect(cx - hw, dTop - 6, hw * 2, 70);
            c.strokeStyle = rgba(hex, 0.22);
            c.strokeRect(cx - hw - 5, dTop - 11, hw * 2 + 10, 75);
        }
    }

    // The game's streetlight: a wide base with an access door, tapering into the pole.
    // A broken one is dark, its door hanging open with a cable out.
    function drawLamp(lamp) {
        var P = LAMP, hw = P.baseW / 2, top = -P.baseH, ph = P.poleH;
        ctx.save();
        ctx.translate(lamp.x, S.gy - 1);
        ctx.scale(K, K);
        ctx.strokeStyle = "#2a2140"; ctx.lineWidth = 4; ctx.lineCap = "butt";
        ctx.beginPath(); ctx.moveTo(0, top - P.taperH + 1); ctx.lineTo(0, -ph); ctx.lineTo(22, -ph); ctx.stroke();
        ctx.fillStyle = "#241c38";
        ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(-hw, top); ctx.lineTo(-2, top - P.taperH); ctx.lineTo(2, top - P.taperH);
        ctx.lineTo(hw, top); ctx.lineTo(hw, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#3d3358"; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#2f2647"; ctx.fillRect(-hw - 1, -4, P.baseW + 2, 4);
        var dx = -P.doorW / 2, dy = -P.doorTop, dh = P.doorTop - P.doorBot;
        if (!lamp.broken) {
            ctx.fillStyle = "#1a1428"; ctx.fillRect(dx, dy, P.doorW, dh);
            ctx.strokeStyle = "#4a3f66"; ctx.strokeRect(dx + 0.5, dy + 0.5, P.doorW - 1, dh - 1);
            ctx.fillStyle = "#3a3050"; ctx.fillRect(dx + 2, dy + 3, P.doorW - 4, 1); ctx.fillRect(dx + 2, dy + 6, P.doorW - 4, 1);
            ctx.fillStyle = "#6a5a8a"; ctx.fillRect(dx + P.doorW - 3, dy + dh - 3, 1, 1);
        } else {
            ctx.fillStyle = "#05040a"; ctx.fillRect(dx, dy, P.doorW, dh);
            ctx.strokeStyle = "rgba(255,179,0,0.8)"; ctx.beginPath(); ctx.moveTo(dx + 1.5, dy + 2); ctx.lineTo(dx + 4, dy + 6); ctx.lineTo(dx + 2, dy + 9); ctx.stroke();
            ctx.strokeStyle = "#4a3f66"; ctx.beginPath();
            ctx.moveTo(dx + P.doorW, dy); ctx.lineTo(dx + P.doorW + 6, dy - 2); ctx.lineTo(dx + P.doorW + 6, dy + dh + 2); ctx.lineTo(dx + P.doorW, dy + dh); ctx.stroke();
            ctx.strokeStyle = "#3a3050"; ctx.lineWidth = 1.2; ctx.beginPath();
            ctx.moveTo(dx + 5, dy + dh - 1); ctx.quadraticCurveTo(12, -16, 9, -6); ctx.stroke();
        }

        // the lamp head, and its light when it works
        ctx.fillStyle = lamp.broken ? "#1c2434" : "#00DFFF";
        if (!lamp.broken) { ctx.shadowBlur = 3 * K * DPR; ctx.shadowColor = "#00DFFF"; }
        ctx.beginPath();
        ctx.moveTo(14, -ph - 3); ctx.lineTo(34, -ph - 3); ctx.lineTo(38, -ph + 1); ctx.lineTo(38, -ph + 2); ctx.lineTo(14, -ph + 2);
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        if (!lamp.broken) {
            var g = ctx.createLinearGradient(22, -ph, 22, 0);
            g.addColorStop(0, "rgba(0,223,255,0.16)");
            g.addColorStop(1, "rgba(0,223,255,0)");
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.moveTo(22, -ph); ctx.lineTo(132, 0); ctx.lineTo(-88, 0); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
    }

    function camIsDown(t) { return t < camDownUntil; }

    function drawCamera(t) {
        var cam = S.cam, gy = S.gy, drop = gy - cam.y, down = camIsDown(t);
        var angle = down ? 0.95 : Math.sin(t * CAM.rate) * CAM.sweep, cone = null;
        ctx.save();
        if (!down) {
            var x1 = cam.x + Math.tan(angle - CAM.half) * drop;
            var x2 = cam.x + Math.tan(angle + CAM.half) * drop;
            ctx.fillStyle = seen ? "rgba(255,0,0,0.22)" : "rgba(255,0,0,0.12)";
            ctx.strokeStyle = "rgba(255,40,40,0.35)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cam.x, cam.y); ctx.lineTo(x1, gy); ctx.lineTo(x2, gy);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            cone = { x1: Math.min(x1, x2), x2: Math.max(x1, x2) };
        }
        ctx.strokeStyle = CAM.edge;
        ctx.lineWidth = 2;
        line(ctx, cam.x, cam.y - 12 * K, cam.x, cam.y);
        ctx.translate(cam.x, cam.y);
        ctx.rotate(-angle);
        ctx.fillStyle = CAM.body;
        ctx.lineWidth = 1.5;
        ctx.fillRect(-5 * K, -4 * K, 10 * K, 18 * K);
        ctx.strokeRect(-5 * K, -4 * K, 10 * K, 18 * K);
        ctx.fillStyle = down ? "#3a0000" : CAM.eye;
        ctx.fillRect(-2 * K, 12 * K, 4 * K, 3 * K);
        ctx.restore();
        return cone;
    }

    function drawTags(t) {
        tags.forEach(function (g) {
            var p = clamp((t - g.t0) / 0.5, 0, 1), size = Math.max(11, 15 * K), i;
            ctx.save();
            ctx.translate(g.x, g.y);
            ctx.rotate(g.rot);
            ctx.font = "bold " + size.toFixed(1) + "px cyber, monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            var tw = ctx.measureText(g.text).width;
            ctx.beginPath();
            ctx.rect(-tw / 2 - 4, -size, (tw + 8) * p, size * 4);
            ctx.clip();
            ctx.globalAlpha = 0.88;
            ctx.fillStyle = g.col;
            ctx.fillText(g.text, 0, 0);
            for (i = 0; i < g.drips.length; i++) {
                ctx.fillRect(-tw / 2 + g.drips[i].at * tw, size * 0.35, 1.5 * K, g.drips[i].len * K * p);
            }
            ctx.restore();
        });
    }

    function drawOperator() {
        var gy = S.gy, w = OP.w * K, h = OP.h * K, x = op.x - w / 2, y = gy - h, col = OP_COLOURS[op.colour];
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(x - 2 * K, gy, w + 4 * K, 3);
        ctx.shadowColor = rgba(col, 0.6);
        ctx.shadowBlur = 12 * DPR;
        ctx.fillStyle = col;
        roundRect(ctx, x, y, w, h, 4 * K);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#FFFFFF";
        var ex = op.x + op.dir * 3 * K, es = 3.5 * K;
        ctx.fillRect(ex - 6 * K, y + 9 * K, es, es);
        ctx.fillRect(ex + 2.5 * K, y + 9 * K, es, es);
        ctx.restore();
    }

    function drawDrone() {
        ctx.save();
        ctx.strokeStyle = "#19d3ff";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(drone.x, drone.y, 6 * K, 0, Math.PI * 2); ctx.stroke();
        line(ctx, drone.x - 13 * K, drone.y, drone.x - 7 * K, drone.y);
        line(ctx, drone.x + 7 * K, drone.y, drone.x + 13 * K, drone.y);
        ctx.fillStyle = "#39FF14";
        ctx.beginPath(); ctx.arc(drone.x, drone.y, 2.5 * K, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    // The scanner's pulse: a ring out from the operator, then a tag on whatever it reached.
    function scanTargets(t) {
        var out = S.lamps.map(function (l) {
            return { x: l.x + 26 * K, y: S.gy - LAMP.poleH * K, label: l.broken ? "STREETLIGHT // FAULT" : "STREETLIGHT // OK" };
        });
        if (S.cam) out.push({ x: S.cam.x, y: S.cam.y + 6 * K, label: camIsDown(t) ? "CAMERA // DISABLED" : "CAMERA // LIVE", red: true });
        return out;
    }

    function drawScan(t) {
        if (!scan) return;
        var age = Math.max(0, t - scan.t0), reach = Math.min(1, age / SCAN.time) * SCAN.range * K;
        if (age > SCAN.show) { scan = null; return; }
        ctx.save();
        if (age < SCAN.time) {
            ctx.strokeStyle = "rgba(0,223,255," + (0.6 * (1 - age / SCAN.time)).toFixed(3) + ")";
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(scan.x, scan.y, reach, 0, Math.PI * 2); ctx.stroke();
        }
        var fade = clamp((SCAN.show - age) / 0.6, 0, 1), s = 11 * K;
        ctx.font = "600 " + Math.max(9, 9 * K).toFixed(1) + "px 'Source Code Pro', monospace";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 1.5;
        scanTargets(t).forEach(function (g) {
            if (Math.abs(g.x - scan.x) > reach || g.x < 8 || g.x > W - 8) return;
            ctx.globalAlpha = fade;
            ctx.strokeStyle = ctx.fillStyle = g.red ? "#FF3B3B" : "#00DFFF";
            ctx.beginPath();
            ctx.moveTo(g.x - s, g.y - s + 4); ctx.lineTo(g.x - s, g.y - s); ctx.lineTo(g.x - s + 4, g.y - s);
            ctx.moveTo(g.x + s - 4, g.y - s); ctx.lineTo(g.x + s, g.y - s); ctx.lineTo(g.x + s, g.y - s + 4);
            ctx.moveTo(g.x + s, g.y + s - 4); ctx.lineTo(g.x + s, g.y + s); ctx.lineTo(g.x + s - 4, g.y + s);
            ctx.moveTo(g.x - s + 4, g.y + s); ctx.lineTo(g.x - s, g.y + s); ctx.lineTo(g.x - s, g.y + s - 4);
            ctx.stroke();
            var tw = ctx.measureText(g.label).width, left = g.x + s + 6 + tw > W - 10;
            ctx.textAlign = left ? "right" : "left";
            ctx.fillText(g.label, left ? g.x - s - 6 : g.x + s + 6, g.y);
        });
        ctx.restore();
    }

    function drawRain(dt) {
        ctx.save();
        ctx.strokeStyle = "rgba(57,255,20,0.26)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 0; i < rain.length; i++) {
            var d = rain[i];
            d.y += d.spd * dt; d.x -= d.spd * 0.16 * dt;
            if (d.y > S.gy) { d.y = -d.len; d.x = Math.random() * (W + 120); }
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d.x - d.len * 0.16, d.y + d.len);
        }
        ctx.stroke();
        ctx.restore();
    }

    function update(t, dt) {
        // Follows the pointer while there is one; otherwise it wanders.
        if (t - lastPointer > 4 && t > op.wanderAt) {
            op.target = 40 + Math.random() * (W - 80);
            op.wanderAt = t + 3 + Math.random() * 4;
        }
        var dx = op.target - op.x;
        if (Math.abs(dx) > 4) {
            op.dir = dx > 0 ? 1 : -1;
            op.x += op.dir * Math.min(Math.abs(dx), OP.speed * K * dt);
        }
        var tx = op.x - op.dir * 24 * K, ty = S.gy - (OP.h + 24) * K + Math.sin(t * 2.2) * 3 * K;
        var f = Math.min(1, dt * 5);
        drone.x += (tx - drone.x) * f;
        drone.y += (ty - drone.y) * f;
    }

    function updateHeat(t, dt, cone) {
        seen = !!cone && op.x > cone.x1 && op.x < cone.x2;
        if (seen) { heat += HEAT.rise * dt; lastSeen = t; }
        else if (t - lastSeen > HEAT.grace) heat -= HEAT.fall * dt;
        heat = clamp(heat, 0, 100);
        var shown = Math.round(heat) * 2 + (seen ? 1 : 0);
        if (shown !== lastHud && hudEl && heatFill) {
            lastHud = shown;
            heatFill.style.width = Math.round(heat) + "%";
            hudEl.classList.toggle("seen", seen);
        }
    }

    function frame(t, dt) {
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(layer, 0, 0, W, H);
        drawTags(t);
        S.lamps.forEach(drawLamp);
        var cone = S.cam ? drawCamera(t) : null;
        drawOperator();
        drawDrone();
        drawScan(t);
        if (dt > 0) drawRain(dt);
        return cone;
    }

    // ─── Things that answer a click ────────────────────────────────────────
    // Nothing marks them (the game's rule for secrets). The operator changes colour, and the page's
    // edge with it; the drone pulses the scanner; the camera burns out for a while, or comes back;
    // a streetlight breaks or is mended; a bare wall takes a tag.
    function setOperatorColour(i) {
        op.colour = i % OP_COLOURS.length;
        var root = document.documentElement.style;
        root.setProperty("--op", OP_COLOURS[op.colour]);
        root.setProperty("--op-rgb", rgbOf(OP_COLOURS[op.colour]));
    }

    function near(x, y, tx, ty, r) { return Math.abs(x - tx) <= r && Math.abs(y - ty) <= r; }

    function sprayAt(x, y, t) {
        var F = FACADE, hit = null;
        S.near.forEach(function (b) { if (x > b.x && x < b.x + b.w && y > S.gy - b.h && y < S.gy) hit = b; });
        if (!hit) return;
        var text = TAGS[tagNext++ % TAGS.length];
        ctx.save();
        ctx.font = "bold " + Math.max(11, 15 * K).toFixed(1) + "px cyber, monospace";
        var half = ctx.measureText(text).width / 2 + 10 * K;
        ctx.restore();
        if (hit.w < half * 2 + 8) return;
        var tx = clamp(x, hit.x + half, hit.x + hit.w - half);
        var ty = clamp(y, S.gy - hit.h + 22 * K, S.gy - 20 * K);
        // doors refuse it
        if (Math.abs(tx - (hit.x + hit.w / 2)) < 36 * K + half && ty > S.gy - 90 * K) ty = S.gy - (F.storeH + 26) * K;
        var r = rng(Math.floor(x * 31 + y * 17) + tagNext);
        tags.push({ x: tx, y: ty, text: text, col: OP_COLOURS[op.colour], rot: (r() - 0.5) * 0.16, t0: t,
            drips: [{ at: 0.15 + r() * 0.2, len: 6 + r() * 12 }, { at: 0.55 + r() * 0.3, len: 4 + r() * 9 }] });
        if (tags.length > TAG_MAX) tags.shift();
        if (seen) heat = clamp(heat + HEAT.tag, 0, 100);
    }

    function onClick(e) {
        var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, t = now(), i, l;
        var pad = Math.max(16, 16 * K);
        if (near(x, y, op.x, S.gy - OP.h * K / 2, Math.max(pad, OP.h * K / 2 + 4))) { setOperatorColour(op.colour + 1); return; }
        if (near(x, y, drone.x, drone.y, pad)) { scan = { t0: t, x: op.x, y: S.gy - OP.h * K / 2 }; return; }
        if (S.cam && near(x, y, S.cam.x, S.cam.y + 4 * K, pad)) {
            if (camIsDown(t)) camDownUntil = 0;
            else { camDownUntil = t + CAM.downFor; if (seen) heat = clamp(heat + HEAT.cam, 0, 100); }
            return;
        }
        for (i = 0; i < S.lamps.length; i++) {
            l = S.lamps[i];
            if ((Math.abs(x - l.x) <= pad && y > S.gy - LAMP.poleH * K - 8 && y < S.gy) || near(x, y, l.x + 26 * K, S.gy - LAMP.poleH * K, pad)) {
                l.broken = !l.broken;
                return;
            }
        }
        sprayAt(x, y, t);
    }

    function startScene() {
        if (!ctx) return;
        build();

        // Watches the canvas itself: its box can change without a window resize.
        var resizeTimer = 0;
        var onResize = function () {
            var r = canvas.getBoundingClientRect();
            if (Math.round(r.width) === W && Math.round(r.height) === H) return;
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () { build(); if (REDUCE) frame(0.9, 0); }, 120);
        };
        if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);
        else window.addEventListener("resize", onResize);
        // The sign lettering needs the display face; redraw once it has loaded.
        if (document.fonts && document.fonts.load) {
            document.fonts.load("bold 11px cyber").then(function () { build(); if (REDUCE) frame(0.9, 0); });
        }

        if (REDUCE) { frame(0.9, 0); return; }

        var point = function (e) {
            var r = canvas.getBoundingClientRect();
            op.target = clamp(e.clientX - r.left, 20, W - 20);
            lastPointer = now();
        };
        hero.addEventListener("pointermove", point);
        hero.addEventListener("pointerdown", point);
        canvas.addEventListener("click", onClick);

        var last = 0;
        var loop = function (ms) {
            requestAnimationFrame(loop);
            var t = ms / 1000, dt = Math.min(0.05, last ? t - last : 0);
            last = t;
            clock = t;
            update(t, dt);
            updateHeat(t, dt, frame(t, dt));
        };
        requestAnimationFrame(loop);
    }

    // The footer hangs up; a click on it dials in again.
    var hangUp = document.getElementById("hangUp");
    if (hangUp && !REDUCE) {
        hangUp.addEventListener("click", function () {
            if (booting) return;
            window.scrollTo(0, 0);
            runBoot();
        });
    }

    runBoot();
    startScene();
})();
