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
    var backLayer = null;   // sky and skyline, drawn once per resize (and when the operator's colour changes)
    var frontLayer = null;  // facades and street, drawn once per resize; the traffic flies between the two
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
        [[62, "bench"], [184, "vending"], [250, "booth"]],
        [[50, "tree"], [205, "cabinet"], [264, "hydrant"]],
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
    var GAPS = [300, 300, 240, 320, 280, 300];
    var ARCADE = 1;         // the Pixel Arcade's place in the list: the street is laid out around it
    var FACADE = { winW: 18, winH: 26, gapX: 36, gapY: 46, pad: 36, padMin: 14, storeH: 114, bayW: 60, corner: 10, edge: 4, edgeAlpha: 0.42, signY: 134, plateH: 20 };
    // The game's three skyline layers (preRenderSkyline), far to near: where the towers stand, their
    // size, their colour, what crowns them, and the grid their windows sit on. The windows take the
    // operator's colour.
    var SKYLINE = [
        { step: 350, k1: 12.3, k2: 32.1, jx: 50, w: [120, 180], h: [250, 350], rgb: [8, 4, 12, 6, 25, 10], gap: [15, 15, 20, 20], size: [2, 3, 2, 3], alpha: 0.15, pat: [12.3, 4.5, -0.3],
          crown: function (c, x, top, w, h1, h2) {
              if (h1 > 0.6) c.fillRect(x + w * 0.2, top - 15 * K, w * 0.6, 15 * K);
              if (h2 > 0.8) c.fillRect(x + w * 0.7, top - 40 * K, 4 * K, 40 * K);
          } },
        { step: 250, k1: 22.2, k2: 44.4, jx: 40, w: [100, 150], h: [150, 250], rgb: [18, 5, 22, 6, 40, 10], gap: [15, 20, 20, 25], size: [4, 4, 6, 6], alpha: 0.25, pat: [3.3, 7.1, -0.2],
          crown: function (c, x, top, w, h1, h2) {
              if (h1 > 0.4) c.fillRect(x + 10 * K, top - 20 * K, w - 20 * K, 20 * K);
              if (h2 < 0.2) { c.fillRect(x + 20 * K, top - 35 * K, 10 * K, 35 * K); c.fillRect(x + w - 30 * K, top - 35 * K, 10 * K, 35 * K); }
          } },
        { step: 200, k1: 33.3, k2: 66.6, jx: 30, w: [80, 120], h: [100, 200], rgb: [35, 10, 8, 4, 45, 10], gap: [20, 25, 30, 30], size: [8, 6, 12, 10], alpha: 0.35, pat: [8.1, 3.2, -0.1],
          crown: function (c, x, top, w, h1, h2) {
              if (h2 > 0.5) c.fillRect(x + w * 0.3, top - 25 * K, w * 0.4, 25 * K);
          } }
    ];
    // Background traffic (the game's Lower Streets mix): three depths, most of it nearest.
    var TRAFFIC = { variants: [0, 0, 2, 3, 1, 5], colours: ["#00DFFF", "#FF1493", "#FFB300", "#9D4EDD", "#38BDF8", "#F43F5E"],
        speed: [0, 270, 450, 630], extra: 90, scale: [0, 0.10, 0.17, 0.27], alpha: [0, 0.35, 0.60, 0.85], perSecond: 0.7 };
    // An Overwatch patrol drone comes through now and then, sooner when the heat is high.
    var PATROL = { col: "#6E6E6E", scale: 1.5, height: 180, speed: 90, first: 9, every: [24, 22], beam: 40 };
    // What can be clicked in the street, as [half-width, height] in the game's pixels.
    var PROP_BOX = { bench: [33, 38], bin: [13, 33], vending: [18, 60], tree: [30, 90], cabinet: [32, 47], hydrant: [12, 34], booth: [18, 63] };
    // Keystone's support line, rung from the comm booth: what it says while you hold
    var HOLD = { seconds: 20, each: 5, col: "#8FB8C8", lines: ["YOUR CALL IS IMPORTANT TO US.", "YOUR CALL MAY BE RECORDED TO IMPROVE YOUR EXPERIENCE.", "YOUR CALL IS VERY IMPORTANT TO US."] };
    var LAMP = { poleH: 168, baseW: 12, baseH: 38, taperH: 10, doorW: 8, doorTop: 35, doorBot: 23 };
    // Overwatch hardware: black body, grey edge, red only in the eye and the beam.
    var CAM = { body: "#000000", edge: "#6E6E6E", eye: "#FF0000", sweep: 0.75, half: 0.2, rate: 0.45, downFor: 12, height: 150 };
    var OP = { w: 26, h: 38, speed: 150, still: 48 };     // still: how near the pointer may come before the operator stops following
    var OP_COLOURS = ["#FF1493", "#00DFFF", "#39FF14", "#FF3E00", "#8A2BE2"];
    var HEAT = { rise: 34, fall: 14, grace: 1.2, tag: 20, cam: 30 };
    var SCAN = { range: 900, time: 0.7, show: 6 };
    var TAG_ORDER = ["operator_mark", "crown", "glitch_eye", "offbook", "bolt", "null_sig", "crimson_row", "arrow_up", "circuit", "stackrunners", "gridrot"];
    var TAG_MAX = 10, TAG_HALF = 18, TAG_TIME = 0.6;

    var op = { x: 0, dir: 1, target: 0, wanderAt: 0, colour: 0 };
    var drone = { x: 0, y: 0 };
    var tags = [], tagNext = 0, scan = null, camDownUntil = 0;
    var cars = [], patrol = null, patrolAt = PATROL.first, bits = [], floats = [];
    var arcadeOpenUntil = 0;        // while the arcade's door stands lit and its tune plays
    var holdCall = null;            // a call to Keystone in progress: { t0, until, lines, x }
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
        S = { gy: gy, near: [], lamps: [], props: [], cam: null, roomOver: roomOver };
        var x, w, h;

        // The street is laid out around the Pixel Arcade, which is always wholly in view with the
        // camera on its wall, whatever the screen:
        //   - on a wide screen it starts just past the end of the words, where it can stand at its
        //     full height, or as near to that as keeps its far wall on screen
        //   - on a narrow one (a phone held upright) the buildings are narrower and it stands at the
        //     left, with just enough room beside it for its billboards
        //   - otherwise it stands in the middle
        // The rest of the street is then built outwards from it in both directions.
        var count = BUILDINGS.length, copyRight = 0, copyBottom = 0, i, def, gap, room, slot, space;
        var narrow = W < 720;
        var widthOf = function (d) { return (narrow ? Math.min(d.w, 340) : d.w) * K; };
        boxes.forEach(function (q) { copyRight = Math.max(copyRight, q.r); copyBottom = Math.max(copyBottom, q.b); });
        var arcW = widthOf(BUILDINGS[ARCADE]), edge = (POSTER.off + POSTER.w) * K + 8, farWall = W - 12 - arcW;
        var left = narrow ? edge : (W - copyRight > 300 * K ? copyRight + 24 : (W - arcW) / 2);
        left = Math.max(Math.min(left, farWall), Math.min(edge, Math.max(0, farWall)));
        i = ARCADE; x = left;
        while (x > -40 * K) {
            i--;
            slot = ((i % count) + count) % count;
            x -= widthOf(BUILDINGS[slot]) + GAPS[slot] * K;
        }
        while (x < W + 40) {
            slot = ((i % count) + count) % count;
            def = BUILDINGS[slot];
            w = widthOf(def);
            // Room above the roof is kept for its gadgets where there is plenty; where there is little,
            // the wall takes all of it, since rows of windows matter more than a cabinet.
            room = roomOver(x, x + w);
            space = roofSpace(def) * K;
            h = room - space >= 200 * K ? Math.min(def.h * K, room - space) : Math.max(150 * K, Math.min(def.h * K, room - 8));
            S.near.push({ x: x, w: w, h: h, def: def, idx: i, room: room });
            gap = GAPS[slot] * K;
            STREET[slot].forEach(function (it) { S.props.push({ x: x + w + it[0] * K, kind: it[1], idx: slot, shakeUntil: 0, used: false }); });
            // the lamp's light falls a little to its right, so the post stands left of the gap's middle
            S.lamps.push({ x: x + w + gap / 2 - 22 * K, broken: !!broken[S.lamps.length] });
            x += w + gap;
            i++;
        }

        // The camera hangs on the arcade's wall, clear of its door and its sign.
        S.near.forEach(function (b) {
            if (b.idx !== ARCADE) return;
            S.arcade = b;
            var lo = Math.max(b.x, 0) + 40 * K, hi = Math.min(b.x + b.w, W) - 40 * K;
            S.cam = { x: clamp(b.x + b.w * 0.8, lo, Math.max(lo, hi)), y: gy - Math.min(CAM.height * K, b.h - 30 * K) };
        });

        // where the traffic flies and the patrol drone passes: under the words, over the street
        S.laneBot = gy - 90 * K;
        S.laneTop = Math.min(copyBottom + 14, S.laneBot - 120 * K);
        S.patrolY = Math.min(gy - 110 * K, Math.max(gy - PATROL.height * K, copyBottom + 26));

        backLayer = document.createElement("canvas");
        frontLayer = document.createElement("canvas");
        backLayer.width = frontLayer.width = canvas.width;
        backLayer.height = frontLayer.height = canvas.height;
        drawBack();
        var c = frontLayer.getContext("2d");
        c.setTransform(DPR, 0, 0, DPR, 0, 0);
        drawFront(c);

        cars.length = 0;
        bits.length = 0;
        floats.length = 0;
        patrol = null;
        if (!REDUCE) for (i = 0; i < maxCars() / 2; i++) spawnCar(true);

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

    // The sky and the game's three layers of skyline. Each tower stops short of the words above it,
    // and its windows start a row down from its own roof, so no top is ever left blank.
    function drawBack() {
        var c = backLayer.getContext("2d"), gy = S.gy, tint = rgbOf(OP_COLOURS[op.colour]);
        c.setTransform(DPR, 0, 0, DPR, 0, 0);
        c.fillStyle = "#050510";
        c.fillRect(0, 0, W, H);
        SKYLINE.forEach(function (L) {
            for (var i = -5; i * L.step * K < W + 60; i++) {
                var h1 = Math.abs(Math.sin(i * L.k1)), h2 = Math.abs(Math.cos(i * L.k2));
                var w = (L.w[0] + h1 * L.w[1]) * K, x = (i * L.step + h1 * L.jx) * K;
                if (x + w < 0) continue;
                var h = Math.max(40 * K, Math.min((L.h[0] + h2 * L.h[1]) * K, S.roomOver(x, x + w) - 34 * K));
                var top = gy - h;
                c.fillStyle = "rgb(" + (L.rgb[0] + Math.floor(h1 * L.rgb[1])) + "," + (L.rgb[2] + Math.floor(h2 * L.rgb[3])) + "," + (L.rgb[4] + Math.floor(h1 * L.rgb[5])) + ")";
                c.fillRect(x, top, w, h);
                L.crown(c, x, top, w, h1, h2);
                var wg = (L.gap[0] + Math.floor(h1 * L.gap[1])) * K, hg = (L.gap[2] + Math.floor(h2 * L.gap[3])) * K;
                var ws = (L.size[0] + Math.floor(h1 * L.size[1])) * K, hs = (L.size[2] + Math.floor(h2 * L.size[3])) * K;
                var row = 0, col, wx, wy;
                c.fillStyle = "rgba(" + tint + "," + L.alpha + ")";
                for (wy = top + hg; wy < gy; wy += hg) {
                    col = 0;
                    for (wx = x + wg; wx < x + w - wg; wx += wg) {
                        if (Math.sin(col * L.pat[0] + row * L.pat[1] + i) > L.pat[2]) c.fillRect(wx, wy, ws, hs);
                        col++;
                    }
                    row++;
                }
            }
        });
    }

    function drawFront(c) {
        var gy = S.gy;
        c.clearRect(0, 0, W, H);
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
        tree: function (c, idx, sway) {
            var hw = 18, h = 16, edge = "#2BD1FC", lobes = [[0, 0, 21], [-16, 6, 13], [16, 6, 13]], cy = -62, sx = sway || 0;
            c.fillStyle = "#2a2540"; c.fillRect(-hw + 3, -2, 6, 2); c.fillRect(hw - 9, -2, 6, 2);
            c.beginPath(); c.moveTo(-hw + 2, -2); c.lineTo(-hw, -h + 3); c.lineTo(hw, -h + 3); c.lineTo(hw - 2, -2); c.closePath();
            c.fillStyle = "#0a2a3a"; c.strokeStyle = edge; c.lineWidth = 1.5; c.fill(); c.stroke();
            c.fillStyle = "#061a25"; c.fillRect(-hw + 3, -h + 8, hw * 2 - 6, 1.5);
            c.fillStyle = "#0a2a3a"; c.fillRect(-hw - 2, -h, hw * 2 + 4, 3.5);
            c.strokeStyle = edge; c.lineWidth = 1.2; c.strokeRect(-hw - 1.5, -h + 0.5, hw * 2 + 3, 3);
            c.fillStyle = "#04080c"; c.fillRect(-hw + 1, -h - 1.5, hw * 2 - 2, 1.5);
            var limbs = function () {
                c.beginPath();
                c.moveTo(0, -16); c.lineTo(sx, -46);
                c.moveTo(0, -32); c.lineTo(sx - 13, -52);
                c.moveTo(0, -37); c.lineTo(sx + 11, -56);
            };
            c.strokeStyle = "#3a3050"; c.lineWidth = 4.5; limbs(); c.stroke();
            c.strokeStyle = "#6a5a8a"; c.lineWidth = 1; limbs(); c.stroke();
            // the canopy: outlined on its outer edge only, then flat facets of light and shade inside
            var path = function () { c.beginPath(); lobes.forEach(function (l) { lobe(c, sx + l[0], cy + l[1], l[2]); }); };
            c.strokeStyle = "#00DFFF"; c.lineWidth = 3; c.lineJoin = "round";
            path(); c.stroke();
            c.fillStyle = "#2CC30F"; path(); c.fill();
            c.save(); path(); c.clip();
            lobes.forEach(function (l) {
                var lx = sx + l[0], ly = cy + l[1], r = l[2];
                c.fillStyle = "#1E9A0A";
                c.beginPath(); c.moveTo(lx - r, ly + r * 0.25); c.lineTo(lx + r, ly + r * 0.25); c.lineTo(lx + r, ly + r + 2); c.lineTo(lx - r, ly + r + 2); c.closePath(); c.fill();
                c.fillStyle = "#5BE83C";
                c.beginPath(); c.moveTo(lx - r * 0.75, ly - r * 0.2); c.lineTo(lx - r * 0.2, ly - r * 0.8); c.lineTo(lx + r * 0.25, ly - r * 0.6); c.lineTo(lx - r * 0.35, ly - r * 0.05); c.closePath(); c.fill();
            });
            c.restore();
        },
        cabinet: function (c) { drawCabinet(c, 2, CABINET_STREET); },
        // the pillar hydrant: a flanged base, the barrel and bonnet, two capped outlets with their chains
        hydrant: function (c) {
            var or = "#FF7A00";
            c.fillStyle = "#0c0812"; c.strokeStyle = or; c.lineWidth = 1.5; c.lineJoin = "miter"; c.shadowBlur = 3 * K * DPR; c.shadowColor = or;
            c.fillRect(-12, -19, 5, 7); c.strokeRect(-12, -19, 5, 7);
            c.fillRect(7, -19, 5, 7); c.strokeRect(7, -19, 5, 7);
            c.beginPath();
            c.moveTo(-6, -3); c.lineTo(-6, -23); c.lineTo(-7.5, -23); c.lineTo(-7.5, -26); c.lineTo(-5, -26);
            c.lineTo(-3, -31); c.lineTo(3, -31); c.lineTo(5, -26); c.lineTo(7.5, -26); c.lineTo(7.5, -23); c.lineTo(6, -23);
            c.lineTo(6, -3); c.closePath();
            c.fill(); c.stroke();
            c.fillRect(-9, -3, 18, 3); c.strokeRect(-9, -3, 18, 3);
            c.shadowBlur = 0;
            c.fillStyle = or; c.fillRect(-2, -34, 4, 3);
            c.fillStyle = "rgba(255,122,0,0.55)"; c.fillRect(-5, -13, 10, 1.5);
            c.fillStyle = "rgba(255,122,0,0.85)";
            c.fillRect(-10.5, -16.5, 2, 2); c.fillRect(8.5, -16.5, 2, 2);
            c.fillRect(-7, -2, 1.5, 1.5); c.fillRect(5.5, -2, 1.5, 1.5);
            c.strokeStyle = "rgba(200,210,230,0.45)"; c.lineWidth = 0.8;
            c.beginPath(); c.moveTo(-9.5, -12); c.quadraticCurveTo(-9, -8, -6, -9);
            c.moveTo(9.5, -12); c.quadraticCurveTo(9, -8, 6, -9); c.stroke();
        }
    };

    // The arcade's door, lit from inside while its tune is playing.
    function drawArcadeDoor(t) {
        var b = S.arcade;
        if (!b || t >= arcadeOpenUntil) return;
        var hex = b.def.hex, cx = b.x + b.w / 2, gy = S.gy, w = 44 * K, h = 64 * K, glow = 0.75 + 0.25 * Math.sin(t * 9);
        ctx.save();
        ctx.fillStyle = rgba(hex, 0.10 * glow);                     // light spilled on the pavement
        ctx.beginPath(); ctx.moveTo(cx - w / 2, gy); ctx.lineTo(cx + w / 2, gy); ctx.lineTo(cx + w * 1.5, gy + 14 * K); ctx.lineTo(cx - w * 1.5, gy + 14 * K); ctx.closePath(); ctx.fill();
        ctx.shadowColor = hex; ctx.shadowBlur = 14 * DPR;
        ctx.fillStyle = rgba(hex, 0.42 * glow);
        ctx.fillRect(cx - w / 2 + 2, gy - h + 2, w - 4, h - 2);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255," + (0.10 * glow).toFixed(3) + ")";
        ctx.fillRect(cx - 1, gy - h + 2, 2, h - 2);
        ctx.restore();
    }

    // The comm booth: two posts and a hood, solid glass, the wall unit with its screen and handset.
    // While a call is on, the screen is lit and the handset is off its hook.
    STREET_DRAW.booth = function (c) {
        var col = HOLD.col, onCall = !!holdCall;
        c.scale(0.75, 0.75);
        c.fillStyle = "#0b1016"; c.fillRect(-20, -4, 40, 4);
        c.strokeStyle = col; c.lineWidth = 2;
        strokePath(c, [-18, -4, -18, -76, 18, -4, 18, -76]);
        c.fillStyle = "#111820"; c.fillRect(-24, -84, 48, 10);
        c.strokeRect(-24, -84, 48, 10);
        c.fillStyle = "rgba(143,184,200,0.85)"; c.font = "bold 7px 'Source Code Pro', monospace";
        c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("COMM", 0, -78.5);
        c.fillStyle = "#0c141b"; c.fillRect(-16, -72, 32, 60);
        c.fillStyle = "rgba(143,184,200,0.08)"; c.beginPath(); c.moveTo(-16, -72); c.lineTo(-4, -72); c.lineTo(-16, -50); c.closePath(); c.fill();
        c.strokeStyle = "rgba(143,184,200,0.35)"; c.lineWidth = 1; c.strokeRect(-16.5, -72.5, 33, 61);
        c.fillStyle = "#18222c"; c.fillRect(-9, -60, 18, 26);
        c.strokeStyle = col; c.strokeRect(-8.5, -59.5, 17, 25);
        c.fillStyle = onCall ? "#DDF3FF" : "rgba(143,184,200,0.45)"; c.fillRect(-6, -56, 12, 6);
        c.fillStyle = "#0b1016";
        if (onCall) {                                           // lifted, the cord drawn out with it
            c.beginPath(); c.moveTo(9, -50); c.quadraticCurveTo(15, -40, 10, -30); c.stroke();
            c.save(); c.translate(10, -30); c.rotate(-0.5);
            c.fillRect(-2, -16, 4, 17); c.strokeRect(-1.5, -15.5, 3, 16); c.restore();
        } else {                                                // on its hook
            c.fillRect(9, -58, 4, 17); c.strokeRect(9.5, -57.5, 3, 16);
            c.beginPath(); c.moveTo(11, -41); c.quadraticCurveTo(16, -30, 6, -34); c.stroke();
        }
    };

    // What Keystone's line says, in a framed box over the booth while the call lasts.
    function drawHold(t) {
        if (!holdCall) return;
        if (t >= holdCall.until) { holdCall = null; return; }
        var text = holdCall.lines[Math.min(holdCall.lines.length - 1, Math.floor((t - holdCall.t0) / HOLD.each))];
        ctx.save();
        ctx.font = "600 " + Math.max(10, 10 * K).toFixed(1) + "px 'Source Code Pro', monospace";
        var tw = ctx.measureText(text).width, w = tw + 20, h = 22;
        var x = clamp(holdCall.x - w / 2, 12, Math.max(12, W - 12 - w)), y = S.gy - PROP_BOX.booth[1] * K - 14 - h;
        ctx.fillStyle = "rgba(3,3,9,0.9)"; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = HOLD.col; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.fillStyle = HOLD.col; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(text, x + 10, y + h / 2 + 1);
        ctx.restore();
    }

    // Street furniture is drawn every frame, so a bin can rattle and a tree can sway.
    function drawProps(t) {
        S.props.forEach(function (p) {
            var left = p.shakeUntil - t, sway = left > 0 ? Math.sin(left * 38) * 3 * Math.min(1, left / 0.4) : 0;
            ctx.save();
            ctx.translate(p.x + (p.kind === "bin" ? sway * 0.6 * K : 0), S.gy - 1);
            ctx.scale(K, K);
            STREET_DRAW[p.kind](ctx, p.idx, p.kind === "tree" ? sway : 0);
            ctx.restore();
        });
    }

    // ─── Background traffic ────────────────────────────────────────────────
    // The game's flying vehicles (_drawFlyingHovercarShape): a spinner, a hauler, a roadster, a van and
    // a limousine, in three depths behind the street's buildings.
    function carPath(c, pts) {
        c.beginPath();
        c.moveTo(pts[0], pts[1]);
        for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
        c.closePath();
    }
    function carBody(c, pts, fill, stroke, lw, glow) {
        c.fillStyle = fill; c.strokeStyle = stroke; c.lineWidth = lw;
        if (glow) { c.shadowBlur = glow * DPR; c.shadowColor = stroke; }
        carPath(c, pts); c.fill(); c.stroke();
        c.shadowBlur = 0;
    }
    function carGlass(c, pts, mullions, thin) {
        c.fillStyle = "rgba(10,8,28,0.9)"; c.strokeStyle = "#00DFFF"; c.lineWidth = thin;
        carPath(c, pts); c.fill(); c.stroke();
        if (mullions) { c.strokeStyle = "rgba(0,223,255,0.45)"; c.lineWidth = thin * 0.7; strokePath(c, mullions); }
    }
    function carPod(c, x, w, edge, ion, thin, depth) {
        c.fillStyle = "#0c0a1a"; c.strokeStyle = edge; c.lineWidth = thin;
        c.fillRect(x, -6, w, 6); c.strokeRect(x, -6, w, 6);
        c.fillStyle = "rgba(" + ion + ",0.85)"; c.fillRect(x + 2, -1.5, w - 4, 1.5);
        if (depth >= 2) {
            var ph = depth === 3 ? 6 : 3.5, g = c.createLinearGradient(0, 0, 0, ph);
            g.addColorStop(0, "rgba(" + ion + ",0.6)"); g.addColorStop(1, "rgba(" + ion + ",0)");
            c.fillStyle = g; c.fillRect(x + 3, 0, w - 6, ph);
        }
    }
    function carLamps(c, hx, hy, tx, ty, depth) {
        c.fillStyle = "#FFFFFF";
        if (depth === 3) { c.shadowBlur = 4 * DPR; c.shadowColor = "#FFFFFF"; }
        c.fillRect(hx - 2, hy - 1.5, 4, 3);
        c.shadowBlur = 0;
        c.fillStyle = "#FF1E40"; c.fillRect(tx - 1.5, ty - 1.5, 3, 3);
        if (depth >= 2) {
            var len = depth === 3 ? 12 : 7, g = c.createLinearGradient(tx, 0, tx - len, 0);
            g.addColorStop(0, "rgba(255,30,64,0.4)"); g.addColorStop(1, "rgba(255,30,64,0)");
            c.fillStyle = g; c.fillRect(tx - len, ty - 1, len, 2);
        }
    }
    function drawCar(hc) {
        var c = ctx, d = hc.depth, s = TRAFFIC.scale[d], col = hc.col, n = parseInt(col.slice(1), 16);
        var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        var paint = "rgb(" + Math.round(r * 0.42) + "," + Math.round(g * 0.42) + "," + Math.round(b * 0.42) + ")";
        var soft = rgba(col, 0.55), ion = (Math.max(r, g, b) - Math.min(r, g, b) < 60) ? "170,215,255" : r + "," + g + "," + b;
        var lw = (d === 1 ? 1.0 : d === 2 ? 1.4 : 1.8) / s, thin = (d === 1 ? 0.8 : d === 2 ? 1.0 : 1.2) / s, glow = d === 3 ? 3 : 0, x;
        c.save();
        c.globalAlpha = TRAFFIC.alpha[d];
        c.translate(hc.x, hc.y);
        c.scale(hc.vx >= 0 ? 1 : -1, 1);
        c.scale(s * K, s * K);
        c.lineJoin = "round";
        if (hc.variant === 1) {                 // hauler: a cab and a ribbed container on three pods
            carBody(c, [-78, -8, -78, -54, 30, -54, 30, -40, 62, -34, 72, -14, 72, 0, -78, 0], "#14121e", col, lw, glow);
            c.fillStyle = paint; carPath(c, [30, -40, 62, -34, 72, -14, 72, 0, 30, 0]); c.fill();
            c.strokeStyle = col; c.lineWidth = lw; line(c, 30, -54, 30, 0);
            carGlass(c, [36, -34, 53, -34, 60, -27, 60, -20, 36, -20], d >= 2 ? [48, -34, 48, -20] : null, thin);
            if (d >= 2) {
                c.strokeStyle = soft; c.lineWidth = thin; c.strokeRect(-70, -48, 92, 40);
                for (x = -60; x < 20; x += 12) line(c, x, -46, x, -10);
                c.fillStyle = "#FFB000";
                for (x = -72; x <= 24; x += 24) c.fillRect(x, -53, 3, 2);
            }
            carPod(c, -72, 34, col, ion, thin, d); carPod(c, -30, 34, col, ion, thin, d); carPod(c, 30, 36, col, ion, thin, d);
            carLamps(c, 70, -16, -77, -12, d);
        } else if (hc.variant === 2) {          // roadster: low and long, with a tail fin
            carBody(c, [-62, -6, -50, -20, -8, -26, 34, -20, 62, -8, 66, -2, 58, 0, -56, 0], paint, col, lw, glow);
            carGlass(c, [-30, -19, -6, -25, 24, -19, 10, -13, -30, -13], d >= 2 ? [-4, -24, -4, -13] : null, thin);
            if (d >= 2) { c.strokeStyle = soft; c.lineWidth = thin; line(c, -54, -9, 60, -9); }
            carBody(c, [-56, -8, -70, -24, -62, -24, -48, -12], paint, col, lw, 0);
            carPod(c, -44, 88, col, ion, thin, d);
            carLamps(c, 63, -5, -58, -8, d);
        } else if (hc.variant === 3) {          // van: a tall box with a livery band and a roof rack
            carBody(c, [-60, 0, -60, -44, 24, -46, 42, -36, 58, -18, 60, 0], paint, col, lw, glow);
            carGlass(c, [28, -40, 40, -34, 52, -20, 28, -20], null, thin);
            if (d >= 2) {
                c.fillStyle = rgba(col, 0.4); c.fillRect(-60, -26, 86, 4);
                c.strokeStyle = soft; c.lineWidth = thin; c.strokeRect(-18, -40, 30, 34);
                strokePath(c, [-54, -48, 18, -49, -48, -48, -48, -45, 12, -49, 12, -46]);
                carGlass(c, [-54, -38, -26, -38, -26, -30, -54, -30], null, thin);
            }
            carPod(c, -54, 30, col, ion, thin, d); carPod(c, 22, 32, col, ion, thin, d);
            carLamps(c, 57, -12, -59, -14, d);
        } else if (hc.variant === 5) {          // limousine: a long row of tinted windows on three pods
            carBody(c, [-86, -6, -74, -22, -30, -28, 34, -28, 62, -20, 86, -8, 88, 0, -82, 0], paint, col, lw, glow);
            carGlass(c, [-66, -22, -26, -26, -26, -14, -66, -14], d >= 2 ? [-46, -24, -46, -14] : null, thin);
            carGlass(c, [-20, -26, 28, -26, 28, -14, -20, -14], d >= 2 ? [4, -26, 4, -14] : null, thin);
            carGlass(c, [32, -25, 56, -18, 32, -14], null, thin);
            if (d >= 2) { c.strokeStyle = "rgba(224,242,254,0.7)"; c.lineWidth = thin; line(c, -80, -9, 84, -9); }
            carPod(c, -74, 34, col, ion, thin, d); carPod(c, -18, 36, col, ion, thin, d); carPod(c, 42, 34, col, ion, thin, d);
            carLamps(c, 85, -5, -82, -7, d);
        } else {                                // spinner: a wedge with a raked canopy and a spoiler
            carBody(c, [-56, -14, -44, -34, 8, -40, 42, -22, 58, -12, 50, 0, -48, 0], paint, col, lw, glow);
            carGlass(c, [-24, -32, 6, -38, 34, -22, 10, -13, -24, -13], d >= 2 ? [-6, -35, -6, -13, 16, -32, 16, -15] : null, thin);
            if (d >= 2) { c.strokeStyle = soft; c.lineWidth = thin; line(c, -50, -10, 52, -10); }
            c.strokeStyle = col; c.lineWidth = lw;
            c.beginPath(); c.moveTo(-56, -14); c.lineTo(-68, -32); c.lineTo(-58, -32); c.stroke();
            carPod(c, -42, 26, col, ion, thin, d); carPod(c, 14, 28, col, ion, thin, d);
            carLamps(c, 55, -12, -53, -16, d);
        }
        c.restore();
    }
    function maxCars() { return clamp(Math.round(W / 420), 2, 6); }
    function spawnCar(anywhere) {
        var r = Math.random(), depth = r < 0.6 ? 3 : r < 0.85 ? 2 : 1, dir = Math.random() < 0.5 ? 1 : -1;
        cars.push({ x: anywhere ? Math.random() * W : (dir > 0 ? -90 * K : W + 90 * K),
            y: S.laneTop + Math.random() * (S.laneBot - S.laneTop), depth: depth,
            vx: dir * (TRAFFIC.speed[depth] + Math.random() * TRAFFIC.extra) * K,
            variant: TRAFFIC.variants[Math.floor(Math.random() * TRAFFIC.variants.length)],
            col: TRAFFIC.colours[Math.floor(Math.random() * TRAFFIC.colours.length)] });
    }
    function updateCars(dt) {
        for (var i = cars.length - 1; i >= 0; i--) {
            cars[i].x += cars[i].vx * dt;
            if (cars[i].x < -140 * K || cars[i].x > W + 140 * K) cars.splice(i, 1);
        }
        if (cars.length < maxCars() && Math.random() < TRAFFIC.perSecond * dt) spawnCar(false);
    }
    function drawCars() {
        for (var depth = 1; depth <= 3; depth++) {
            for (var i = 0; i < cars.length; i++) if (cars[i].depth === depth) drawCar(cars[i]);
        }
    }

    // ─── The Overwatch patrol drone ────────────────────────────────────────
    // The game's patrol drone (_cityDrawPatrolDrone): a heavy wing bar with angular hardpoints, a hex
    // hull, one red eye and a survey beam. It comes in from one side, crosses and leaves.
    function drawPatrol(t) {
        if (!patrol) return;
        var c = ctx, col = PATROL.col, pulse = 0.5 + Math.sin(t * 3) * 0.5, eye = 0.6 + 0.4 * Math.sin(t * 3);
        c.save();
        c.translate(patrol.x, patrol.y);
        c.scale(patrol.dir * PATROL.scale * K, PATROL.scale * K);
        var g = c.createLinearGradient(0, 8, 0, 112);
        g.addColorStop(0, "rgba(255,0,0," + (0.18 * pulse).toFixed(3) + ")");
        g.addColorStop(1, "rgba(255,0,0,0)");
        c.fillStyle = g;
        c.beginPath(); c.moveTo(-5, 8); c.lineTo(5, 8); c.lineTo(30, 112); c.lineTo(-30, 112); c.closePath(); c.fill();
        c.strokeStyle = col; c.lineWidth = 2.4;
        line(c, -30, -3, 30, -3);
        c.fillStyle = "#000000"; c.lineWidth = 1.3;
        [-30, 30].forEach(function (rx) {
            c.beginPath(); c.moveTo(rx - 8, -3); c.lineTo(rx, -10); c.lineTo(rx + 8, -3); c.lineTo(rx, 5); c.closePath();
            c.fill(); c.stroke();
        });
        c.beginPath();
        c.moveTo(-21, 0); c.lineTo(-12, -8); c.lineTo(12, -8); c.lineTo(21, 0); c.lineTo(12, 8); c.lineTo(-12, 8); c.closePath();
        c.fill(); c.stroke();
        c.fillStyle = "rgba(255,255,255,0.04)";
        c.beginPath(); c.moveTo(-12, -8); c.lineTo(12, -8); c.lineTo(8, -3); c.lineTo(-8, -3); c.closePath(); c.fill();
        c.strokeStyle = "rgba(255,255,255,0.18)"; c.lineWidth = 1;
        line(c, -12, -8, 12, -8);
        c.fillStyle = "rgba(255,0,0," + eye.toFixed(2) + ")"; c.shadowBlur = 14 * DPR; c.shadowColor = "#FF0000";
        c.beginPath(); c.arc(0, 0, 5, 0, Math.PI * 2); c.fill();
        c.shadowBlur = 0;
        c.strokeStyle = "rgba(255,40,40,0.9)";
        c.beginPath(); c.arc(0, 0, 5, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = col; c.lineWidth = 1.3;
        line(c, 0, 8, 0, 13);
        c.fillStyle = "rgba(255,0,0," + (0.55 + 0.45 * pulse).toFixed(2) + ")";
        c.beginPath(); c.arc(0, 14, 2.4, 0, Math.PI * 2); c.fill();
        c.restore();
    }
    function updatePatrol(t, dt) {
        if (!patrol) {
            if (heat >= 80 && patrolAt > t + 2) patrolAt = t + 2;
            if (t < patrolAt) return;
            var dir = Math.random() < 0.5 ? 1 : -1;
            patrol = { x: dir > 0 ? -70 * K : W + 70 * K, y: S.patrolY, dir: dir };
        }
        patrol.x += patrol.dir * PATROL.speed * K * dt;
        patrol.y = S.patrolY + Math.sin(t * 1.3) * 4 * K;
        if (patrol.x < -80 * K || patrol.x > W + 80 * K) {
            patrol = null;
            patrolAt = t + PATROL.every[0] + Math.random() * PATROL.every[1];
        }
    }

    // ─── Loose bits and floating words ─────────────────────────────────────
    function addBit(x, y, vx, vy, col, size, life, grav) {
        bits.push({ x: x, y: y, vx: vx, vy: vy, col: col, w: size, h: size, life: life, max: life, g: grav === undefined ? 540 * K : grav });
    }
    function drawBits(dt) {
        var gy = S.gy, i, p;
        ctx.save();
        for (i = bits.length - 1; i >= 0; i--) {
            p = bits[i];
            p.life -= dt;
            if (p.life <= 0) { bits.splice(i, 1); continue; }
            if (p.y < gy - 2) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
            if (p.y >= gy - 2) { p.y = gy - 2; p.vx = 0; }
            ctx.globalAlpha = Math.min(1, p.life / (p.max * 0.5));
            ctx.fillStyle = p.col;
            ctx.fillRect(p.x - p.w / 2, p.y - p.h, p.w, p.h);
        }
        ctx.restore();
    }
    function addFloat(x, y, text, col) { floats.push({ x: x, y: y, text: text, col: col, t0: now() }); }
    function drawFloats(t) {
        ctx.save();
        ctx.font = "600 " + Math.max(10, 10 * K).toFixed(1) + "px 'Source Code Pro', monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (var i = floats.length - 1; i >= 0; i--) {
            var f = floats[i], age = t - f.t0;
            if (age > 1.4) { floats.splice(i, 1); continue; }
            ctx.globalAlpha = clamp(1.4 - age, 0, 1);
            ctx.fillStyle = f.col;
            ctx.fillText(f.text, clamp(f.x, 40, W - 40), f.y - age * 22 * K);
        }
        ctx.restore();
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

    // The game's street tags (GRAFFITI_STYLES in city_graffiti.js), each drawn inside +/-s, with the
    // points on its lower edge where paint runs.
    function tagStroke(c, s, col) {
        c.strokeStyle = col; c.fillStyle = col; c.lineWidth = Math.max(2, s * 0.14); c.lineJoin = "round"; c.lineCap = "round";
    }
    function tagPoly(c, pts) {
        c.beginPath();
        c.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
        c.closePath();
    }
    var TAG_STYLES = {
        operator_mark: { drips: [[0, 1], [-0.6, 0.72]], draw: function (c, s, col) {
            var pts = [], i, a;
            tagStroke(c, s, col);
            for (i = 0; i < 6; i++) { a = Math.PI / 6 + i * Math.PI / 3; pts.push([Math.cos(a) * s, Math.sin(a) * s]); }
            tagPoly(c, pts); c.stroke();
            c.font = "bold " + (s * 1.05).toFixed(1) + "px cyber, monospace"; c.textAlign = "center"; c.textBaseline = "middle";
            c.fillText("0", 0, s * 0.06);
        } },
        glitch_eye: { drips: [[-0.4, 0.55], [0.4, 0.55]], draw: function (c, s, col) {
            tagStroke(c, s, col);
            tagPoly(c, [[-s, 0], [-s * 0.4, -s * 0.55], [s * 0.4, -s * 0.55], [s, 0], [s * 0.4, s * 0.55], [-s * 0.4, s * 0.55]]); c.stroke();
            c.fillRect(-s * 0.22, -s * 0.22, s * 0.44, s * 0.44);
            c.fillRect(s * 0.3, -s * 0.12, s * 0.16, s * 0.16);
        } },
        bolt: { drips: [[-0.3, 1], [-0.05, 0.1]], draw: function (c, s, col) {
            tagStroke(c, s, col);
            tagPoly(c, [[s * 0.25, -s], [-s * 0.6, s * 0.1], [-s * 0.05, s * 0.1], [-s * 0.3, s], [s * 0.6, -s * 0.15], [s * 0.05, -s * 0.15]]); c.stroke();
        } },
        crown: { drips: [[-0.7, 0.85], [0.5, 0.85]], draw: function (c, s, col) {
            tagStroke(c, s, col);
            tagPoly(c, [[-s, s * 0.55], [-s, -s * 0.5], [-s * 0.5, 0], [0, -s * 0.8], [s * 0.5, 0], [s, -s * 0.5], [s, s * 0.55]]); c.stroke();
            line(c, -s, s * 0.85, s, s * 0.85);
        } },
        null_sig: { drips: [[-0.38, 0.92], [0.38, 0.92]], draw: function (c, s, col) {
            var pts = [], i, a;
            tagStroke(c, s, col);
            for (i = 0; i < 8; i++) { a = Math.PI / 8 + i * Math.PI / 4; pts.push([Math.cos(a) * s, Math.sin(a) * s]); }
            tagPoly(c, pts); c.stroke();
            line(c, -s * 0.6, s * 0.6, s * 0.6, -s * 0.6);
        } },
        arrow_up: { drips: [[-0.4, 1], [0.3, 1]], draw: function (c, s, col) {
            tagStroke(c, s, col);
            c.beginPath();
            c.moveTo(0, s); c.lineTo(0, -s * 0.85);
            c.moveTo(-s * 0.7, -s * 0.15); c.lineTo(0, -s * 0.9); c.lineTo(s * 0.7, -s * 0.15);
            c.moveTo(-s * 0.55, s); c.lineTo(s * 0.55, s);
            c.stroke();
        } },
        circuit: { drips: [[-1, 0.6], [0.9, 0.7]], draw: function (c, s, col) {
            tagStroke(c, s, col);
            c.beginPath();
            c.moveTo(-s, s * 0.6); c.lineTo(-s * 0.3, s * 0.6); c.lineTo(0, 0); c.lineTo(s * 0.5, 0); c.lineTo(s * 0.5, -s * 0.7);
            c.moveTo(-s * 0.7, -s * 0.8); c.lineTo(-s * 0.7, -s * 0.2); c.lineTo(-s * 0.2, -s * 0.2);
            c.stroke();
            [[-s, s * 0.6], [s * 0.5, -s * 0.7], [-s * 0.7, -s * 0.8], [s * 0.9, s * 0.7]].forEach(function (p) {
                c.beginPath(); c.arc(p[0], p[1], s * 0.13, 0, Math.PI * 2); c.fill();
            });
            c.beginPath(); c.moveTo(s * 0.5, 0); c.lineTo(s * 0.9, s * 0.35); c.lineTo(s * 0.9, s * 0.7); c.stroke();
        } },
        // the four syndicate marks
        offbook: { drips: [[-0.75, 0.9], [0.5, 0.9]], draw: function (c, s, col) {         // a ledger struck through
            tagStroke(c, s, col);
            c.strokeRect(-s * 0.75, -s * 0.9, s * 1.5, s * 1.8);
            c.beginPath();
            for (var i = -1; i <= 1; i++) { c.moveTo(-s * 0.45, i * s * 0.45); c.lineTo(s * 0.45, i * s * 0.45); }
            c.moveTo(-s, s); c.lineTo(s, -s);
            c.stroke();
        } },
        crimson_row: { drips: [[0, 0.99], [-0.85, 0.54]], draw: function (c, s, col) {      // three chevrons
            tagStroke(c, s, col);
            c.beginPath();
            for (var i = 0; i < 3; i++) {
                var y = -s * 0.7 + i * s * 0.62;
                c.moveTo(-s * 0.85, y); c.lineTo(0, y + s * 0.45); c.lineTo(s * 0.85, y);
            }
            c.stroke();
        } },
        stackrunners: { drips: [[-0.8, 0.85], [0.65, 0.85]], draw: function (c, s, col) {   // stacked floors, one way up
            tagStroke(c, s, col);
            c.beginPath();
            for (var i = 0; i < 3; i++) { var y = s * 0.85 - i * s * 0.42; c.moveTo(-s * 0.8 + i * s * 0.12, y); c.lineTo(s * 0.35 - i * s * 0.12, y); }
            c.moveTo(s * 0.65, s * 0.85); c.lineTo(s * 0.65, -s * 0.9);
            c.moveTo(s * 0.3, -s * 0.5); c.lineTo(s * 0.65, -s * 0.9); c.lineTo(s, -s * 0.5);
            c.stroke();
        } },
        gridrot: { drips: [[-0.9, 0.9], [0.3, 0.9]], draw: function (c, s, col) {           // a grid with pieces missing
            var g = s * 0.9, t = g / 3 * 2;
            tagStroke(c, s, col);
            c.beginPath();
            c.moveTo(-g, -g); c.lineTo(g - t * 0.6, -g);
            c.moveTo(g, -g + t * 0.6); c.lineTo(g, g); c.lineTo(-g, g); c.lineTo(-g, -g);
            c.moveTo(-g / 3, -g); c.lineTo(-g / 3, g * 0.2);
            c.moveTo(g / 3, -g * 0.1); c.lineTo(g / 3, g);
            c.moveTo(-g, -g / 3); c.lineTo(g * 0.1, -g / 3);
            c.moveTo(-g * 0.3, g / 3); c.lineTo(g, g / 3);
            c.stroke();
        } }
    };
    function tagHalf() { return Math.max(13, TAG_HALF * K); }

    // A tag is revealed left to right while it is sprayed, inside a ring that turns red if the
    // operator is seen; once done, two runs of paint hang from it.
    function drawTags(t) {
        var s = tagHalf();
        tags.forEach(function (g) {
            var p = clamp((t - g.t0) / TAG_TIME, 0, 1), st = TAG_STYLES[g.style];
            ctx.save();
            ctx.translate(g.x, g.y);
            ctx.save();
            ctx.rotate(g.rot);
            if (p < 1) { ctx.beginPath(); ctx.rect(-s * 1.3, -s * 1.6, s * 2.6 * p, s * 3.6); ctx.clip(); }
            ctx.shadowColor = g.col; ctx.shadowBlur = 6 * DPR;
            st.draw(ctx, s, g.col);
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 0.6; ctx.fillStyle = g.col;
            st.drips.forEach(function (d, k) {
                var len = g.len[k] * (s / TAG_HALF) * p;
                ctx.fillRect(d[0] * s - 0.8, d[1] * s - 1, 1.6, len + 1);
                ctx.fillRect(d[0] * s - 1.2, d[1] * s + len, 2.4, 2.4);
            });
            ctx.restore();
            if (p < 1) {
                ctx.strokeStyle = g.seen ? "#FF2020" : g.col; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(0, 0, s * 1.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); ctx.stroke();
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
        updateCars(dt);
        updatePatrol(t, dt);
    }

    function updateHeat(t, dt, cone) {
        // seen in the camera's cone, or under the patrol drone's beam
        seen = (!!cone && op.x > cone.x1 && op.x < cone.x2) || (!!patrol && Math.abs(op.x - patrol.x) < PATROL.beam * K);
        tags.forEach(function (g) { if (seen && t - g.t0 < TAG_TIME) g.seen = true; });
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
        ctx.drawImage(backLayer, 0, 0, W, H);
        drawCars();
        ctx.drawImage(frontLayer, 0, 0, W, H);
        drawTags(t);
        drawArcadeDoor(t);
        drawProps(t);
        S.lamps.forEach(drawLamp);
        var cone = S.cam ? drawCamera(t) : null;
        drawPatrol(t);
        drawOperator();
        drawDrone();
        drawBits(dt);
        drawFloats(t);
        drawHold(t);
        drawScan(t);
        if (dt > 0) drawRain(dt);
        return cone;
    }

    // ─── The tune ──────────────────────────────────────────────────────────
    // js/streetmusic.js plays it: the game's own Lower Streets music, composed as it goes. It starts
    // only when the button is pressed (browsers allow nothing sooner), and its tension follows the heat.
    var soundBtn = document.getElementById("sound");
    var player = (window.StreetMusic && (window.AudioContext || window.webkitAudioContext))
        ? window.StreetMusic.create({ volume: 0.6 }) : null;

    // A short blip for the things that answer a click, while the sound is on.
    function sfx(freq, slideTo, dur, type) { if (player) player.blip(freq, slideTo, dur, type); }
    // A burst of filtered noise: a spray can, a rattle, rushing water.
    function hiss(seconds, type, freq, vol) { if (player) player.hiss(seconds, type, freq, vol); }

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
    // a streetlight breaks or is mended; a bare wall takes a tag; the vending machine drops a can, a
    // bin can be rummaged, the hydrant sprays and a tree shakes. The arcade's door lets its tune out,
    // and the comm booth rings Keystone, who put you on hold.
    function setOperatorColour(i) {
        op.colour = i % OP_COLOURS.length;
        var root = document.documentElement.style;
        root.setProperty("--op", OP_COLOURS[op.colour]);
        root.setProperty("--op-rgb", rgbOf(OP_COLOURS[op.colour]));
        if (backLayer) drawBack();      // the skyline's windows take the operator's colour
    }

    function near(x, y, tx, ty, r) { return Math.abs(x - tx) <= r && Math.abs(y - ty) <= r; }

    function sprayAt(x, y, t) {
        var F = FACADE, hit = null, half = tagHalf() + 4;
        S.near.forEach(function (b) { if (x > b.x && x < b.x + b.w && y > S.gy - b.h && y < S.gy) hit = b; });
        if (!hit || hit.w < half * 2 + 8) return;
        var tx = clamp(x, hit.x + half, hit.x + hit.w - half);
        var ty = clamp(y, S.gy - hit.h + half + 4 * K, S.gy - half - 6 * K);
        // doors refuse it
        if (Math.abs(tx - (hit.x + hit.w / 2)) < 36 * K + half && ty > S.gy - 90 * K - half) ty = S.gy - F.storeH * K - half - 6 * K;
        var r = rng(Math.floor(x * 31 + y * 17) + tagNext);
        tags.push({ x: tx, y: ty, style: TAG_ORDER[tagNext++ % TAG_ORDER.length], col: OP_COLOURS[op.colour], rot: (r() - 0.5) * 0.16,
            t0: t, seen: seen, len: [4 + r() * 9, 4 + r() * 9] });
        if (tags.length > TAG_MAX) tags.shift();
        hiss(0.5, "highpass", 3600, 0.1);
        if (seen) heat = clamp(heat + HEAT.tag, 0, 100);
    }

    // The arcade's door: its chip tune for half a minute, heard through the door, or shut again.
    // With the sound off the door only lights for a moment.
    function toggleArcade(t) {
        if (player && player.tunePlaying() === "arcade") { player.stopTune(); return; }
        var heard = !!player && player.playTune("arcade", 30, function () { arcadeOpenUntil = 0; });
        arcadeOpenUntil = t + (heard ? 30 : 3);
    }

    function useProp(p, t) {
        var gy = S.gy, i, dir;
        if (p.kind === "vending") {
            var br = VEND_BRANDS[p.idx % VEND_BRANDS.length];
            bits.push({ x: p.x - 4 * K, y: gy - 10 * K, vx: -26 * K, vy: -70 * K, col: br.col, w: 4 * K, h: 7 * K, life: 2.6, max: 2.6, g: 540 * K });
            addFloat(p.x, gy - 70 * K, "-5 BITS", "#FFD700");
            sfx(150, 60, 0.14, "sine");
        } else if (p.kind === "bin") {
            p.shakeUntil = t + 0.5;
            for (i = 0; i < 6; i++) addBit(p.x + (Math.random() - 0.5) * 14 * K, gy - 30 * K, (Math.random() - 0.5) * 120 * K, -(60 + Math.random() * 90) * K, ["#39FF14", "#00DFFF", "#737b9e"][i % 3], 2.2 * K, 1.1);
            addFloat(p.x, gy - 46 * K, p.used ? "EMPTY" : "+3 BITS", p.used ? "#737b9e" : "#FFD700");
            p.used = true;
            hiss(0.18, "bandpass", 900, 0.16);
        } else if (p.kind === "hydrant") {
            // a jet out of each cap, a little lift, then gravity (the game's own spray)
            [-1, 1].forEach(function (d) {
                for (i = 0; i < 11; i++) addBit(p.x + d * 11 * K, gy - 15 * K + (Math.random() - 0.5) * 3, d * (96 + Math.random() * 144) * K, -(18 + Math.random() * 78) * K, ["#00DFFF", "#2BD1FC", "#7BFFF0", "#FFFFFF"][i % 4], (1.2 + Math.random() * 1.6) * K, 0.8 + Math.random() * 0.8);
            });
            hiss(0.7, "bandpass", 2400, 0.12);
        } else if (p.kind === "booth") {
            // Keystone's support line: the hold music and what it says, or hang up if a call is on.
            // With the sound off the lines still show.
            if (holdCall) {
                if (player && player.tunePlaying() === "hold") player.stopTune(); else holdCall = null;
            } else {
                if (player) player.playTune("hold", HOLD.seconds, function () { holdCall = null; });
                holdCall = { t0: t, until: t + HOLD.seconds, x: p.x,
                    lines: ["PLEASE HOLD. YOU ARE CALLER " + (50 + Math.floor(Math.random() * 15)) + "."].concat(HOLD.lines) };
            }
        } else if (p.kind === "tree") {
            p.shakeUntil = t + 0.8;
            for (i = 0; i < 5; i++) { dir = (Math.random() - 0.5); addBit(p.x + dir * 40 * K, gy - (50 + Math.random() * 30) * K, dir * 40 * K, 10 * K, i % 2 ? "#2CC30F" : "#5BE83C", 2.4 * K, 1.6, 120 * K); }
            hiss(0.35, "highpass", 5200, 0.07);
        } else {
            return false;
        }
        return true;
    }

    function onClick(e) {
        var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, t = now(), i, l, p, box;
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
        if (S.arcade && Math.abs(x - (S.arcade.x + S.arcade.w / 2)) <= 24 * K && y < S.gy && y > S.gy - 68 * K) { toggleArcade(t); return; }
        for (i = 0; i < S.props.length; i++) {
            p = S.props[i]; box = PROP_BOX[p.kind];
            if (Math.abs(x - p.x) <= Math.max(12, box[0] * K) && y < S.gy + 4 && y > S.gy - box[1] * K - 4) {
                if (useProp(p, t)) return;
                break;
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
