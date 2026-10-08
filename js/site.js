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
    var copyEl = document.querySelector(".hero-copy"), barEl = document.querySelector(".bar"), copySig = "";

    // Where the words are, relative to the canvas: one box per line of copy.
    function copyBoxes(r) {
        var kids = copyEl ? Array.prototype.slice.call(copyEl.children) : [];
        return kids.map(function (el) {
            var q = el.getBoundingClientRect();
            return { l: Math.round(q.left - r.left), r: Math.round(q.right - r.left), b: Math.round(q.bottom - r.top) };
        });
    }
    function boxesSig(boxes) { return boxes.map(function (q) { return q.l + "," + q.r + "," + q.b; }).join(";"); }

    var BUILDINGS = [
        { name: "MARKET ROW",   hex: "#00DFFF", w: 620, h: 450, ent: 0, roof: [[0.2, "junction"], [0.5, "beacon"], [0.8, "junction"]] },
        { name: "PIXEL ARCADE", hex: "#FF1493", w: 560, h: 560, ent: 3, tall: true, roof: [[0.2, "dishbox"], [0.5, "tank"], [0.82, "beacon"]],
          posters: [{ side: -1, yf: 0.28, art: "overdrive", title: "OVERDRIVE", col: "#FF1493" }, { side: -1, yf: 0.6, art: "shatter", title: "SHATTER", col: "#FF8C00" }] },
        { name: "SUBGRID HUB",  hex: "#8A2BE2", w: 600, h: 400, ent: 1, roof: [[0.2, "tank"], [0.5, "junction"], [0.82, "ventbox"]] },
        { name: "CHIP CLINIC",  hex: "#39FF14", w: 640, h: 440, ent: 0, roof: [[0.2, "beacon"], [0.5, "dishbox"], [0.82, "junction"]] },
        { name: "GRID TOWER",   hex: "#00DFFF", w: 520, h: 460, ent: 3, roof: [[0.2, "ventbox"], [0.5, "junction"], [0.82, "tank"]] },
        { name: "CIPHER STACK", hex: "#FF1493", w: 600, h: 410, ent: 1, roof: [[0.2, "junction"], [0.5, "ventbox"], [0.82, "dishbox"]] }
    ];
    // The game's five roof gadgets and how far each rises above the deck, in its pixels. One that
    // would reach the words above it gives way to a plant cabinet, the only low one, or is left off.
    var ROOF_H = { junction: 52, beacon: 100, ventbox: 110, tank: 140, dishbox: 144 };
    // the room kept above a roof, where the screen has it: enough for the tallest gadget planned for it
    function roofSpace(def) {
        return def.roof.reduce(function (m, g) { return Math.max(m, ROOF_H[g[1]]); }, 0) + 8;
    }
    var POSTER = { w: 56, h: 74, off: 16 };
    // Street furniture for each gap between buildings, as [distance from the gap's start, kind]. The
    // streetlight stands near the middle; everything keeps clear of it and of the walls either side.
    var STREET = [
        [[54, "bench"], [176, "vending"], [226, "bin"]],
        [[50, "tree"], [205, "cabinet"], [262, "bin"]],
        [[40, "bin"], [170, "bench"]],
        [[48, "vending"], [230, "bench"], [290, "bin"]],
        [[62, "cabinet"], [200, "tree"]],
        [[60, "bench"], [200, "vending"], [252, "bin"]]
    ];
    var VEND_BRANDS = [
        { name: "COOLANT+", col: "#7CF9FF", stock: ["#7CF9FF", "#39FF14", "#FFFFFF"] },
        { name: "SYNTH SNAX", col: "#FF7A00", stock: ["#FF7A00", "#FFD24A", "#FF1493"] },
        { name: "VOLTAIC", col: "#FFD24A", stock: ["#FFD24A", "#00DFFF", "#B14FFF"] },
        { name: "NEON NOODLES", col: "#FF1493", stock: ["#FF1493", "#FFFFFF", "#7CF9FF"] }
    ];
    var CABINET_STREET = { body: "#0f2418", face: "#143222", edge: "#2FBF71", dim: "rgba(47,191,113,0.45)" };
    var CABINET_ROOF = { body: "#171b20", face: "#20252c", edge: "#8A96A3", dim: "rgba(138,150,163,0.45)" };
    var GAPS = [260, 300, 240, 320, 280, 300];
    var FACADE = { winW: 18, winH: 26, gapX: 36, gapY: 46, pad: 36, padMin: 14, storeH: 114, bayW: 60, corner: 10, edge: 4, edgeAlpha: 0.42, signY: 134, plateH: 20 };
    var FAR = [
        { body: "#160720", win: "#6a1456" },
        { body: "#0a0c1c", win: "#263a70" },
        { body: "#1c0826", win: "#86186a" }
    ];
    var LAMP = { poleH: 168, baseW: 12, baseH: 38, taperH: 10, doorW: 8, doorTop: 35, doorBot: 23 };
    // Overwatch hardware: black body, grey edge, red only in the eye and the beam.
    var CAM = { body: "#000000", edge: "#6E6E6E", eye: "#FF0000", sweep: 0.75, half: 0.2, rate: 0.45, downFor: 12, height: 150 };
    var OP = { w: 26, h: 38, speed: 150, still: 48 };     // still: how near the pointer may come before the operator stops following
    var OP_COLOURS = ["#FF1493", "#00DFFF", "#39FF14", "#FF3E00", "#8A2BE2"];
    var HEAT = { rise: 34, fall: 14, grace: 1.2, tag: 20, cam: 30 };
    var SCAN = { range: 900, time: 0.7, show: 6 };
    var TAGS = ["10 PRINT", "GOTO 10", "NO CARRIER", "+++ATH0", "READY."];
    var TAG_MAX = 8;

    var op = { x: 0, dir: 1, target: 0, wanderAt: 0, colour: 0 };
    var drone = { x: 0, y: 0 };
    var tags = [], tagNext = 0, scan = null, camDownUntil = 0;
    var heat = 0, seen = false, lastSeen = -10, lastPointer = -10, lastHud = -1, pointerIn = false;

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
        K = clamp(Math.min(W / 1100, H / 760), 0.62, 1.05);
        canvas.width = Math.round(W * DPR);
        canvas.height = Math.round(H * DPR);

        var rand = rng(8086);
        var gy = H - Math.round(86 * K);
        // The skyline stays under the words. Each stretch of street has its own ceiling: the lowest
        // line of copy above it, or the header where there is none, so a building beside the text
        // may stand taller than one beneath it.
        var boxes = copyBoxes(r), barBottom = barEl ? Math.round(barEl.getBoundingClientRect().bottom - r.top) : 40;
        copySig = boxesSig(boxes);
        var roomOver = function (x0, x1) {
            var ceiling = barBottom;
            boxes.forEach(function (q) { if (q.r > q.l && q.r > x0 - 16 && q.l < x1 + 16) ceiling = Math.max(ceiling, q.b); });
            return gy - ceiling - 22;
        };
        S = { gy: gy, far: [], near: [], lamps: [], props: [], cam: null };

        var x = -40 * K, w, h;
        while (x < W + 40) {
            w = (90 + rand() * 120) * K;
            h = Math.max(60 * K, Math.min((200 + rand() * 260) * K, roomOver(x, x + w) * (0.72 + rand() * 0.28), H * 0.62));
            S.far.push({ x: x, w: w, h: h, pal: FAR[Math.floor(rand() * FAR.length)], seed: Math.floor(rand() * 1e6) });
            x += w + (rand() < 0.3 ? rand() * 30 * K : 0);
        }

        // On a wide screen the street is slid along so the second building, the arcade, starts just
        // past the end of the words, where it can stand at its full height. If that leaves bare
        // street at the left edge, one more building goes in before the first.
        var count = BUILDINGS.length, copyRight = 0, i = 0, def, gap, room, slot;
        boxes.forEach(function (q) { copyRight = Math.max(copyRight, q.r); });
        x = -200 * K;
        if (W - copyRight > 300 * K) x = Math.max(x, copyRight + 24 - (BUILDINGS[0].w + GAPS[0]) * K);
        if (x > -40 * K) { i = -1; x -= (BUILDINGS[count - 1].w + GAPS[count - 1]) * K; }
        while (x < W + 40) {
            slot = ((i % count) + count) % count;
            def = BUILDINGS[slot];
            w = def.w * K;
            // a facade keeps its ground storey and a row of windows; the rest of the room is for its roof
            room = roomOver(x, x + w);
            h = Math.max(150 * K, Math.min(def.h * K, room - roofSpace(def) * K));
            S.near.push({ x: x, w: w, h: h, def: def, idx: i, room: room });
            gap = GAPS[slot] * K;
            S.props.push({ x: x + w, set: STREET[slot], idx: slot });
            // the lamp's light falls a little to its right, so the post stands left of the gap's middle
            S.lamps.push({ x: x + w + gap / 2 - 22 * K, broken: !!broken[S.lamps.length] });
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
            S.cam = { x: clamp(best.x + best.w * 0.8, lo, Math.max(lo, hi)), y: gy - Math.min(CAM.height * K, best.h - 30 * K) };
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
        S.props.forEach(function (g) {
            g.set.forEach(function (it) {
                c.save();
                c.translate(g.x + it[0] * K, gy - 1);
                c.scale(K, K);
                STREET_DRAW[it[1]](c, g.idx);
                c.restore();
            });
        });

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
        // a short wall closes up its top and bottom padding to fit another row or two
        if (nrows < 3) nrows = Math.max(nrows, Math.min(3, Math.floor((zoneH - 2 * F.padMin - F.winH) / F.gapY) + 1));
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

        // Roof: a dark cap, whatever stands on the deck, and the deck rail.
        c.fillStyle = "#141028";
        c.fillRect(0, top - 4, w, 4);
        var spare = (b.room - b.h) / K - 6;
        b.def.roof.forEach(function (g, gi) {
            var kind = g[1];
            if (ROOF_H[kind] > spare) kind = "junction";
            if (ROOF_H[kind] > spare) return;
            c.save();
            c.translate(w * g[0], top - 4);
            ROOF_DRAW[kind](c, hex, Math.abs(b.idx * 7 + gi));
            c.restore();
        });
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

        // Game posters on hoardings off the building's edge, where the wall is tall enough for them.
        (b.def.posters || []).forEach(function (p) {
            var py = top + h * p.yf;
            if (py + POSTER.h > sfTop - 12) return;
            var edge = p.side === 1 ? w : 0, inner = edge + p.side * POSTER.off, px = p.side === 1 ? inner : inner - POSTER.w;
            c.strokeStyle = "#2a2142"; c.lineWidth = 2.5; c.shadowBlur = 0;
            c.beginPath();
            c.moveTo(edge, py + 12); c.lineTo(inner, py + 12);
            c.moveTo(edge, py + POSTER.h - 12); c.lineTo(inner, py + POSTER.h - 12);
            c.moveTo(edge, py + 12); c.lineTo(inner, py + POSTER.h - 12);
            c.stroke();
            c.save();
            c.translate(px + POSTER.w / 2, py + POSTER.h / 2);
            c.scale(POSTER.w / 44, POSTER.w / 44);
            drawPoster(c, p);
            c.restore();
        });
        c.restore();
    }

    // A game poster in the game's own 44 by 56 format: the art, a tinted foot and the title.
    var POSTER_ART = {
        overdrive: { bg: "#0D0320", draw: function (c) {
            var bands = ["#FFD700", "#FF8C00", "#FF5F5F", "#FF1493"], k, y;
            pRect(c, -19, -25, 38, 12, "#1A0636");
            c.save();                                                       // the banded sun on the horizon
            c.beginPath(); c.rect(-19, -25, 38, 19); c.clip();
            c.beginPath(); c.arc(0, -6, 11, 0, Math.PI * 2); c.clip();
            for (k = 0; k < 4; k++) pRect(c, -11, -17 + k * 2.9, 22, 2.9, bands[k]);
            c.fillStyle = "#0D0320";
            for (k = 0; k < 3; k++) c.fillRect(-11, -9.5 + k * 1.4, 22, 0.3 + k * 0.25);
            c.restore();
            pPoly(c, [-19, -6, -14, -11, -9, -7, -4, -12, 1, -6], null, "#3A0F5C");
            pPoly(c, [4, -6, 10, -12, 15, -8, 19, -11, 19, -6], null, "#3A0F5C");
            pRect(c, -19, -6, 38, 21, "#07020E");
            pLine(c, [-19, -6, 19, -6], "#FF1493", 0.8);
            for (k = 0; k < 4; k++) { y = -4 + k * k * 1.6; pLine(c, [-19, y, 19, y], "rgba(0,223,255,0.25)", 0.5); }
            pPoly(c, [-1.2, -6, 1.2, -6, 18, 15, -18, 15], null, "#16161E");   // the road
            pLine(c, [-1.2, -6, -18, 15], "#FF1493", 0.9);
            pLine(c, [1.2, -6, 18, 15], "#FF1493", 0.9);
            c.setLineDash([2, 2.5]);
            pLine(c, [0, -5, 0, 15], "rgba(255,215,0,0.8)", 0.6);
            c.setLineDash([]);
            pRect(c, -5, 8, 10, 4, "#25253A");                               // the car
            pRect(c, -4, 6.5, 8, 2, "#3A3A55");
            pRect(c, -5, 9, 2.2, 1.2, "#FF3E3E");
            pRect(c, 2.8, 9, 2.2, 1.2, "#FF3E3E");
        } },
        shatter: { bg: "#0B0610", draw: function (c) {
            var rows = ["#FF3E3E", "#FF8C00", "#FFD700", "#39FF14", "#00DFFF"];
            var gone = { "1_2": 1, "2_2": 1, "2_3": 1, "3_1": 1, "3_2": 1, "3_3": 1, "4_2": 1, "4_4": 1, "0_5": 1 }, r, k;
            for (r = 0; r < rows.length; r++) {
                for (k = 0; k < 6; k++) {
                    if (!gone[r + "_" + k]) pRect(c, -18 + k * 6.1, -23 + r * 3.6, 5.3, 2.8, rows[r]);
                }
            }
            pLine(c, [-10, 11, -5, 3, 0, -3], "rgba(255,255,255,0.3)", 0.8);
            pCircle(c, 1, -4.5, 1.5, null, "#FFFFFF");
            pRect(c, 9, -2, 2.4, 2.4, "#00DFFF");
            pLine(c, [10.2, -5, 10.2, -3], "rgba(0,223,255,0.5)", 0.6);
            pRect(c, -9, 11, 12, 2.2, "#FF1493");
            pRect(c, -9, 11, 12, 0.7, "#FFB6DD");
        } }
    };
    function pRect(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(x, y, w, h); }
    function pPath(c, pts, close) {
        c.beginPath();
        for (var i = 0; i < pts.length; i += 2) { if (i) c.lineTo(pts[i], pts[i + 1]); else c.moveTo(pts[i], pts[i + 1]); }
        if (close) c.closePath();
    }
    function pPoly(c, pts, stroke, fill, lw) {
        pPath(c, pts, true);
        if (fill) { c.fillStyle = fill; c.fill(); }
        if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); }
    }
    function pLine(c, pts, col, lw) { pPath(c, pts, false); c.strokeStyle = col; c.lineWidth = lw || 1; c.stroke(); }
    function pCircle(c, x, y, r, stroke, fill, lw) {
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
        if (fill) { c.fillStyle = fill; c.fill(); }
        if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); }
    }
    function drawPoster(c, p) {
        var art = POSTER_ART[p.art];
        c.fillStyle = art.bg; c.fillRect(-22, -28, 44, 56);
        c.fillStyle = rgba(p.col, 0.12); c.fillRect(-22, 16, 44, 12);
        c.save();
        c.beginPath(); c.rect(-19, -25, 38, 40); c.clip();
        art.draw(c);
        c.restore();
        c.strokeStyle = rgba(p.col, 0.45); c.lineWidth = 0.5; c.strokeRect(-19, -25, 38, 40);
        c.fillStyle = p.col; c.font = "bold 5.5px 'Source Code Pro', monospace"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(p.title, 0, 21.5);
        c.strokeStyle = rgba(p.col, 0.7); c.lineWidth = 1; c.strokeRect(-22, -28, 44, 56);
    }

    // ─── Roof gadgets and street furniture ─────────────────────────────────
    // Each is drawn in the game's pixels with the origin at its foot: on the roof deck or the street.
    // The street pieces follow the game's own (drawCityBench, drawCityBin, drawCityVendingMachine,
    // drawCityTree, drawCityCabinet); the roof pieces follow its roof gadgets.
    function boxFillOf(hex) {
        var n = parseInt(hex.slice(1), 16);
        return "rgb(" + Math.floor(((n >> 16) & 255) * 0.14) + "," + Math.floor(((n >> 8) & 255) * 0.14) + "," + Math.floor((n & 255) * 0.14) + ")";
    }

    function drawCabinet(c, doors, C) {
        var w = [0, 32, 58, 84][doors], h = [0, 42, 38, 36][doors], x0 = -w / 2, top = -4 - h, dw = w / doors, d, v;
        c.fillStyle = C.body; c.fillRect(x0, top, w, h);
        c.strokeStyle = C.edge; c.lineWidth = 1; c.globalAlpha = 0.85; c.strokeRect(x0 + 0.5, top + 0.5, w - 1, h - 1); c.globalAlpha = 1;
        c.fillStyle = "#2a2d34"; c.fillRect(x0 - 3, -4, w + 6, 4);                                  // the plinth
        c.fillStyle = C.edge; c.globalAlpha = 0.35; c.fillRect(x0 - 3, -4, w + 6, 1); c.globalAlpha = 1;
        c.fillStyle = C.face;                                                                       // the sloped lid
        c.beginPath(); c.moveTo(x0 - 3, top); c.lineTo(x0 + 3, top - 5); c.lineTo(x0 + w - 3, top - 5); c.lineTo(x0 + w + 3, top); c.closePath(); c.fill();
        c.strokeStyle = C.dim; c.stroke();
        for (d = 0; d < doors; d++) {
            var dx = x0 + d * dw;
            if (d > 0) line(c, Math.round(dx) + 0.5, top + 3, Math.round(dx) + 0.5, top + h - 3);
            c.strokeStyle = C.dim; c.strokeRect(Math.round(dx + 3) + 0.5, top + 4.5, Math.round(dw - 6) - 1, h - 10);
            c.fillStyle = C.edge; c.globalAlpha = 0.7; c.fillRect(Math.round(d % 2 === 0 ? dx + dw - 6 : dx + 4), top + h * 0.44, 2, 7); c.globalAlpha = 1;
            c.fillStyle = "rgba(200,210,220,0.55)"; c.fillRect(Math.round(dx + dw / 2) - 1, top + 8, 2, 2);
        }
        c.strokeStyle = C.dim;
        for (v = 0; v < 5; v++) line(c, x0 + 7, top + h - 20 + v * 2.5, x0 + Math.min(dw - 6, 16), top + h - 20 + v * 2.5);
        c.fillStyle = "#FFD24A"; c.fillRect(x0 + w - 9, top + 12, 4, 4);                           // a hazard sticker
    }

    // The game's roof gadgets (_cityRoofGadget, _cityDishStand, _cityDishHead, drawCityWaterTower).
    function strokePath(c, pts) {
        c.beginPath();
        for (var i = 0; i < pts.length; i += 4) { c.moveTo(pts[i], pts[i + 1]); c.lineTo(pts[i + 2], pts[i + 3]); }
        c.stroke();
    }

    var ROOF_DRAW = {
        // a rooftop plant cabinet: one, two or three doors, in galvanised grey, navy or the building's colours
        junction: function (c, hex, seed) {
            var pals = [CABINET_ROOF, { body: "#0c1426", face: "#122038", edge: "#4D7FD1", dim: "rgba(77,127,209,0.45)" },
                { body: boxFillOf(hex), face: boxFillOf(hex), edge: rgba(hex, 0.5), dim: rgba(hex, 0.18) }];
            c.fillStyle = "rgba(0,0,0,0.7)";
            var doors = [2, 1, 3][seed % 3], w = [0, 32, 58, 84][doors];
            c.fillRect(-w / 2 - 4, 0, w + 8, 3);
            c.translate(0, 2);
            drawCabinet(c, doors, pals[(seed * 7 + 3) % pals.length]);
        },
        beacon: function (c, hex, seed) {
            var soft = rgba(hex, 0.5), k;
            c.strokeStyle = soft; c.lineWidth = 2.5;
            line(c, 0, 0, 0, -76);
            c.lineWidth = 1;
            for (k = 0; k < 3; k++) line(c, -6 + k * 6, 0, -6 + k * 6, -22 - k * 6);
            [-20, 22].forEach(function (po, pk) {                                                       // neighbour poles
                var ph = 40 + ((seed * 5 + pk * 13) % 26);
                c.strokeStyle = soft; c.lineWidth = 1.5;
                line(c, po, 0, po, -ph);
                if (pk === 0) { c.fillStyle = "rgba(0,223,255,0.7)"; c.fillRect(po - 2, -ph * 0.6, 4, 4); }
            });
            c.globalAlpha = 0.3; c.fillStyle = "#FF3300";
            c.beginPath(); c.arc(0, -83, 16, 0, Math.PI * 2); c.fill();
            c.globalAlpha = 1; c.fillStyle = "#FF5533";
            c.beginPath(); c.arc(0, -83, 7, 0, Math.PI * 2); c.fill();
        },
        ventbox: function (c, hex) {
            var y;
            c.fillStyle = "rgba(0,0,0,0.7)"; c.fillRect(-33, 0, 66, 3);
            c.fillStyle = boxFillOf(hex); c.fillRect(-29, -70, 58, 72);
            c.strokeStyle = rgba(hex, 0.5); c.lineWidth = 1.5; c.strokeRect(-29, -70, 58, 72);
            c.strokeStyle = rgba(hex, 0.18); c.lineWidth = 1;
            for (y = -56; y < -4; y += 15) line(c, -25, y, 25, y);
            c.fillStyle = "#39FF14"; c.fillRect(-22, -62, 6, 6);
            c.fillStyle = "#100c22"; c.strokeStyle = "rgba(180,180,200,0.35)"; c.lineWidth = 1.5;          // the fan bank on top
            c.fillRect(-22, -88, 44, 18); c.strokeRect(-22, -88, 44, 18);
            c.beginPath(); c.arc(0, -79, 7, 0, Math.PI * 2); c.stroke();
            c.strokeStyle = rgba(hex, 0.5);
            line(c, 17, -88, 17, -106);
        },
        dishbox: function (c, hex, seed) {
            var soft = rgba(hex, 0.5), y, i, n = 3, hw = 13, botY = -72, topY = -106;
            c.fillStyle = "rgba(0,0,0,0.7)"; c.fillRect(-33, 0, 66, 3);
            c.fillStyle = boxFillOf(hex); c.fillRect(-29, -72, 58, 74);
            c.strokeStyle = soft; c.lineWidth = 1.5; c.strokeRect(-29, -72, 58, 74);
            c.strokeStyle = rgba(hex, 0.18); c.lineWidth = 1;
            for (y = -58; y < -4; y += 16) line(c, -25, y, 25, y);
            line(c, 0, -68, 0, -2);
            // the stocky scaffold stand: two tapered legs, rungs and cross-braces
            c.strokeStyle = "#3a3358"; c.lineWidth = 3;
            strokePath(c, [-hw, botY, -hw * 0.6, topY, hw, botY, hw * 0.6, topY]);
            c.lineWidth = 1.4;
            for (i = 0; i <= n; i++) {
                var f = i / n, yy = botY + (topY - botY) * f, w2 = hw * (1 - 0.4 * f);
                line(c, -w2, yy, w2, yy);
            }
            for (i = 0; i < n; i++) {
                var f0 = i / n, f1 = (i + 1) / n, y0 = botY + (topY - botY) * f0, y1 = botY + (topY - botY) * f1;
                var w0 = hw * (1 - 0.4 * f0), w1 = hw * (1 - 0.4 * f1);
                strokePath(c, [-w0, y0, w1, y1, w0, y0, -w1, y1]);
            }
            // the dish: an arc, an inner arc and the rim's chord, aimed a little off straight up
            var R = 36, ang = [-0.55, -0.38, -0.22, 0.22, 0.38, 0.55, 0][seed % 7], a = Math.PI * 0.20, b2 = Math.PI * 0.80;
            c.save();
            c.translate(0, topY);
            c.rotate(ang);
            c.strokeStyle = rgba(hex, 0.7); c.lineWidth = 3;
            c.beginPath(); c.arc(0, -R, R, a, b2); c.stroke();
            c.lineWidth = 1;
            c.beginPath(); c.arc(0, -R, R * 0.6, a, b2); c.stroke();
            line(c, R * Math.cos(a), -R + R * Math.sin(a), R * Math.cos(b2), -R + R * Math.sin(b2));
            c.strokeStyle = "#3a3358"; c.lineWidth = 2;
            line(c, 0, 0, 0, -14);
            c.fillStyle = rgba(hex, 0.95);
            c.beginPath(); c.arc(0, 0, 4.5, 0, Math.PI * 2); c.fill();
            c.restore();
        },
        // the water tower: a stave tank on a braced stand, with a catwalk, hoops, a cap and a ladder
        tank: function (c, hex) {
            var w = 78, h = 80, legH = 26, hw = w / 2, tb = -5 - legH, ty = tb - h, steel = "#262a36";
            var lineCol = rgba(hex, 0.5), faint = rgba(hex, 0.18), x, y, k;
            c.fillStyle = steel; c.fillRect(-hw - 8, -5, w + 16, 5);                                    // grillage beam
            c.strokeStyle = faint; c.lineWidth = 1; line(c, -hw - 8, -4.5, hw + 8, -4.5);
            c.strokeStyle = steel; c.lineWidth = 2.5;                                                   // the stand
            strokePath(c, [-w / 6, tb, -w / 6, -5, w / 6, tb, w / 6, -5]);
            c.strokeStyle = "rgba(140,160,180,0.5)"; c.lineWidth = 1.1;
            strokePath(c, [-hw + 5, tb, hw + 3, -5, hw - 5, tb, -hw - 3, -5]);
            c.strokeStyle = steel; c.lineWidth = 3.5;
            strokePath(c, [-hw + 5, tb, -hw - 3, -5, hw - 5, tb, hw + 3, -5]);
            c.fillStyle = steel; c.fillRect(-hw - 6, tb - 2, w + 12, 3);                                // catwalk
            c.strokeStyle = faint; c.lineWidth = 1;
            strokePath(c, [-hw - 6, tb - 11, -hw - 6, tb - 2, hw + 6, tb - 11, hw + 6, tb - 2, -hw - 6, tb - 11, -hw, tb - 11, hw, tb - 11, hw + 6, tb - 11]);
            c.fillStyle = "#171130"; c.strokeStyle = lineCol; c.lineWidth = 1.5;                        // the tank
            c.fillRect(-hw, ty, w, h); c.strokeRect(-hw, ty, w, h);
            c.strokeStyle = faint; c.lineWidth = 1;
            for (x = -hw + 7; x < hw - 3; x += 7) line(c, x, ty + 2, x, tb - 2);
            c.strokeStyle = steel; c.lineWidth = 2.5;                                                   // hoops
            for (k = 1; k <= 3; k++) { y = ty + h * k / 4; line(c, -hw - 1, y, hw + 1, y); }
            c.strokeStyle = faint; c.lineWidth = 0.8;
            for (k = 1; k <= 3; k++) { y = ty + h * k / 4 - 1; line(c, -hw - 1, y, hw + 1, y); }
            var capH = Math.round(w * 0.26);                                                            // conical cap and finial
            c.fillStyle = "#171130"; c.strokeStyle = lineCol; c.lineWidth = 1.5;
            c.beginPath(); c.moveTo(-hw - 4, ty); c.lineTo(0, ty - capH); c.lineTo(hw + 4, ty); c.closePath(); c.fill(); c.stroke();
            c.fillStyle = steel; c.fillRect(-3, ty - capH - 6, 6, 6);
            c.strokeStyle = faint; c.lineWidth = 1;                                                     // ladder
            line(c, hw - 14, tb - 2, hw - 14, ty - 2); line(c, hw - 7, tb - 2, hw - 7, ty - 2);
            for (y = tb - 8; y > ty; y -= 6) line(c, hw - 14, y, hw - 7, y);
        }
    };

    function lobe(c, cx, cy, r) {
        for (var k = 0; k < 8; k++) {
            var a = (k + 0.5) / 8 * Math.PI * 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
            if (k) c.lineTo(x, y); else c.moveTo(x, y);
        }
        c.closePath();
    }

    var STREET_DRAW = {
        bench: function (c) {
            var acc = "#00DFFF", sl;
            c.fillStyle = "#15131f"; c.strokeStyle = "rgba(0,223,255,0.55)"; c.lineWidth = 1;
            [-22, 22].forEach(function (lx) {
                c.beginPath(); c.moveTo(lx - 5, 0); c.lineTo(lx - 2, -15); c.lineTo(lx + 2, -15); c.lineTo(lx + 5, 0); c.closePath();
                c.fill(); c.stroke();
            });
            c.fillStyle = "#0e0c16"; c.fillRect(-30, -18, 60, 4);
            c.fillStyle = "#2a2540";
            for (sl = 0; sl < 4; sl++) c.fillRect(-29 + sl * 14.75, -20, 13.5, 2.5);
            c.strokeStyle = acc; c.lineWidth = 1.2; c.shadowBlur = 3 * K * DPR; c.shadowColor = acc;
            line(c, -30, -14.5, 30, -14.5);
            c.shadowBlur = 0;
            c.fillStyle = "#15131f"; c.fillRect(-26, -38, 3, 20); c.fillRect(23, -38, 3, 20);
            c.fillStyle = "#2a2540"; c.fillRect(-28, -37, 56, 4); c.fillRect(-28, -30, 56, 4);
            c.strokeStyle = "rgba(0,223,255,0.35)"; c.lineWidth = 1;
            c.strokeRect(-27.5, -36.5, 55, 3); c.strokeRect(-27.5, -29.5, 55, 3);
            c.fillStyle = "#0e0c16"; c.strokeStyle = "rgba(0,223,255,0.5)";
            c.fillRect(-33, -26, 6, 3); c.strokeRect(-32.5, -25.5, 5, 2);
            c.fillRect(27, -26, 6, 3); c.strokeRect(27.5, -25.5, 5, 2);
        },
        bin: function (c) {
            var acc = "#39FF14";
            c.fillStyle = "#2a2540"; c.fillRect(-13, -3, 26, 3);
            c.fillStyle = "rgba(57,255,20,0.35)"; c.fillRect(-13, -3, 26, 1);
            c.fillStyle = "#14101f"; c.strokeStyle = acc; c.lineWidth = 1.3; c.shadowBlur = 3 * K * DPR; c.shadowColor = acc;
            c.beginPath(); c.moveTo(-11, -3); c.lineTo(-11, -27); c.lineTo(11, -27); c.lineTo(11, -3); c.closePath();
            c.fill(); c.stroke();
            c.shadowBlur = 0;
            c.fillStyle = "#1c1730";
            c.beginPath(); c.moveTo(-13, -27); c.lineTo(-11, -33); c.lineTo(11, -33); c.lineTo(13, -27); c.closePath(); c.fill();
            c.strokeStyle = "rgba(57,255,20,0.7)"; c.lineWidth = 1; c.stroke();
            c.fillStyle = "#050308"; c.fillRect(-7, -30, 14, 2);
            c.fillStyle = "rgba(57,255,20,0.35)"; c.fillRect(-11, -23, 22, 1.5);
            ["#39FF14", "#00DFFF", "#FFB300"].forEach(function (col, k) {
                var cx = -7 + k * 7;
                c.fillStyle = "#050308"; c.fillRect(cx - 2.5, -19, 5, 8);
                c.fillStyle = col; c.globalAlpha = 0.75; c.fillRect(cx - 2.5, -19, 5, 1.5); c.globalAlpha = 1;
            });
            c.fillStyle = "rgba(57,255,20,0.15)"; c.fillRect(-10, -8, 20, 3);
        },
        vending: function (c, idx) {
            var br = VEND_BRANDS[idx % VEND_BRANDS.length], L = -18, T = -60, W2 = 36, H2 = 60, r, k, ry, sp, ky, kx;
            c.fillStyle = "#0b0a12"; c.strokeStyle = br.col; c.lineWidth = 1.5; c.shadowBlur = 3 * K * DPR; c.shadowColor = br.col;
            c.fillRect(L, T, W2, H2); c.strokeRect(L, T, W2, H2);
            c.shadowBlur = 0;
            c.globalAlpha = 0.2; c.fillStyle = br.col; c.fillRect(L, T, W2, 9); c.globalAlpha = 1;
            c.fillStyle = br.col; c.textAlign = "center"; c.textBaseline = "middle";
            var fs = 5;
            c.font = "bold 5px 'Source Code Pro', monospace";
            while (fs > 3 && c.measureText(br.name).width > W2 - 4) { fs -= 0.5; c.font = "bold " + fs + "px 'Source Code Pro', monospace"; }
            c.fillText(br.name, 0, T + 4.8);
            var gx = L + 3, gT = T + 12, gw = 22, gh = 34;
            c.fillStyle = "#04050a"; c.fillRect(gx, gT, gw, gh);
            for (r = 0; r < 3; r++) {
                ry = gT + 4 + r * 10;
                c.fillStyle = br.stock[r];
                for (k = 0; k < 4; k++) {
                    if (r === 0) c.fillRect(gx + 2 + k * 5, ry, 3, 6);
                    else if (r === 1) c.fillRect(gx + 2 + k * 5, ry + 2, 4, 4);
                    else { c.beginPath(); c.arc(gx + 3.5 + k * 5, ry + 3, 1.8, 0, Math.PI * 2); c.fill(); }
                }
                c.strokeStyle = "rgba(200,210,230,0.35)"; c.lineWidth = 0.7;
                c.beginPath(); for (sp = 0; sp < 10; sp++) { c.moveTo(gx + 1.5 + sp * 2, ry + 7.5); c.lineTo(gx + 2.5 + sp * 2, ry + 9); } c.stroke();
            }
            c.fillStyle = "rgba(255,255,255,0.08)";
            c.beginPath(); c.moveTo(gx + 3, gT); c.lineTo(gx + 9, gT); c.lineTo(gx + 1, gT + gh); c.lineTo(gx, gT + gh); c.lineTo(gx, gT + 6); c.closePath(); c.fill();
            c.strokeStyle = "rgba(200,210,230,0.3)"; c.lineWidth = 1; c.strokeRect(gx + 0.5, gT + 0.5, gw - 1, gh - 1);
            var px = L + 27;
            c.fillStyle = "#030302"; c.fillRect(px, T + 13, 7, 6);
            c.fillStyle = br.col; c.font = "bold 4px 'Source Code Pro', monospace"; c.fillText("5B", px + 3.5, T + 16.2);
            c.fillStyle = "rgba(255,215,0,0.55)"; c.fillRect(px + 1, T + 23, 5, 1.5);
            c.fillStyle = "rgba(200,210,230,0.45)";
            for (ky = 0; ky < 3; ky++) for (kx = 0; kx < 2; kx++) c.fillRect(px + 1 + kx * 3, T + 28 + ky * 3, 2, 2);
            c.fillStyle = "#15131f"; c.fillRect(L + 3, T + 49, 22, 7);
            c.strokeStyle = "rgba(200,210,230,0.3)"; c.strokeRect(L + 3.5, T + 49.5, 21, 6);
            c.fillStyle = br.col; c.globalAlpha = 0.25; c.fillRect(L + 27, T + 50, 7, 1.5); c.globalAlpha = 1;
        },
        tree: function (c) {
            var hw = 18, h = 16, edge = "#2BD1FC", lobes = [[0, 0, 21], [-16, 6, 13], [16, 6, 13]], cy = -62;
            c.fillStyle = "#2a2540"; c.fillRect(-hw + 3, -2, 6, 2); c.fillRect(hw - 9, -2, 6, 2);
            c.beginPath(); c.moveTo(-hw + 2, -2); c.lineTo(-hw, -h + 3); c.lineTo(hw, -h + 3); c.lineTo(hw - 2, -2); c.closePath();
            c.fillStyle = "#0a2a3a"; c.strokeStyle = edge; c.lineWidth = 1.5; c.fill(); c.stroke();
            c.fillStyle = "#061a25"; c.fillRect(-hw + 3, -h + 8, hw * 2 - 6, 1.5);
            c.fillStyle = "#0a2a3a"; c.fillRect(-hw - 2, -h, hw * 2 + 4, 3.5);
            c.strokeStyle = edge; c.lineWidth = 1.2; c.strokeRect(-hw - 1.5, -h + 0.5, hw * 2 + 3, 3);
            c.fillStyle = "#04080c"; c.fillRect(-hw + 1, -h - 1.5, hw * 2 - 2, 1.5);
            var limbs = function () {
                c.beginPath();
                c.moveTo(0, -16); c.lineTo(0, -46);
                c.moveTo(0, -32); c.lineTo(-13, -52);
                c.moveTo(0, -37); c.lineTo(11, -56);
            };
            c.strokeStyle = "#3a3050"; c.lineWidth = 4.5; limbs(); c.stroke();
            c.strokeStyle = "#6a5a8a"; c.lineWidth = 1; limbs(); c.stroke();
            // the canopy: outlined on its outer edge only, then flat facets of light and shade inside
            var path = function () { c.beginPath(); lobes.forEach(function (l) { lobe(c, l[0], cy + l[1], l[2]); }); };
            c.strokeStyle = "#00DFFF"; c.lineWidth = 3; c.lineJoin = "round";
            path(); c.stroke();
            c.fillStyle = "#2CC30F"; path(); c.fill();
            c.save(); path(); c.clip();
            lobes.forEach(function (l) {
                var lx = l[0], ly = cy + l[1], r = l[2];
                c.fillStyle = "#1E9A0A";
                c.beginPath(); c.moveTo(lx - r, ly + r * 0.25); c.lineTo(lx + r, ly + r * 0.25); c.lineTo(lx + r, ly + r + 2); c.lineTo(lx - r, ly + r + 2); c.closePath(); c.fill();
                c.fillStyle = "#5BE83C";
                c.beginPath(); c.moveTo(lx - r * 0.75, ly - r * 0.2); c.lineTo(lx - r * 0.2, ly - r * 0.8); c.lineTo(lx + r * 0.25, ly - r * 0.6); c.lineTo(lx - r * 0.35, ly - r * 0.05); c.closePath(); c.fill();
            });
            c.restore();
        },
        cabinet: function (c) { drawCabinet(c, 2, CABINET_STREET); }
    };

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
        if (!pointerIn && t - lastPointer > 4 && t > op.wanderAt) {
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
            if (player) player.setTension(0.2 + heat / 100 * 0.6);
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

    // ─── The tune ──────────────────────────────────────────────────────────
    // js/streetmusic.js plays it: a piece written for this page, composed as it goes. It starts only
    // when the button is pressed (browsers allow nothing sooner), and its tension follows the heat.
    var soundBtn = document.getElementById("sound");
    var player = (window.StreetMusic && (window.AudioContext || window.webkitAudioContext))
        ? window.StreetMusic.create({ volume: 0.6 }) : null;

    // A short blip for the things that answer a click, while the sound is on.
    function sfx(freq, slideTo, dur, type) { if (player) player.blip(freq, slideTo, dur, type); }

    if (soundBtn) {
        if (!player) soundBtn.hidden = true;
        soundBtn.addEventListener("click", function () {
            if (!player) return;
            var on = player.toggle();
            soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
            soundBtn.textContent = on ? "Sound: on" : "Sound: off";
        });
        // nothing plays to a tab nobody is looking at
        document.addEventListener("visibilitychange", function () {
            if (!player) return;
            if (document.hidden) player.pause(); else player.resume();
        });
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
        sfx(1800, 900, 0.22, "sawtooth");
        if (seen) heat = clamp(heat + HEAT.tag, 0, 100);
    }

    function onClick(e) {
        var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, t = now(), i, l;
        var pad = Math.max(16, 16 * K);
        if (near(x, y, op.x, S.gy - OP.h * K / 2, Math.max(pad, OP.h * K / 2 + 4))) { setOperatorColour(op.colour + 1); sfx(660, 990, 0.09); return; }
        if (near(x, y, drone.x, drone.y, pad + 4)) { scan = { t0: t, x: op.x, y: S.gy - OP.h * K / 2 }; sfx(420, 1680, 0.5, "sine"); return; }
        if (S.cam && near(x, y, S.cam.x, S.cam.y + 4 * K, pad)) {
            if (camIsDown(t)) { camDownUntil = 0; sfx(330, 660, 0.12); }
            else { camDownUntil = t + CAM.downFor; sfx(520, 70, 0.3, "sawtooth"); if (seen) heat = clamp(heat + HEAT.cam, 0, 100); }
            return;
        }
        for (i = 0; i < S.lamps.length; i++) {
            l = S.lamps[i];
            if ((Math.abs(x - l.x) <= pad && y > S.gy - LAMP.poleH * K - 8 && y < S.gy) || near(x, y, l.x + 26 * K, S.gy - LAMP.poleH * K, pad)) {
                l.broken = !l.broken;
                sfx(l.broken ? 240 : 480, l.broken ? 90 : 720, 0.12);
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
            if (Math.round(r.width) === W && Math.round(r.height) === H && boxesSig(copyBoxes(r)) === copySig) return;
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () { build(); if (REDUCE) frame(0.9, 0); }, 120);
        };
        if (window.ResizeObserver) {
            var ro = new ResizeObserver(onResize);
            ro.observe(canvas);
            if (copyEl) ro.observe(copyEl);
        }
        else window.addEventListener("resize", onResize);
        // The sign lettering needs the display face; redraw once it has loaded.
        if (document.fonts && document.fonts.load) {
            document.fonts.load("bold 11px cyber").then(function () { build(); if (REDUCE) frame(0.9, 0); });
        }

        if (REDUCE) { frame(0.9, 0); return; }

        var point = function (e) {
            var r = canvas.getBoundingClientRect(), px = clamp(e.clientX - r.left, 20, W - 20);
            // Close to the operator it stops where it is: turning to face the pointer would swing the
            // drone round to its other side, away from the click.
            op.target = Math.abs(px - op.x) < OP.still * K ? op.x : px;
            lastPointer = now();
            pointerIn = e.pointerType !== "touch";
        };
        hero.addEventListener("pointermove", point);
        hero.addEventListener("pointerdown", point);
        hero.addEventListener("pointerleave", function () { pointerIn = false; });
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
