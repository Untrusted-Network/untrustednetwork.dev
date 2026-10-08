// streetmusic.js - the page's own music: a slow, wet-street piece written for this site.
//
// It is synthesised live (no audio files) and composed as it plays, so it never loops exactly, but it
// is an original piece and not the game's soundtrack. What it is made of:
//
//   - 96 BPM with a light swing, in A minor, over four chords of two bars each: Am7, F, Dm7, Em7
//   - a pad that holds each chord: detuned saws and a triangle behind a slow filter, into a reverb
//   - a bass on a three-three-two rhythm: a sine sub with a filtered saw on top
//   - an arpeggio: a stepwise walk over the chord's own notes on a Euclidean rhythm, always back on
//     the root at the top of the bar. The pattern repeats bar to bar, follows the chords, and has
//     one note changed every eight bars
//   - a bell that states a three-note phrase and later answers it backwards
//   - a soft kick that ducks the rest, a rim on the backbeat, steady hats, and rain under all of it
//   - three sections in turn, the beat there from the first bar: walk (kick, bass, hats, arpeggio),
//     watched (the full kit, a busier arpeggio, the bell), shelter (a lighter kit, long notes)
//   - tension (0 to 1) opens the arpeggio's and the bass's filters
//
//   var music = StreetMusic.create({ volume: 0.6 });
//   music.start();          // from a click or key press: browsers block audio until then
//   music.stop();
//   music.toggle();         // returns true when it is now playing
//   music.setTension(0.6);
//   music.blip(660, 990, 0.09);
//   music.hiss(0.5, "highpass", 3600, 0.1);
(function () {
    "use strict";

    var BPM = 96, SWING = 0.12, AHEAD = 0.2, TICK_MS = 25, MAX_DRAIN = 8;
    // Each chord: the bass note, the pad's voicing, and the seven notes the arpeggio may walk (MIDI).
    var PROG = [
        { root: 45, pad: [57, 60, 64, 67], tones: [57, 60, 64, 67, 69, 72, 76] },      // Am7
        { root: 41, pad: [53, 57, 60, 65], tones: [53, 57, 60, 65, 69, 72, 77] },      // F
        { root: 38, pad: [50, 57, 60, 65], tones: [50, 57, 62, 65, 69, 72, 74] },      // Dm7
        { root: 40, pad: [52, 59, 62, 67], tones: [52, 59, 64, 67, 71, 74, 76] }       // Em7
    ];
    var BELL_NOTES = [69, 72, 74, 76, 79, 81];              // A minor pentatonic
    var BELL_STEPS = [4, 10, 14];
    var SECTION_BARS = [16, 16, 8];                         // walk, watched, shelter
    var WALK = 0, WATCHED = 1, SHELTER = 2;

    function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

    // k hits spread as evenly as they will go over sixteen steps
    function euclid(k) {
        var out = [];
        for (var i = 0; i < 16; i++) out.push((i * k) % 16 < k);
        return out;
    }

    function create(opts) {
        opts = opts || {};
        var volume = typeof opts.volume === "number" ? opts.volume : 0.6;
        var ctx = null, master = null, dry = null, duck = null, delayIn = null, reverbIn = null;
        var on = false, timer = 0, tension = 0.2;
        var step = 0, nextTime = 0, barCount = 0, section = WALK, secBar = 0;
        var walk = [], rot = 0, bell = [];

        function sd() { return 60 / BPM / 4; }

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

        // a rise to the peak, a hold, then a fall away to nothing
        function shape(param, t, peak, attack, hold, release) {
            param.setValueAtTime(0.0001, t);
            param.linearRampToValueAtTime(peak, t + attack);
            param.setValueAtTime(peak, t + attack + hold);
            param.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
        }

        // voices -> dry (drums) or duck (everything the kick pushes down) -> compressor -> master
        function wire() {
            master = ctx.createGain();
            master.gain.value = volume;
            master.connect(ctx.destination);
            var comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3;
            comp.attack.value = 0.01; comp.release.value = 0.25;
            comp.connect(master);
            dry = ctx.createGain();
            dry.connect(comp);
            duck = ctx.createGain();
            duck.connect(dry);

            // a dotted-eighth echo whose repeats get darker
            var delay = ctx.createDelay(2), fb = ctx.createGain(), tone = ctx.createBiquadFilter(), out = ctx.createGain();
            delay.delayTime.value = sd() * 3;
            fb.gain.value = 0.36;
            tone.type = "lowpass"; tone.frequency.value = 2400;
            out.gain.value = 0.5;
            delay.connect(tone); tone.connect(fb); fb.connect(delay);
            tone.connect(out); out.connect(duck);
            delayIn = delay;

            // a reverb from a burst of decaying noise
            var len = Math.ceil(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate), ch, i, d;
            for (ch = 0; ch < 2; ch++) {
                d = ir.getChannelData(ch);
                for (i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
            }
            var conv = ctx.createConvolver(), wet = ctx.createGain();
            conv.buffer = ir;
            wet.gain.value = 0.5;
            conv.connect(wet); wet.connect(dry);
            reverbIn = conv;

            // rain, and the low hum of the street
            [["bandpass", 2600, 0.4, 0.012], ["lowpass", 200, 0, 0.02]].forEach(function (b) {
                var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
                src.buffer = noiseBuf(7); src.loop = true;
                f.type = b[0]; f.frequency.value = b[1];
                if (b[2]) f.Q.value = b[2];
                g.gain.value = b[3];
                src.connect(f); f.connect(g); g.connect(dry);
                src.start(0);
            });
        }

        function send(node, to, amount) {
            var s = ctx.createGain();
            s.gain.value = amount;
            node.connect(s); s.connect(to);
            return s;
        }

        // ── voices ──────────────────────────────────────────────────────────
        function playPad(chord, t, dur) {
            var filter = ctx.createBiquadFilter(), gain = ctx.createGain();
            filter.type = "lowpass"; filter.Q.value = 0.7;
            filter.frequency.setValueAtTime(480, t);
            filter.frequency.linearRampToValueAtTime(820 + tension * 500, t + dur * 0.55);
            filter.frequency.linearRampToValueAtTime(560, t + dur + 0.8);
            shape(gain.gain, t, 1, 0.9, dur - 0.9, 1.3);
            filter.connect(gain); gain.connect(duck);
            var rv = send(gain, reverbIn, 0.5), last = null, extra = [filter, gain, rv];
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
            tidy(last.o, [last.g].concat(extra));
        }

        function playBass(m, t, steps, vol) {
            var dur = sd() * steps, f = hz(m);
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
            gain.connect(duck);
            sub.start(t); sub.stop(t + dur + 0.05); saw.start(t); saw.stop(t + dur + 0.05);
            tidy(sub, [saw, filter, subG, sawG, gain]);
        }

        function playArp(m, t, vol, long) {
            var f = hz(m), o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain();
            var filter = ctx.createBiquadFilter(), gain = ctx.createGain();
            o1.type = "square"; o1.frequency.value = f;
            o2.type = "triangle"; o2.frequency.value = f * 2; o2.detune.value = 5;
            g2.gain.value = 0.4;
            filter.type = "lowpass"; filter.Q.value = 4;
            filter.frequency.setValueAtTime(1400 + tension * 2600, t);
            filter.frequency.exponentialRampToValueAtTime(500, t + 0.16);
            shape(gain.gain, t, vol, 0.004, 0.01, long ? 0.5 : 0.22);
            o1.connect(filter); o2.connect(g2); g2.connect(filter);
            filter.connect(gain); gain.connect(duck);
            var s1 = send(gain, delayIn, 0.45), s2 = send(gain, reverbIn, 0.15), end = t + (long ? 0.6 : 0.3);
            o1.start(t); o1.stop(end); o2.start(t); o2.stop(end);
            tidy(o1, [o2, g2, filter, gain, s1, s2]);
        }

        function playBell(m, t) {
            var f = hz(m), gain = ctx.createGain(), last = null;
            shape(gain.gain, t, 0.09, 0.005, 0.01, 1.8);
            gain.connect(duck);
            var s1 = send(gain, delayIn, 0.5), s2 = send(gain, reverbIn, 0.5);
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

        function playKick(t, vol) {
            var o = ctx.createOscillator(), g = ctx.createGain();
            o.type = "sine";
            o.frequency.setValueAtTime(150, t);
            o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
            o.connect(g); g.connect(dry);
            o.start(t); o.stop(t + 0.26);
            tidy(o, [g]);
            // everything else steps back for a moment
            duck.gain.cancelScheduledValues(t);
            duck.gain.setValueAtTime(1, t);
            duck.gain.linearRampToValueAtTime(0.55, t + 0.012);
            duck.gain.setTargetAtTime(1, t + 0.03, 0.09);
        }

        function noiseHit(t, type, freq, q, vol, decay, reverb) {
            var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), nodes = [f, g];
            src.buffer = noiseBuf(decay + 0.05);
            f.type = type; f.frequency.value = freq;
            if (q) f.Q.value = q;
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
            src.connect(f); f.connect(g); g.connect(dry);
            if (reverb) nodes.push(send(g, reverbIn, reverb));
            src.start(t); src.stop(t + decay + 0.05);
            tidy(src, nodes);
        }

        function playRim(t, vol) { noiseHit(t, "bandpass", 1800, 0.9, vol, 0.09, 0.35); }
        function playHat(t, vol, open) { noiseHit(t, "highpass", 8000, 0, vol, open ? 0.18 : 0.03, 0); }

        // ── composition ─────────────────────────────────────────────────────
        function newPattern() {
            var i = 0, s;
            walk = [0];
            for (s = 1; s < 16; s++) {
                i += pick([-1, -1, 0, 1, 1, 1]);
                if (i < 0) i = 1;
                if (i > 6) i = 5;
                walk.push(i);
            }
            rot = 0;         // the rhythm always has a hit on the first step, where the walk is on the root
            var a = Math.floor(Math.random() * 3), b = a + 1 + Math.floor(Math.random() * 2), c = Math.max(0, a - Math.floor(Math.random() * 2));
            bell = [BELL_NOTES[a], BELL_NOTES[b], BELL_NOTES[c]];
        }

        function mutate() {
            var s = 1 + Math.floor(Math.random() * 15);
            walk[s] = Math.max(0, Math.min(6, walk[s] + pick([-1, 1])));
        }

        function scheduleStep(t) {
            var n = step % 16, sec = section, chord = PROG[Math.floor(barCount / 2) % 4];
            var s16 = sd(), late = t + (n % 2 === 1 ? s16 * SWING : 0), secondBar = barCount % 2 === 1;

            if (n === 0 && !secondBar) playPad(chord, t, s16 * 32);

            // bass: three-three-two, or one long note while sheltering
            if (sec === SHELTER) {
                if (n === 0) playBass(chord.root, t, 12, 0.75);
            } else if (n === 0) playBass(chord.root, t, 5, 1);
            else if (n === 6) playBass(chord.root, t, 3, 0.8);
            else if (n === 12) playBass(chord.root + (sec === WATCHED ? 7 : secondBar ? 12 : 0), t, 3, 0.8);

            // arpeggio: the walk's note for this step, where the rhythm has a hit
            var hits = sec === WALK ? 6 : sec === WATCHED ? 8 : 4;
            if (euclid(hits)[(n + rot) % 16]) {
                var up = sec === WATCHED && barCount % 4 >= 2 && walk[n] < 4 ? 12 : 0;
                playArp(chord.tones[walk[n]] + up, late, sec === SHELTER ? 0.05 : 0.07, sec === SHELTER);
            }

            // the bell's phrase, and four bars later its answer
            if (sec !== WALK && BELL_STEPS.indexOf(n) >= 0) {
                var at = BELL_STEPS.indexOf(n);
                if (barCount % 8 === 1) playBell(bell[at], t);
                else if (barCount % 8 === 5) playBell(bell[2 - at], t);
            }

            // drums: the same hats on every eighth, in every section
            if (n % 2 === 0) playHat(t, n % 4 === 2 ? 0.06 : 0.04, false);
            if (sec === SHELTER) {
                if (n === 0) playKick(t, 0.4);
            } else {
                if (n === 0 || n === 10) playKick(t, 0.5);
                if (sec === WATCHED && (n === 4 || n === 12)) playRim(t, 0.16);
                if (sec === WALK && n === 12) playRim(t, 0.08);
                if (sec === WATCHED && n === 14) playHat(t, 0.04, true);
            }
        }

        function tick() {
            if (!on || !ctx || ctx.state !== "running") return;
            var drained = 0, now = ctx.currentTime;
            if (nextTime < now) nextTime = now + 0.05;
            while (nextTime < now + AHEAD && drained < MAX_DRAIN) {
                drained++;
                if (step % 16 === 0) {
                    if (secBar >= SECTION_BARS[section]) {
                        section = (section + 1) % SECTION_BARS.length;
                        secBar = 0;
                        if (section === WALK) newPattern();
                    } else if (barCount % 8 === 0 && barCount > 0) mutate();
                }
                scheduleStep(nextTime);
                nextTime += sd();
                step++;
                if (step % 16 === 0) { barCount++; secBar++; }
            }
        }

        // ── controls ────────────────────────────────────────────────────────
        function start() {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!ctx) {
                if (!AC) return false;
                ctx = new AC();
                wire();
                newPattern();
            }
            ctx.resume();
            on = true;
            nextTime = 0;
            clearInterval(timer);
            timer = setInterval(tick, TICK_MS);
            return true;
        }

        function stop() {
            on = false;
            clearInterval(timer);
            if (ctx) ctx.suspend();
        }

        function blip(freq, slideTo, dur, wave) {
            if (!on || !ctx || ctx.state !== "running") return;
            var t = ctx.currentTime + 0.01, o = ctx.createOscillator(), g = ctx.createGain();
            dur = dur || 0.1;
            o.type = wave || "square";
            o.frequency.setValueAtTime(freq, t);
            if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
            shape(g.gain, t, 0.1, 0.008, 0.001, dur);
            o.connect(g); g.connect(dry);
            o.start(t); o.stop(t + dur + 0.05);
            tidy(o, [g]);
        }

        return {
            start: start,
            stop: stop,
            toggle: function () { if (on) stop(); else start(); return on; },
            pause: function () { if (ctx && on) ctx.suspend(); },
            resume: function () { if (ctx && on) ctx.resume(); },
            setVolume: function (v) { volume = v; if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05); },
            setTension: function (v) { tension = Math.max(0, Math.min(1, v)); },
            blip: blip,
            // a burst of filtered noise through the same output: hiss(seconds, filter type, frequency, level)
            hiss: function (seconds, type, freq, vol) {
                if (!on || !ctx || ctx.state !== "running") return;
                noiseHit(ctx.currentTime + 0.01, type || "highpass", freq || 4000, 0.7, vol || 0.1, seconds || 0.3, 0);
            },
            isPlaying: function () { return on; }
        };
    }

    window.StreetMusic = { create: create };
})();
