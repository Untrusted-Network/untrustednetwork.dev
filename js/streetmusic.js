// streetmusic.js - the game's street music, for the page.
//
// A port of what plays on Lower Streets in [MODE-ZERO]: the STREET theme of the game's composer
// (script/audio/audio_music.js and audio_drums.js, as they stood on 2026-10-09). If the game's music
// changes, this file is brought back in step by hand. Everything is synthesised live: no audio files.
//
// The music is built from SONGS, and every part of a song repeats long enough to be learnt:
//   - a key and a mode (aeolian or dorian), and four chords of two bars each
//   - a hook: one bar of sixteen steps and its answer, written as places in a chord's seven notes,
//     so the same shape is heard over every chord
//   - three rhythms for the hook, a bass figure, a drum kit, a lead voice and a three-note bell
// A song runs through three sections (walk, watched, shelter) and is then followed by another with
// a new hook and bell, which may keep or change the rest. Tension (0 to 1) opens the filters, and
// at 0.55 or more every bar is played at full intensity.
//
// Two of the game's house tunes can be played over it, the street music stepping back while they do:
//   "arcade"  the Pixel Arcade's chip tune, muffled as if heard through its door
//   "hold"    Keystone's support-line hold music, thin as if down a phone
//
//   var music = StreetMusic.create({ volume: 0.6 });
//   music.start();                  // from a click or key press: browsers block audio until then
//   music.stop();
//   music.toggle();                 // returns true when it is now playing
//   music.setTension(0.6);
//   music.playTune("arcade", 30, done);   // for that many seconds; `done` is called when it ends
//   music.stopTune();
//   music.blip(660, 990, 0.09);
//   music.hiss(0.5, "highpass", 3600, 0.1);
(function () {
    "use strict";

    // ─── The composer's tables (the game's own) ────────────────────────────
    var KEYS = [40, 42, 43, 45, 47, 48];                    // the key note in the bass (MIDI): E F# G A B C
    var MODES = {
        aeolian: [0, 2, 3, 5, 7, 8, 10],
        dorian:  [0, 2, 3, 5, 7, 9, 10]
    };
    // Four chords as steps of the mode (0 is the key's own chord).
    var PROGRESSIONS = {
        aeolian: [[0, 5, 3, 4], [0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6], [0, 2, 6, 3], [0, 4, 5, 3], [5, 6, 0, 0]],
        dorian:  [[0, 3, 0, 6], [0, 2, 3, 0], [0, 6, 3, 0], [0, 4, 3, 6], [0, 3, 6, 2]]
    };
    // A bass figure: [step, length in steps, semitones over the chord's root, level]. "lift" is the
    // fifth at full intensity, else the octave on a chord's second bar.
    var BASSES = {
        "332":   [[0, 5, 0, 1], [6, 3, 0, 0.8], [12, 3, "lift", 0.8]],
        offbeat: [[0, 3, 0, 1], [3, 2, 0, 0.7], [6, 3, 12, 0.75], [10, 3, 0, 0.8], [14, 2, 7, 0.7]],
        long:    [[0, 12, 0, 0.75]]
    };
    // A lead voice: two oscillators through a low-pass that snaps shut.
    var LEADS = {
        pluck: { a: "square",   b: "triangle", ratio: 2, detune: 5,  mix: 0.4,  q: 4, decay: 0.22, echo: 0.45, level: 1.0 },
        saw:   { a: "sawtooth", b: "sawtooth", ratio: 1, detune: 11, mix: 0.9,  q: 3, decay: 0.28, echo: 0.35, level: 0.8 },
        reed:  { a: "triangle", b: "square",   ratio: 1, detune: -7, mix: 0.25, q: 2, decay: 0.34, echo: 0.40, level: 1.25 }
    };
    // A kit: for each of the three intensities, where its kick, snare, rim and hats fall
    // (x a hit, - a soft hat, o an open hat).
    var KITS = {
        street: {
            kick:  ["x...............", "x.........x.....", "x.........x....."],
            snare: ["", "", ""],
            rim:   ["", "............x...", "....x.......x..."],
            hat:   ["x.x.x.x.x.x.x.x.", "x.x.x.x.x.x.x.x.", "x.x.x.x.x.x.x.o."]
        },
        "break": {
            kick:  ["x...............", "x.....x...x.....", "x.....x...x....."],
            snare: ["", "", "....x.......x..."],
            rim:   ["", "....x.......x...", ""],
            hat:   ["x...x...x...x...", "x.x.x.x.x.x.x.x.", "x.x.x.x-x.x.x.xo"]
        },
        half: {
            kick:  ["x...............", "x.........x.....", "x......x..x....."],
            snare: ["", "", "........x......."],
            rim:   ["", "........x.......", ""],
            hat:   ["x...x...x...x...", "x.x.x.x.x.x.x.x.", "x.x.x.x.x.x.x-x-"]
        }
    };
    // The STREET theme, as Lower Streets plays it (the district has no mood of its own).
    var THEME = { bpm: [92, 102], swing: 0.12, modes: ["aeolian", "aeolian", "dorian"], kits: ["street", "street", "break", "half"],
        basses: ["332", "332", "offbeat"], drums: 0.50, dMin: 0.7, dMax: 1.2 };
    var HOOK_FORMS = [["lift", "same"], ["same", "lift"], ["lift", "lift2"], ["other", "same"], ["same", "other"]];
    var HOOK_TURNS = [[0, -1, -2, -1], [0, -2, -1, -3], [0, 0, -1, -2], [-1, 0, -2, -1], [0, -1, 0, -2]];
    var HOOK_ENDS  = [[0, -1, -1, -2, -3, -3, -4, -5], [-2, -1, 0, 0, -1, -2, -3, -4], [0, -2, -1, -3, -2, -4, -3, -5]];

    // ─── The house tunes ───────────────────────────────────────────────────
    // The Pixel Arcade's chip tune (city_arcade.js): sixteen steps a bar, Am F C G.
    var ARCADE = {
        step: 0.17, lowpass: 900, level: 4.8,
        lead: [
            [69, 0, 72, 76, 81, 0, 76, 72, 69, 0, 72, 76, 79, 76, 72, 0],
            [65, 0, 69, 72, 77, 0, 72, 69, 65, 0, 69, 72, 76, 72, 69, 0],
            [72, 0, 76, 79, 84, 0, 79, 76, 72, 0, 76, 79, 83, 79, 76, 0],
            [67, 0, 71, 74, 79, 0, 74, 71, 67, 0, 71, 74, 79, 83, 86, 0]
        ],
        bass: [45, 41, 48, 43],
        gain: { lead: 0.135, bass: 0.23, kick: 0.28 }
    };
    // Keystone's hold music (city_comm_booths.js): four bars of arpeggio over a bass note, in eighths.
    var HOLD = {
        step: 0.19, level: 12,
        bars: [
            [261.6, 329.6, 392.0, 329.6, 523.3, 392.0, 329.6, 392.0],
            [220.0, 261.6, 329.6, 261.6, 440.0, 329.6, 261.6, 329.6],
            [174.6, 220.0, 261.6, 220.0, 349.2, 261.6, 220.0, 261.6],
            [196.0, 246.9, 293.7, 246.9, 392.0, 293.7, 246.9, 196.0]
        ]
    };

    var AHEAD = 0.2, TICK_MS = 25, MAX_DRAIN = 8;

    function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
    function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    // k hits spread as evenly as they will go over sixteen steps; the first step always has one
    function euclid(k) {
        var out = [];
        for (var i = 0; i < 16; i++) out.push((i * k) % 16 < k);
        return out;
    }
    // One chord of a mode: its bass note, the pad's four notes and the seven notes the hook walks.
    function chordOf(key, mode, deg) {
        function at(d) { return mode[d % 7] + 12 * Math.floor(d / 7); }
        var off = at(deg), third = at(deg + 2) - off, seventh = at(deg + 6) - off;
        var root = key + off - (off >= 5 ? 12 : 0);             // the bass keeps at or under the key note
        var low = key + 11, steps = [0, third, 7];
        if (third === 3 && seventh === 10) steps.push(10);      // a minor chord takes its seventh
        var pad = [root + 12];
        [third, 7, steps.length === 4 ? 10 : 12].forEach(function (iv) {
            pad.push(low + (((root + iv - low) % 12) + 12) % 12);
        });
        var tones = [root + 12], n = key + 12;
        while (tones.length < 7) {
            if (n > root + 12 && steps.indexOf((((n - root) % 12) + 12) % 12) >= 0) tones.push(n);
            n++;
        }
        return { root: root, pad: pad, tones: tones };
    }
    // The hook, as places (0 to 6) in a chord's seven notes. Bar A is four cells of four steps: a cell
    // stated, then repeated, lifted or answered, and a turn to close. Bar B keeps A's first half, so
    // the hook is known again, then goes home.
    function newHook() {
        function newCell() {
            var c = [0], v = 0;
            for (var i = 1; i < 4; i++) {
                v += pick([-2, -1, 0, 1, 1, 1, 2, 3]);
                if (v < 0) v = 1;
                c.push(v);
            }
            if (c[3] <= 0) c[3] = c[2] + 1;                     // a cell goes somewhere
            return c;
        }
        function shift(c, by) { return c.map(function (x) { return x + by; }); }
        function fit(list) {                                    // past the ends, a line turns back
            return list.map(function (x) {
                while (x < 0 || x > 6) x = (x < 0) ? -x : 12 - x;
                return x;
            });
        }
        var cell = newCell(), other = shift(newCell(), pick([1, 2])), lift = pick([1, 2, 2, 3]);
        var parts = { same: cell, lift: shift(cell, lift), lift2: shift(cell, lift * 2), other: other };
        var form = pick(HOOK_FORMS), a = cell.concat(parts[form[0]], parts[form[1]]);
        a = a.concat(shift(pick(HOOK_TURNS), Math.max.apply(null, a) + 1));
        var b = a.slice(0, 8).concat(shift(pick(HOOK_ENDS), Math.max.apply(null, a) + 1));
        a = fit(a); b = fit(b);
        a[0] = 0; b[0] = 0;                                     // every bar starts on the chord's root
        return { a: a, b: b };
    }

    function create(opts) {
        opts = opts || {};
        var volume = typeof opts.volume === "number" ? opts.volume : 0.6;
        var ctx = null, master = null, out = null, street = null, house = null, sidechain = null, delayNode = null, reverbIn = null, bed = null;
        var on = false, timer = 0, tension = 0.2;
        var song = null, bpm = 96, step = 0, nextTime = 0, barCount = 0, section = 0, sectionBar = 0, barLevel = 1;
        var drift = 1, driftTarget = 1, driftTimer = 0;
        var tune = null;        // a house tune playing over the street: { name, at, i, until, done, bus }

        function tidy(src, nodes) {
            src.onended = function () {
                try { src.disconnect(); nodes.forEach(function (n) { n.disconnect(); }); } catch (e) { /* already gone */ }
            };
        }
        function noiseBuf(seconds) {
            var len = Math.ceil(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
            for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            return buf;
        }
        function loopedNoise(type, freq, q, gain, to) {
            var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
            src.buffer = noiseBuf(11); src.loop = true;
            f.type = type; f.frequency.value = freq;
            if (q) f.Q.value = q;
            g.gain.value = gain;
            src.connect(f); f.connect(g); g.connect(to);
            src.start(0);
            return { filter: f, gain: g };
        }
        // a rise to the peak, a hold, then a fall away to nothing
        function shape(param, t, peak, attack, hold, release) {
            param.setValueAtTime(0.0001, t);
            param.linearRampToValueAtTime(peak, t + attack);
            param.setValueAtTime(peak, t + attack + hold);
            param.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
        }
        function send(node, to, amount) {
            var s = ctx.createGain();
            s.gain.value = amount;
            node.connect(s); s.connect(to);
            return s;
        }

        // every voice -> out -> a gentle compressor -> the street bus -> sidechain (the kick ducks it)
        // -> a tape warble -> master. The house tunes have a bus of their own, straight to the master.
        function wire() {
            master = ctx.createGain();
            master.gain.value = volume;
            master.connect(ctx.destination);

            var vhs = ctx.createDelay();
            vhs.delayTime.value = 0.050;
            [[0.13, 0.0035], [0.27, 0.0025]].forEach(function (l) {
                var lfo = ctx.createOscillator(), depth = ctx.createGain();
                lfo.frequency.value = l[0]; depth.gain.value = l[1];
                lfo.connect(depth); depth.connect(vhs.delayTime);
                lfo.start();
            });
            vhs.connect(master);
            sidechain = ctx.createGain();
            sidechain.connect(vhs);
            street = ctx.createGain();
            street.connect(sidechain);
            house = ctx.createGain();
            var limit = ctx.createDynamicsCompressor();             // holds down the loudest hits of a house tune
            limit.threshold.value = -1; limit.knee.value = 0; limit.ratio.value = 12;
            limit.attack.value = 0.001; limit.release.value = 0.08;
            house.connect(limit); limit.connect(master);

            out = ctx.createGain();
            var comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3;
            comp.attack.value = 0.01; comp.release.value = 0.25;
            out.connect(comp); comp.connect(street);

            // an echo whose repeats get darker
            var tone = ctx.createBiquadFilter(), fb = ctx.createGain(), back = ctx.createGain();
            delayNode = ctx.createDelay(2);
            delayNode.delayTime.value = 0.45;
            fb.gain.value = 0.34;
            tone.type = "lowpass"; tone.frequency.value = 2400;
            back.gain.value = 0.5;
            delayNode.connect(tone); tone.connect(fb); fb.connect(delayNode);
            tone.connect(back); back.connect(out);

            // a reverb from a burst of decaying noise
            var len = Math.ceil(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate), ch, i, d;
            for (ch = 0; ch < 2; ch++) {
                d = ir.getChannelData(ch);
                for (i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
            }
            var wet = ctx.createGain();
            reverbIn = ctx.createConvolver();
            reverbIn.buffer = ir;
            wet.gain.value = 0.5;
            reverbIn.connect(wet); wet.connect(out);

            bed = loopedNoise("lowpass", 220, 0, 0.014, street);    // the music's own bed, opened by tension
            loopedNoise("bandpass", 140, 0.5, 0.025, street);       // the street's hum
            loopedNoise("bandpass", 2600, 0.4, 0.006, street);      // the page's rain
            applyTension(0.01);
        }
        function applyTension(seconds) {
            if (!bed) return;
            var end = ctx.currentTime + seconds;
            bed.filter.frequency.linearRampToValueAtTime(150 + tension * 1500, end);
            bed.gain.gain.linearRampToValueAtTime(0.002 + tension * 0.015, end);
        }

        // ── the song ────────────────────────────────────────────────────────
        // With `old`, the new song is its successor: the hook and the bell are always new, the tempo
        // stays, and each of the rest is kept or redrawn on a coin.
        function newSong(old) {
            var s = {};
            s.mode = (old && Math.random() < 0.5) ? old.mode : pick(THEME.modes);
            s.key  = (old && Math.random() < 0.6) ? old.key  : pick(KEYS);
            s.prog = (old && old.mode === s.mode && Math.random() < 0.4) ? old.prog : pick(PROGRESSIONS[s.mode]);
            s.kit  = (old && Math.random() < 0.5) ? old.kit  : pick(THEME.kits);
            s.bass = (old && Math.random() < 0.5) ? old.bass : pick(THEME.basses);
            s.lead = (old && Math.random() < 0.5) ? old.lead : pick(Object.keys(LEADS));
            s.bpm  = old ? old.bpm : Math.round(THEME.bpm[0] + Math.random() * (THEME.bpm[1] - THEME.bpm[0]));
            var mode = MODES[s.mode], hook = newHook();
            s.chords = s.prog.map(function (deg) { return chordOf(s.key, mode, deg); });
            s.hookA = hook.a;
            s.hookB = hook.b;
            s.hits  = [euclid(pick([3, 4])), euclid(pick([5, 6, 7])), euclid(pick([8, 9, 10]))];
            // the bell: three notes of the key's pentatonic, two octaves over the bass
            var penta = [0, 2, 3, 4, 6].map(function (d) { return s.key + 24 + mode[d]; }).concat(s.key + 36);
            var a = Math.floor(Math.random() * 3), b = a + 1 + Math.floor(Math.random() * 2), c = Math.max(0, a - Math.floor(Math.random() * 2));
            s.bell      = [penta[a], penta[b], penta[c]];
            s.bellSteps = pick([[4, 10, 14], [2, 8, 12], [6, 10, 14]]);
            s.bars      = [pick([8, 16]), pick([16, 16, 24]), 8];   // walk, watched, shelter
            song = s;
            bpm = s.bpm;
            barCount = 0; section = 0; sectionBar = 0;
        }
        function mutate() {         // one note of the hook moves a step
            var hook = Math.random() < 0.5 ? song.hookA : song.hookB, at = 1 + Math.floor(Math.random() * 15);
            hook[at] = clamp(hook[at] + pick([-1, 1]), 0, 6);
        }
        function startBar() {
            if (sectionBar >= song.bars[section]) {
                section = (section + 1) % 3;
                sectionBar = 0;
                if (section === 0) newSong(song);
            } else if (barCount > 0 && barCount % 8 === 0) {
                mutate();
            }
            barLevel = tension >= 0.55 ? 2 : [1, 2, 0][section];
        }

        // ── voices ──────────────────────────────────────────────────────────
        function playPad(chord, t, dur) {
            var filter = ctx.createBiquadFilter(), gain = ctx.createGain(), last = null;
            filter.type = "lowpass"; filter.Q.value = 0.7;
            filter.frequency.setValueAtTime(480, t);
            filter.frequency.linearRampToValueAtTime(820 + tension * 500, t + dur * 0.55);
            filter.frequency.linearRampToValueAtTime(560, t + dur + 0.8);
            shape(gain.gain, t, 1, 0.9, Math.max(0.1, dur - 0.9), 1.3);
            filter.connect(gain); gain.connect(out);
            var rv = send(gain, reverbIn, 0.5);
            chord.pad.forEach(function (m) {
                [["sawtooth", -7, 0.018], ["sawtooth", 7, 0.018], ["triangle", 0, 0.03]].forEach(function (v) {
                    var o = ctx.createOscillator(), g = ctx.createGain();
                    o.type = v[0]; o.frequency.value = hz(m); o.detune.value = v[1];
                    g.gain.value = v[2];
                    o.connect(g); g.connect(filter);
                    o.start(t); o.stop(t + dur + 1.4);
                    if (last) tidy(last.o, [last.g]);
                    last = { o: o, g: g };
                });
            });
            tidy(last.o, [last.g, filter, gain, rv]);
        }
        function playBass(m, t, steps, vol) {
            var dur = (60 / bpm / 4) * steps, f = hz(m);
            var sub = ctx.createOscillator(), saw = ctx.createOscillator(), filter = ctx.createBiquadFilter();
            var subG = ctx.createGain(), sawG = ctx.createGain(), gain = ctx.createGain();
            sub.type = "sine"; sub.frequency.value = f / 2;
            saw.type = "sawtooth"; saw.frequency.value = f;
            filter.type = "lowpass"; filter.Q.value = 1.5;
            filter.frequency.setValueAtTime(380 + tension * 400, t);
            filter.frequency.exponentialRampToValueAtTime(180, t + Math.min(dur, 0.35));
            subG.gain.value = 0.16; sawG.gain.value = 0.10;
            shape(gain.gain, t, vol, 0.005, Math.max(0.01, dur - 0.09), 0.08);
            sub.connect(subG); subG.connect(gain);
            saw.connect(filter); filter.connect(sawG); sawG.connect(gain);
            gain.connect(out);
            sub.start(t); sub.stop(t + dur + 0.05); saw.start(t); saw.stop(t + dur + 0.05);
            tidy(sub, [saw, filter, subG, sawG, gain]);
        }
        function playLead(m, t, vol, long) {
            var L = LEADS[song.lead] || LEADS.pluck, f = hz(m);
            var o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain();
            var filter = ctx.createBiquadFilter(), gain = ctx.createGain();
            o1.type = L.a; o1.frequency.value = f;
            o2.type = L.b; o2.frequency.value = f * L.ratio; o2.detune.value = L.detune;
            g2.gain.value = L.mix;
            filter.type = "lowpass"; filter.Q.value = L.q;
            filter.frequency.setValueAtTime((1400 + tension * 2600) * drift, t);
            filter.frequency.exponentialRampToValueAtTime(500, t + 0.16);
            var decay = long ? L.decay + 0.28 : L.decay;
            shape(gain.gain, t, vol * L.level, 0.004, 0.01, decay);
            o1.connect(filter); o2.connect(g2); g2.connect(filter);
            filter.connect(gain); gain.connect(out);
            var s1 = send(gain, delayNode, L.echo), s2 = send(gain, reverbIn, 0.15), end = t + decay + 0.1;
            o1.start(t); o1.stop(end); o2.start(t); o2.stop(end);
            tidy(o1, [o2, g2, filter, gain, s1, s2]);
        }
        function playBell(m, t) {
            var f = hz(m), gain = ctx.createGain(), last = null;
            shape(gain.gain, t, 0.09, 0.005, 0.01, 1.8);
            gain.connect(out);
            var s1 = send(gain, delayNode, 0.5), s2 = send(gain, reverbIn, 0.5);
            [[1, 0, 1], [2, 3, 0.4], [3, 0, 0.12]].forEach(function (p) {
                var o = ctx.createOscillator(), g = ctx.createGain();
                o.type = "sine"; o.frequency.value = f * p[0]; o.detune.value = p[1];
                g.gain.value = p[2];
                o.connect(g); g.connect(gain);
                o.start(t); o.stop(t + 1.9);
                if (last) tidy(last.o, [last.g]);
                last = { o: o, g: g };
            });
            tidy(last.o, [last.g, gain, s1, s2]);
        }
        function noiseHit(t, seconds, type, freq, q, vol, tail, to, reverb) {
            var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), nodes = [f, g];
            src.buffer = noiseBuf(seconds);
            f.type = type; f.frequency.value = freq;
            if (q) f.Q.value = q;
            g.gain.setValueAtTime(vol, t);
            g.gain.setTargetAtTime(0, t, tail);
            src.connect(f); f.connect(g); g.connect(to || out);
            if (reverb) nodes.push(send(g, reverbIn, reverb));
            src.start(t); src.stop(t + seconds);
            tidy(src, nodes);
        }
        function playKick(t, vol) {
            var osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.connect(gain); gain.connect(out);
            osc.frequency.setValueAtTime(240, t);
            osc.frequency.setTargetAtTime(80, t, 0.018);
            gain.gain.setValueAtTime(vol, t);
            gain.gain.setTargetAtTime(0, t + 0.008, 0.060);
            osc.start(t); osc.stop(t + 0.35);
            tidy(osc, [gain]);
            noiseHit(t, 0.015, "bandpass", 180, 0.8, vol * 0.5, 0.008);     // the click that gives it its thud
            // everything else steps back for a moment
            sidechain.gain.cancelScheduledValues(t);
            sidechain.gain.setValueAtTime(1, t);
            sidechain.gain.setValueAtTime(0.5, t + 0.010);
            sidechain.gain.setTargetAtTime(1, t + 0.010, 0.07);
        }
        function playSnare(t, vol) {
            noiseHit(t, 0.22, "bandpass", 1000, 0.8, vol * 0.70, 0.045);
            var osc = ctx.createOscillator(), g = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(220, t);
            osc.frequency.setTargetAtTime(100, t, 0.04);
            g.gain.setValueAtTime(vol * 0.35, t);
            g.gain.setTargetAtTime(0, t, 0.035);
            osc.connect(g); g.connect(out);
            osc.start(t); osc.stop(t + 0.18);
            tidy(osc, [g]);
            noiseHit(t, 0.60, "bandpass", 3000, 0.35, vol * 0.18, 0.20);    // the room tail
        }
        function playRim(t, vol) { noiseHit(t, 0.14, "bandpass", 1800, 0.9, vol, 0.03, null, 0.35); }
        function playHat(t, vol, open) {
            var decay = open ? 0.28 : 0.05;
            noiseHit(t, decay + 0.02, "highpass", 7000, 0, vol, decay / 4);
        }
        function drums(n, t, kitName, level, vol, fill) {
            var kit = KITS[kitName] || KITS.street;
            var k = kit.kick[level].charAt(n), s = kit.snare[level].charAt(n), r = kit.rim[level].charAt(n), h = kit.hat[level].charAt(n);
            if (k === "x") playKick(t, vol * (level === 0 ? 0.8 : 1.0));
            if (s === "x") playSnare(t, vol * 0.70);
            if (r === "x") playRim(t, vol * (level === 2 ? 0.32 : 0.18));
            if (h === "x") playHat(t, vol * (n % 4 === 2 ? 0.20 : 0.14), false);
            else if (h === "-") playHat(t, vol * 0.08, false);
            else if (h === "o") playHat(t, vol * 0.14, true);
            if (fill && level > 0 && (n === 13 || n === 14)) {              // the last bar of a section
                if (level === 2) playSnare(t, vol * 0.45);
                else playRim(t, vol * 0.16);
            }
        }

        function scheduleStep(n, t) {
            var s16 = 60 / bpm / 4, secondBar = barCount % 2 === 1;
            var chord = song.chords[Math.floor(barCount / 2) % 4], level = barLevel;
            var late = t + (n % 2 === 1 ? s16 * THEME.swing : 0), i, iv;

            if (n === 0) {
                if (!secondBar) playPad(chord, t, s16 * 32);
                delayNode.delayTime.setTargetAtTime(s16 * 3, t, 0.2);       // a dotted eighth
            }
            // bass: the song's figure, or one long note while sheltering
            var fig = BASSES[level === 0 ? "long" : song.bass];
            for (i = 0; i < fig.length; i++) {
                if (fig[i][0] !== n) continue;
                iv = fig[i][2];
                if (iv === "lift") iv = (level === 2) ? 7 : (secondBar ? 12 : 0);
                playBass(chord.root + iv, t, fig[i][1], fig[i][3]);
            }
            // the hook: this step's place in the chord, where the rhythm has a hit
            if (song.hits[level][n]) {
                var at = (secondBar ? song.hookB : song.hookA)[n];
                var up = (level === 2 && barCount % 4 >= 2 && at < 4) ? 12 : 0;
                playLead(chord.tones[at] + up, late, level === 0 ? 0.05 : 0.07, level === 0);
            }
            // the bell's phrase, and four bars later its answer
            var bs = song.bellSteps.indexOf(n);
            if (bs >= 0 && section !== 0) {
                if (barCount % 8 === 1) playBell(song.bell[bs], t);
                else if (barCount % 8 === 5) playBell(song.bell[2 - bs], t);
            }
            drums(n, late, song.kit, level, THEME.drums, sectionBar === song.bars[section] - 1);
        }

        // ── the house tunes ─────────────────────────────────────────────────
        function simpleNote(to, freq, t0, dur, gain, type, slideTo) {
            var o = ctx.createOscillator(), g = ctx.createGain();
            o.type = type || "sine";
            o.frequency.setValueAtTime(freq, t0);
            if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
            g.gain.setValueAtTime(0, t0);
            g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            o.connect(g); g.connect(to);
            o.start(t0); o.stop(t0 + dur + 0.02);
            tidy(o, [g]);
        }
        function tuneTick(now) {
            var A = ARCADE, Hd = HOLD, i, bar, n, f;
            if (!tune.at || tune.at < now) tune.at = now + 0.05;
            while (tune.at < now + 0.25) {
                i = tune.i;
                if (tune.name === "arcade") {
                    bar = Math.floor(i / 16) % 4; n = i % 16;
                    f = A.lead[bar][Math.floor(i / 64) % 2 ? (n + 8) % 16 : n];     // the second time round, each bar from its middle
                    if (f) simpleNote(tune.bus, hz(f), tune.at, A.step * 0.85, A.gain.lead * A.level, "square");
                    if (n % 2 === 0) simpleNote(tune.bus, hz(A.bass[bar]) * (n % 4 === 2 ? 2 : 1), tune.at, A.step * 1.7, A.gain.bass * A.level, "triangle");
                    if (n % 8 === 0) simpleNote(tune.bus, 150, tune.at, 0.09, A.gain.kick * A.level, "sine", 45);
                    tune.at += A.step;
                } else {
                    bar = Hd.bars[Math.floor(i / 8) % 4]; n = i % 8;
                    simpleNote(tune.bus, bar[n], tune.at, Hd.step * 0.9, 0.085 * Hd.level, "sine");
                    if (n === 0) simpleNote(tune.bus, bar[0] / 2, tune.at, Hd.step * 7.5, 0.070 * Hd.level, "triangle");
                    tune.at += Hd.step;
                }
                tune.i++;
            }
        }
        function stopTune() {
            if (!tune) return;
            var was = tune, t = ctx.currentTime;
            tune = null;
            was.gain.gain.setTargetAtTime(0, t, 0.08);
            street.gain.setTargetAtTime(1, t + 0.2, 0.25);                  // the street comes back up
            setTimeout(function () { try { was.gain.disconnect(); was.bus.disconnect(); } catch (e) { /* already gone */ } }, 1500);
            nextTime = 0;
            if (was.done) was.done();
        }
        // Plays a house tune for `seconds` with the street music faded out under it. Returns false,
        // and plays nothing, while the sound is off.
        function playTune(name, seconds, done) {
            if (!on || !ctx || ctx.state !== "running" || (name !== "arcade" && name !== "hold")) return false;
            if (tune) stopTune();
            var t = ctx.currentTime, gain = ctx.createGain(), bus = ctx.createBiquadFilter(), hp;
            gain.gain.value = 0;
            gain.gain.setTargetAtTime(1, t + 0.15, 0.12);
            if (name === "arcade") {                    // through the arcade's door
                bus.type = "lowpass"; bus.frequency.value = ARCADE.lowpass;
                bus.connect(gain);
            } else {                                    // down a phone line
                bus.type = "lowpass"; bus.frequency.value = 3000;
                hp = ctx.createBiquadFilter();
                hp.type = "highpass"; hp.frequency.value = 320;
                bus.connect(hp); hp.connect(gain);
            }
            gain.connect(house);
            street.gain.setTargetAtTime(0, t, 0.12);
            tune = { name: name, at: 0, i: 0, until: t + seconds, done: done, bus: bus, gain: gain };
            return true;
        }

        function tick() {
            if (!on || !ctx || ctx.state !== "running") return;
            var drained = 0, now = ctx.currentTime, sd;
            if (tune) {                                 // the street waits while a house tune plays
                if (now >= tune.until) stopTune(); else tuneTick(now);
                return;
            }
            if (nextTime < now) nextTime = now + 0.05;
            while (nextTime < now + AHEAD && drained < MAX_DRAIN) {
                drained++;
                if (step === 0) startBar();
                scheduleStep(step, nextTime);
                step = (step + 1) % 16;
                if (step === 0) { barCount++; sectionBar++; }
                sd = 60 / bpm / 4;
                nextTime += sd;
                // the lead's filter wanders slowly between the theme's limits
                driftTimer -= sd;
                if (driftTimer <= 0) {
                    driftTarget = THEME.dMin + Math.random() * (THEME.dMax - THEME.dMin);
                    driftTimer = 30 + Math.random() * 20;
                }
                drift += (driftTarget > drift ? 1 : -1) * Math.min(Math.abs(driftTarget - drift), sd / 20);
            }
        }

        // ── controls ────────────────────────────────────────────────────────
        function start() {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!ctx) {
                if (!AC) return false;
                ctx = new AC();
                wire();
                newSong(null);
            }
            ctx.resume();
            on = true;
            nextTime = 0;
            clearInterval(timer);
            timer = setInterval(tick, TICK_MS);
            return true;
        }
        function stop() {
            if (tune) stopTune();
            on = false;
            clearInterval(timer);
            if (ctx) ctx.suspend();
        }
        function blip(freq, slideTo, dur, wave) {
            if (!on || !ctx || ctx.state !== "running") return;
            simpleNote(master, freq, ctx.currentTime + 0.01, dur || 0.1, 0.1, wave || "square", slideTo);
        }

        return {
            start: start,
            stop: stop,
            toggle: function () { if (on) stop(); else start(); return on; },
            pause: function () { if (ctx && on) ctx.suspend(); },
            resume: function () { if (ctx && on) ctx.resume(); },
            setVolume: function (v) { volume = v; if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05); },
            setTension: function (v) {
                v = clamp(v, 0, 1);
                if (Math.abs(v - tension) < 0.01) return;
                tension = v;
                if (ctx && on) applyTension(0.3);
            },
            playTune: playTune,
            stopTune: function () { if (ctx) stopTune(); },
            tunePlaying: function () { return tune ? tune.name : null; },
            blip: blip,
            // a burst of filtered noise through the same output: hiss(seconds, filter type, frequency, level)
            hiss: function (seconds, type, freq, vol) {
                if (!on || !ctx || ctx.state !== "running") return;
                seconds = seconds || 0.3;
                noiseHit(ctx.currentTime + 0.01, seconds, type || "highpass", freq || 4000, 0.7, vol || 0.1, seconds / 4, master);
            },
            isPlaying: function () { return on; }
        };
    }

    window.StreetMusic = { create: create };
})();
