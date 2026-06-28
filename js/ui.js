// Global helper for stepper buttons
window.step = (id, amount) => {
    const el = document.getElementById(id);
    const currentVal = parseFloat(el.value) || 0;
    const newVal = currentVal + amount;
    const clampZero = id === 'reps' || id === 'duration' || id === 'set-reps' || id === 'set-duration';
    el.value = clampZero ? Math.max(0, newVal) : newVal;
    // Fire `input` so anything listening (e.g. the live improvement bar) updates,
    // just as it would when the value is typed.
    el.dispatchEvent(new Event('input', { bubbles: true }));
};

// Chart.js (~200KB) is only needed for the Analysis trend chart. Load it on
// demand the first time a chart renders so it costs nothing at launch. The file
// is in the service-worker precache, so it's available offline after install.
let _chartLoader = null;
function ensureChart() {
    if (window.Chart) return Promise.resolve();
    if (_chartLoader) return _chartLoader;
    _chartLoader = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/lib/chart.umd.js';
        s.onload = () => resolve();
        s.onerror = () => { _chartLoader = null; reject(new Error('Chart.js failed to load')); };
        document.head.appendChild(s);
    });
    return _chartLoader;
}

// ── DOMAIN MATH ───────────────────────────────────────────────────────────────
// Hoisted out of the UI closure: no DOM dependencies, independently testable.

const BAND_LOAD = { light: 15, medium: 30, heavy: 50 };

function e1rm(load, reps) {
    return load * (1 + reps / 30); // Epley formula
}

// Effective load in lbs, accounting for bodyweight movements.
function loadOf(set, def, bw) {
    if (def?.tracking === 'bodyweight')
        return Math.max(0, bw * (def.bwFraction ?? 1) + (set.weight || 0));
    return set.weight || 0;
}

// Single comparable "performance" number for one set, per tracking type:
// e1RM (weighted / loaded-bodyweight), reps (banded / pure bodyweight), or
// seconds (timed). Used for trend arrows and the log-form improvement bar so
// every comparison is single-sourced.
function setMetric(set, def, bw) {
    const t = def?.tracking || 'weighted';
    if (t === 'timed')  return set.duration || 0;
    if (t === 'banded') return set.reps || 0;
    return e1rm(loadOf(set, def, bw), set.reps || 0);
}

// Unified per-set volume comparable across all tracking types.
function muscleVolume(set, def, bw) {
    const t = def?.tracking || 'weighted';
    if (t === 'banded')
        return { vol: (BAND_LOAD[set.bandLevel] || BAND_LOAD.medium) * (set.reps || 0), lbs: 0 };
    if (t === 'timed') {
        const load = Math.max(bw * (def?.bwFraction ?? 0), 1);
        return { vol: load * ((set.duration || 0) / 3), lbs: 0 };
    }
    const lbs = loadOf(set, def, bw) * (set.reps || 0);
    return { vol: lbs, lbs };
}

// Bodyweight helpers — read/write the dated log in localStorage.
function getBodyweight() { return parseFloat(localStorage.getItem('bodyweight')) || 0; }

function getBodyweightLog() {
    try { return (JSON.parse(localStorage.getItem('bodyweight_log')) || []).sort((a, b) => a.t - b.t); }
    catch { return []; }
}

function recordBodyweight(v) {
    const log = getBodyweightLog();
    log.push({ t: Date.now(), v });
    localStorage.setItem('bodyweight_log', JSON.stringify(log));
    localStorage.setItem('bodyweight', String(v));
}

// Bodyweight in effect at a given moment (most recent entry on/before the timestamp).
function bodyweightAt(timestamp) {
    const log = getBodyweightLog();
    if (!log.length) return getBodyweight();
    let bw = log[0].v;
    for (const e of log) { if (e.t <= timestamp) bw = e.v; else break; }
    return bw;
}

// ── WEIGHT UNIT (display only) ──────────────────────────────────────────────
// Data is ALWAYS stored canonical in lbs — the unit preference only changes how
// weights are SHOWN and how typed values are interpreted, so there is no data
// migration and backups stay unit-agnostic. All domain math (e1rm, increments,
// BAND_LOAD, volume) keeps running in lbs; only labels and edge values convert.
const LB_PER_KG = 2.2046226218;
function getUnit()    { return localStorage.getItem('weight_unit') === 'kg' ? 'kg' : 'lbs'; }
function unitLabel()  { return getUnit(); }
function shortUnit()  { return getUnit() === 'kg' ? 'kg' : 'lb'; }
function toLbs(display) { return getUnit() === 'kg' ? (display || 0) * LB_PER_KG : (display || 0); }
function fromLbs(lbs)   { return getUnit() === 'kg' ? (lbs || 0) / LB_PER_KG : (lbs || 0); }
// Tidy display number: ≤1 decimal, no trailing ".0".
function fmtNum(n) {
    const r = Math.round((n || 0) * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
// Numeric value (2 dp) for an INPUT field, in the user's unit.
function dispWeight(lbs) { return Math.round(fromLbs(lbs) * 100) / 100; }
// "<n> <unit>" for display text, e.g. "135 lbs" / "61.2 kg".
function fmtWeight(lbs) { return `${fmtNum(fromLbs(lbs))} ${unitLabel()}`; }

// Tracking type for a logged set.
function trackingOf(set) {
    return getDef(set.exercise)?.tracking || 'weighted';
}

function fmtDuration(sec) {
    const s = sec || 0;
    return s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`;
}

function formatSet(set) {
    switch (trackingOf(set)) {
        case 'timed':
            return `${fmtDuration(set.duration)}${set.weight ? ` + ${fmtWeight(set.weight)}` : ''}`;
        case 'banded':
            return `${set.reps} reps · ${set.bandLevel || 'medium'} band`;
        case 'bodyweight':
            return `${set.reps} reps${set.weight ? ` + ${fmtWeight(set.weight)}` : ''}`;
        default:
            return `${fmtWeight(set.weight)} × ${set.reps} reps`;
    }
}

function formatSetShort(set) {
    switch (trackingOf(set)) {
        case 'timed':
            return fmtDuration(set.duration);
        case 'banded':
            return `${set.reps} (${(set.bandLevel || 'med').slice(0,3)})`;
        case 'bodyweight':
            return `${set.reps}${set.weight ? `+${fmtNum(fromLbs(set.weight))}` : ''}`;
        default:
            return `${fmtNum(fromLbs(set.weight))}${shortUnit()} × ${set.reps}`;
    }
}

// Darker category colors for heatmap cells (matching .heat-push/pull/legs/core CSS).
const CAT_COLOR = { push: '#c0392b', pull: '#2471a3', legs: '#1e8449', core: '#8e44ad' };
const CAT_ORDER = ['push', 'pull', 'legs', 'core'];

// ── GTG (Grease-the-Groove) inference ──────────────────────────────────────
// GTG is NOT a manual flag — it's derived from how a day was trained. A "full"
// exercise means it was worked with enough sets to count as real training; a day
// of only sporadic singles/doubles (e.g. 2 exercises, 2 sets) is greasing the
// groove, not a session.
const GTG_FULL_SETS = 3; // an exercise needs ≥ this many sets in a day to be "full"

// A day is GTG (sparse) when NO single exercise reached GTG_FULL_SETS that day.
function isGtgDay(daySets) {
    const perEx = {};
    daySets.forEach(s => { perEx[s.exercise] = (perEx[s.exercise] || 0) + 1; });
    const maxSets = Math.max(0, ...Object.values(perEx));
    return maxSets > 0 && maxSets < GTG_FULL_SETS;
}

// Per-category set counts for a day's sets.
function categorySetCounts(daySets) {
    const counts = { push: 0, pull: 0, legs: 0, core: 0 };
    daySets.forEach(s => { const c = getCategory(s.exercise); if (c) counts[c]++; });
    return counts;
}

// Category profile for a day: dominant category, whether it's genuinely mixed
// (no category holds a clear majority), and the raw per-category counts.
const DOMINANT_SHARE = 0.6; // ≥60% of sets → render solid; otherwise proportional mix
function dayCategoryProfile(daySets) {
    const counts  = categorySetCounts(daySets);
    const total   = CAT_ORDER.reduce((a, c) => a + counts[c], 0);
    if (!total) return { dominant: null, mixed: false, counts, total };
    const present = CAT_ORDER.filter(c => counts[c] > 0).sort((a, b) => counts[b] - counts[a]);
    const dominant = present[0];
    const topShare = counts[dominant] / total;
    const mixed = present.length > 1 && topShare < DOMINANT_SHARE;
    return { dominant, mixed, counts, total, topShare };
}

// Diagonal gradient whose band widths are proportional to each category's share
// of the day's sets — so a 9-push/3-pull day reads as mostly red, not 50/50.
function proportionalGradient(counts) {
    const present = CAT_ORDER.filter(c => counts[c] > 0);
    if (present.length <= 1) return null;
    const total = present.reduce((a, c) => a + counts[c], 0);
    let acc = 0;
    const stops = [];
    present.forEach(c => {
        const start = (acc / total) * 100;
        acc += counts[c];
        const end = (acc / total) * 100;
        stops.push(`${CAT_COLOR[c]} ${start.toFixed(1)}%`, `${CAT_COLOR[c]} ${end.toFixed(1)}%`);
    });
    return `linear-gradient(135deg, ${stops.join(', ')})`;
}

// Band- and timed-aware volume for history stats (fixes banded/timed counting as 0 lbs).
function setVolume(s) {
    const def = getDef(s.exercise);
    const t   = def?.tracking || 'weighted';
    if (t === 'banded') return (BAND_LOAD[s.bandLevel] || BAND_LOAD.medium) * (s.reps || 0);
    if (t === 'timed')  return Math.max(bodyweightAt(s.timestamp) * (def?.bwFraction ?? 0), 1) * ((s.duration || 0) / 3);
    return loadOf(s, def, bodyweightAt(s.timestamp)) * (s.reps || 0);
}

// Average ms of estimated rest between consecutive sets of `exerciseName`.
// The raw gap (timestamp[i+1] - timestamp[i]) includes both rest AND the time
// to complete set[i+1], because sets are logged on completion. We subtract an
// execution estimate from each gap: duration (seconds) for timed exercises, or
// reps × 3s as a rough tempo estimate for everything else.
// Gaps that span another exercise are excluded (those include work on a different
// movement, not just rest).
function avgIntraRestMs(allDaySets, exerciseName) {
    const sorted = [...allDaySets].sort((a, b) => a.timestamp - b.timestamp);
    const gaps = [];
    let lastTs = null;
    let interleaved = false;
    for (const s of sorted) {
        if (s.exercise === exerciseName) {
            if (lastTs !== null && !interleaved) {
                const execMs = (s.duration != null ? s.duration : (s.reps || 0) * 3) * 1000;
                const restMs = Math.max(0, s.timestamp - lastTs - execMs);
                gaps.push(restMs);
            }
            lastTs = s.timestamp;
            interleaved = false;
        } else if (lastTs !== null) {
            interleaved = true;
        }
    }
    if (!gaps.length) return null;
    return gaps.reduce((a, b) => a + b, 0) / gaps.length;
}

// Progressive-overload suggestion via double progression. Pure/testable: takes the
// raw sets for one exercise, the tracking type, and a weight increment, and returns
// { lastLabel, nextLabel, basis } or null when there isn't enough history.
//
// Double progression: keep adding reps at a fixed weight until you hit the top of
// your demonstrated rep range, then add weight and drop back to the bottom. The rep
// range is inferred from the user's own recent sets, so it adapts to whether they
// train heavy/low-rep or light/high-rep. This is a heuristic nudge, not a guarantee.
function predictNextTarget(sets, tracking, increment) {
    if (!sets || sets.length < 2) return null;

    // Group into sessions by calendar day, newest last.
    const byDay = {};
    sets.forEach(s => { (byDay[new Date(s.timestamp).toLocaleDateString()] ||= []).push(s); });
    const days = Object.values(byDay).sort((a, b) => a[0].timestamp - b[0].timestamp);
    if (days.length < 2) return null;
    const last = days[days.length - 1];

    if (tracking === 'timed') {
        const best = Math.max(...last.map(s => s.duration || 0));
        if (best <= 0) return null;
        return {
            lastLabel: `${fmtDuration(best)} hold`,
            nextLabel: `${fmtDuration(best + 5)} hold`,
            basis: '+5s',
            metric: 'duration', target: best + 5
        };
    }

    if (tracking === 'banded') {
        const best = Math.max(...last.map(s => s.reps || 0));
        if (best <= 0) return null;
        return {
            lastLabel: `${best} reps`,
            nextLabel: `${best + 1} reps`,
            basis: '+1 rep',
            metric: 'reps', target: best + 1
        };
    }

    // weighted / bodyweight. Top working weight of the most recent session and the
    // best (most reps) set at that weight.
    const topW    = Math.max(...last.map(s => s.weight || 0));
    const atTop   = last.filter(s => (s.weight || 0) === topW && (s.reps || 0) > 0);
    if (!atTop.length) return null;
    const lastReps = Math.max(...atTop.map(s => s.reps || 0));

    // Pure-bodyweight (no added weight ever): progress by reps.
    const anyAdded = sets.some(s => (s.weight || 0) > 0);
    if (tracking === 'bodyweight' && !anyAdded) {
        if (lastReps >= 20)
            return { lastLabel: `${lastReps} reps`, nextLabel: `+${fmtWeight(increment)}`,
                     basis: 'add load',
                     metric: 'reps', target: lastReps + 1 };
        return { lastLabel: `${lastReps} reps`, nextLabel: `${lastReps + 1} reps`,
                 basis: '+1 rep',
                 metric: 'reps', target: lastReps + 1 };
    }

    // Demonstrated rep range at this weight (recent history), used as the ceiling/floor.
    const repsAtW = sets.filter(s => (s.weight || 0) === topW && (s.reps || 0) > 0).map(s => s.reps);
    const repHi = repsAtW.length ? Math.max(...repsAtW) : lastReps;
    const repLo = repsAtW.length ? Math.min(...repsAtW) : Math.max(1, lastReps - 4);
    const wLabel = (w) => tracking === 'bodyweight' ? `BW+${fmtWeight(w)}` : `${fmtWeight(w)}`;

    if (lastReps >= repHi) {
        const nextW = topW + increment;
        return {
            lastLabel: `${wLabel(topW)} × ${lastReps}`,
            nextLabel: `${wLabel(nextW)} × ${repLo}`,
            basis: `+${fmtWeight(increment)} · reset reps`,
            metric: 'e1rm', target: e1rm(nextW, repLo)
        };
    }
    return {
        lastLabel: `${wLabel(topW)} × ${lastReps}`,
        nextLabel: `${wLabel(topW)} × ${lastReps + 1}`,
        basis: `+1 rep · cap ${repHi}`,
        metric: 'e1rm', target: e1rm(topW, lastReps + 1)
    };
}

// Smallest sensible weight jump for an exercise: the smallest positive gap between
// the distinct weights the user has actually used, clamped to a realistic range.
function inferIncrement(sets) {
    const weights = [...new Set(sets.map(s => s.weight || 0).filter(w => w > 0))].sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 1; i < weights.length; i++) gap = Math.min(gap, weights[i] - weights[i - 1]);
    if (!isFinite(gap) || gap <= 0) gap = 5;
    return Math.min(25, Math.max(2.5, gap));
}

// ── PREDICTION BACKTEST ───────────────────────────────────────────────────────
// Measures how accurate predictNextTarget actually is on the user's own log. For
// each past session, it runs the SAME prediction over only the sets up to the prior
// session, then checks whether the real session reached at least that projected
// target (compared in e1RM / reps / seconds — the metric the prediction reports).
// Reuses predictNextTarget, so the model stays single-sourced; read-only, no tuning.
// Returns { tested, hits, rate } or null when there isn't enough history to score.
function backtestPrediction(sets, tracking) {
    if (!sets || sets.length < 3) return null;

    // Sessions oldest → newest.
    const byDay = {};
    sets.forEach(s => { (byDay[new Date(s.timestamp).toLocaleDateString()] ||= []).push(s); });
    const days = Object.keys(byDay)
        .sort((a, b) => byDay[a][0].timestamp - byDay[b][0].timestamp)
        .map(k => byDay[k]);

    const achieved = (session, metric) => {
        if (metric === 'duration') return Math.max(0, ...session.map(s => s.duration || 0));
        if (metric === 'reps')     return Math.max(0, ...session.map(s => s.reps || 0));
        return Math.max(0, ...session.map(s => e1rm(s.weight || 0, s.reps || 0))); // 'e1rm'
    };

    let tested = 0, hits = 0;
    for (let i = 2; i < days.length; i++) {
        const prior = days.slice(0, i).flat();
        const pred  = predictNextTarget(prior, tracking, inferIncrement(prior));
        if (!pred || !pred.metric) continue;
        tested++;
        if (achieved(days[i], pred.metric) >= pred.target * 0.99) hits++;
    }

    if (tested < 5) return null;
    return { tested, hits, rate: Math.round((hits / tested) * 100) };
}

// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

    // --- ELEMENTS ---
    const navBtns        = document.querySelectorAll('.nav-btn');
    const views          = document.querySelectorAll('.view');
    const logForm        = document.getElementById('log-form');
    const exerciseInput  = document.getElementById('exercise');
    const exerciseAnchor = document.getElementById('exercise-anchor');
    const dropdown       = document.getElementById('autocomplete-dropdown');
    const weightInput    = document.getElementById('weight');
    const repsInput      = document.getElementById('reps');
    const durationInput  = document.getElementById('duration');

    const groupWeight    = document.getElementById('group-weight');
    const groupReps      = document.getElementById('group-reps');
    const groupDuration  = document.getElementById('group-duration');
    const groupBand      = document.getElementById('group-band');
    const weightLabel    = document.getElementById('weight-label');
    const bandSegmented  = document.getElementById('band-segmented');

    // Improvement bar (replaces the old notes field on the Log form)
    const improveBar     = document.getElementById('improve-bar');
    const improvePct     = document.getElementById('improve-pct');
    const improveSetEl   = document.getElementById('improve-set');
    const improveFill    = document.getElementById('improve-fill');
    const improveSub     = document.getElementById('improve-sub');

    // --- STATE ---
    let allExercises    = []; // [{ name, lastWeight, lastReps, def }]
    let currentTracking = 'weighted';
    // History is rebuilt only when a set actually changes (see refreshSetViews).
    // The common "open History" path then does zero work, so the nav transition
    // stays as smooth as the other tabs. Starts dirty so it builds once.
    let historyDirty    = true;

    // --- APP VERSION (in Settings) ---
    // Ask the active service worker which cache is serving us, so the number
    // reflects the live deploy and ticks over when an update lands.
    (function showAppVersion() {
        const el = document.getElementById('app-version');
        if (!el) return;
        const render = (v) => { el.textContent = v ? `Version ${v.replace(/^workout-pwa-/, '')}` : 'Version (not installed)'; };
        const sw = navigator.serviceWorker;
        if (!sw) { render(null); return; }
        const ask = () => {
            // On a fresh install the controller attaches after load, so retry until present.
            if (!sw.controller) return;
            const ch = new MessageChannel();
            ch.port1.onmessage = (e) => render(e.data);
            sw.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
        };
        ask();
        if (!sw.controller) sw.addEventListener('controllerchange', ask, { once: true });
    })();

    // --- INITIALIZATION ---
    // Fresh installs start with an empty log (only the generic exercise library is
    // seeded). There is no developer-data auto-import — each user's data is their own.
    DB.seedExercises()
        .then(loadExerciseDefs)
        .then(refreshExerciseCache);
    loadTodaySets();

    // Pre-build the (hidden) History view during idle time so the first tap is
    // instant — the work happens off the critical path, not mid tab-switch.
    const warmHistory = () => loadHistory();
    if ('requestIdleCallback' in window) requestIdleCallback(warmHistory, { timeout: 2000 });
    else setTimeout(warmHistory, 800); // iOS Safari has no requestIdleCallback

    async function loadExerciseDefs() {
        const defs = await DB.getAllExercises();
        if (defs.length) {
            EXERCISE_DEFS = Object.fromEntries(defs.map(d => [d.name, d]));
        }
    }

    // ── Rest Timer ───────────────────────────────────────────────────────────
    const restTimer    = document.getElementById('rest-timer');
    const timerDisplay = restTimer.querySelector('.timer-display');
    const restHint     = document.getElementById('rest-hint');
    let   timerInterval = null;
    const MAX_REST_MS   = 6 * 60 * 1000;
    const WARN_MS       = 4 * 60 * 1000;

    function startTimer(fromTimestamp, warnMs = WARN_MS) {
        clearInterval(timerInterval);
        // Show the exercise-specific threshold so the user knows what they're being held to.
        restHint.textContent = warnMs !== WARN_MS ? `avg ${fmtDuration(Math.round(warnMs / 1000))}` : '';
        function tick() {
            const elapsed = Date.now() - fromTimestamp;
            if (elapsed >= MAX_REST_MS) {
                restTimer.classList.add('hidden');
                clearInterval(timerInterval);
                return;
            }
            const secs = Math.floor(elapsed / 1000);
            const m    = String(Math.floor(secs / 60)).padStart(2, '0');
            const s    = String(secs % 60).padStart(2, '0');
            timerDisplay.textContent = `${m}:${s}`;
            restTimer.classList.toggle('warn', elapsed >= warnMs);
            restTimer.classList.remove('hidden');
        }
        tick();
        timerInterval = setInterval(tick, 1000);
    }

    async function initTimer() {
        const sets = await DB.getTodaySets();
        if (!sets.length || (Date.now() - sets[0].timestamp) >= MAX_REST_MS) return;
        const lastSets   = await DB.getLastSessionAllSets(sets[0].exercise);
        const customWarn = avgIntraRestMs(lastSets, sets[0].exercise) ?? WARN_MS;
        startTimer(sets[0].timestamp, customWarn);
    }
    initTimer();

    // =============================================
    // 1. EXERCISE CACHE
    // =============================================
    async function refreshExerciseCache() {
        const logged  = await DB.getUniqueExercises();
        const defined = (await DB.getAllExercises()).map(d => d.name);
        const names   = [...new Set([...logged, ...defined])].sort();
        allExercises  = await Promise.all(
            names.map(async name => {
                const last = await DB.getLastSetForExercise(name);
                return {
                    name,
                    lastWeight: last ? last.weight : null,
                    lastReps:   last ? last.reps   : null,
                    def:        getDef(name),
                };
            })
        );
    }

    // =============================================
    // 2. AUTOCOMPLETE DROPDOWN
    // =============================================

    function buildNameHTML(name, query) {
        if (!query) return name;
        const idx = name.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return name;
        return (
            name.slice(0, idx) +
            '<mark>' + name.slice(idx, idx + query.length) + '</mark>' +
            name.slice(idx + query.length)
        );
    }

    function renderDropdown(query) {
        const q = query.trim();
        const matches = q
            ? allExercises.filter(e => e.name.toLowerCase().includes(q.toLowerCase()))
            : allExercises;

        dropdown.innerHTML = '';

        if (matches.length === 0) {
            if (q) {
                // Offer to create the typed exercise on the spot, so it gets a real
                // definition (tracking/category) instead of becoming a free-typed set.
                const create = document.createElement('div');
                create.className = 'autocomplete-item autocomplete-create';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'autocomplete-item-name';
                nameSpan.textContent = `➕ Create “${q}”`;
                const hintSpan = document.createElement('span');
                hintSpan.className = 'autocomplete-item-hint';
                hintSpan.textContent = 'set tracking type';
                create.append(nameSpan, hintSpan);

                const fire = (e) => { e.preventDefault(); closeDropdown(); openExerciseModal(null, q); };
                create.addEventListener('touchend', fire);
                create.addEventListener('mousedown', fire);
                dropdown.appendChild(create);
            } else {
                const empty = document.createElement('div');
                empty.className = 'autocomplete-empty';
                empty.textContent = 'No exercises yet — add one in Settings';
                dropdown.appendChild(empty);
            }
        } else {
            matches.forEach(item => {
                const el = document.createElement('div');
                el.className = 'autocomplete-item';

                const hint = (item.lastWeight !== null && item.lastReps !== null)
                    ? `${item.lastWeight} × ${item.lastReps}`
                    : '';

                el.innerHTML = `
                    <span class="autocomplete-item-name">${buildNameHTML(item.name, q)}</span>
                    ${hint ? `<span class="autocomplete-item-hint">${hint}</span>` : ''}
                `;

                let touchStartY = 0, touchMoved = false;

                el.addEventListener('touchstart', (e) => {
                    touchStartY = e.touches[0].clientY;
                    touchMoved = false;
                    el.classList.add('is-pressing');
                }, { passive: true });

                el.addEventListener('touchmove', (e) => {
                    // Treat a real drag as a scroll, not a tap, so the list can scroll
                    if (Math.abs(e.touches[0].clientY - touchStartY) > 8) {
                        touchMoved = true;
                        el.classList.remove('is-pressing');
                    }
                }, { passive: true });

                el.addEventListener('touchend', (e) => {
                    if (touchMoved) return;   // was a scroll — don't select
                    e.preventDefault();
                    selectExercise(item);
                });

                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    selectExercise(item);
                });

                dropdown.appendChild(el);
            });
        }

        openDropdown();
    }

    function openDropdown()  { exerciseAnchor.classList.add('is-open'); }

    function closeDropdown() {
        exerciseAnchor.classList.remove('is-open');
        dropdown.querySelectorAll('.is-pressing').forEach(el => el.classList.remove('is-pressing'));
    }

    function selectExercise(item) {
        exerciseInput.value = item.name;
        applyTracking(item.def);
        if (item.lastWeight !== null) weightInput.value = dispWeight(item.lastWeight);
        if (item.lastReps   !== null) repsInput.value   = item.lastReps;
        closeDropdown();
        loadImproveCtx(item.name); // refresh the "vs last session" comparison
    }

    function applyTracking(def) {
        currentTracking = def?.tracking || 'weighted';
        const isWeighted = currentTracking === 'weighted';
        const isBanded   = currentTracking === 'banded';
        const isTimed    = currentTracking === 'timed';

        groupWeight.classList.toggle('hidden', isBanded);
        weightLabel.textContent = `${isWeighted ? 'Weight' : 'Added weight'} (${unitLabel()})`;
        groupReps.classList.toggle('hidden', isTimed);
        groupDuration.classList.toggle('hidden', !isTimed);
        groupBand.classList.toggle('hidden', !isBanded);
    }

    // Band-level segmented control
    let currentBand = 'medium';
    bandSegmented.querySelectorAll('.seg-btn').forEach(btn => {
        const pick = (e) => {
            e.preventDefault();
            currentBand = btn.dataset.band;
            bandSegmented.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
            renderImproveBar();
        };
        btn.addEventListener('touchend', pick);
        btn.addEventListener('click', pick);
    });

    // ── Improvement bar ───────────────────────────────────────────────────────
    // Compares the set you're about to log against the SAME-ORDER set of the
    // previous session for this exercise (set 2 vs set 2, etc.), using the
    // tracking-appropriate metric (e1RM / reps / seconds). The DB lookup is cached
    // per exercise in `improveCtx` so live weight/reps edits re-render synchronously.
    let improveCtx = null; // { exercise, prevSets:[], todayCount, def, bw }
    const IMPROVE_CAP = 25; // % delta that fills half the track

    async function loadImproveCtx(name) {
        if (!name) { improveCtx = null; renderImproveBar(); return; }
        const def     = getDef(name);
        const daySets = await DB.getLastSessionAllSets(name);
        const prevSets = daySets
            .filter(s => s.exercise === name)
            .sort((a, b) => a.timestamp - b.timestamp);
        const today = (await DB.getTodaySets()).filter(s => s.exercise === name);
        improveCtx = { exercise: name, prevSets, todayCount: today.length, def, bw: getBodyweight() };
        renderImproveBar();
    }

    function currentFormSet() {
        return {
            weight:    toLbs(parseFloat(weightInput.value) || 0),
            reps:      parseInt(repsInput.value)       || 0,
            duration:  parseInt(durationInput.value)   || 0,
            bandLevel: currentBand,
        };
    }

    function renderImproveBar() {
        // Hide unless the loaded context matches the exercise currently in the field.
        if (!improveCtx || improveCtx.exercise !== exerciseInput.value.trim()) {
            improveBar.classList.add('hidden');
            return;
        }
        improveBar.classList.remove('hidden');

        const { prevSets, todayCount, def, bw } = improveCtx;
        const setNo = todayCount + 1;                 // the set about to be logged
        const prev  = prevSets[todayCount];           // same-order set last session
        const cur   = currentFormSet();
        const hasInput = currentTracking === 'timed' ? cur.duration > 0 : cur.reps > 0;

        improveSetEl.textContent = `Set ${setNo}`;

        const setBar = (state, pct) => {
            improveBar.dataset.state = state;          // none | up | down | even | new | first
            // Diverging fill: grows from the centre, right for gains, left for losses.
            const mag = Math.min(Math.abs(pct ?? 0), IMPROVE_CAP) / IMPROVE_CAP * 50;
            if (state === 'up') {
                improveFill.style.left = '50%'; improveFill.style.right = 'auto';
                improveFill.style.width = mag + '%';
            } else if (state === 'down') {
                improveFill.style.right = '50%'; improveFill.style.left = 'auto';
                improveFill.style.width = mag + '%';
            } else {
                improveFill.style.width = '0%';
            }
        };

        if (!prevSets.length) {                        // never trained before
            improvePct.textContent = 'First time';
            improveSub.textContent = 'No previous session to compare';
            setBar('first');
            return;
        }
        if (!prev) {                                   // beyond last session's set count
            improvePct.textContent = 'New ground';
            improveSub.textContent = `Last session had ${prevSets.length} set${prevSets.length !== 1 ? 's' : ''}`;
            setBar('new');
            return;
        }

        const prevMetric = setMetric(prev, def, bodyweightAt(prev.timestamp));
        improveSub.textContent = `Last set ${setNo}: ${formatSet(prev)}`;

        if (!hasInput || prevMetric <= 0) {            // nothing entered yet → show the target
            improvePct.textContent = 'vs last';
            setBar('none');
            return;
        }

        const curMetric = setMetric(cur, def, bw);
        const pct = (curMetric / prevMetric - 1) * 100;
        if (Math.abs(pct) < 0.5) {
            improvePct.textContent = 'Even';
            setBar('even');
        } else if (pct > 0) {
            improvePct.textContent = `▲ ${pct.toFixed(pct < 10 ? 1 : 0)}%`;
            setBar('up', pct);
        } else {
            improvePct.textContent = `▼ ${Math.abs(pct).toFixed(pct > -10 ? 1 : 0)}%`;
            setBar('down', pct);
        }
    }

    // Live-update the bar as the numbers change.
    [weightInput, repsInput, durationInput].forEach(el =>
        el.addEventListener('input', renderImproveBar));

    exerciseInput.addEventListener('focus', () => {
        exerciseInput.select();   // typing replaces; tapping away keeps the value
        renderDropdown('');       // still show the full list so you can switch exercises
    });

    exerciseInput.addEventListener('input', () => {
        renderDropdown(exerciseInput.value);
        renderImproveBar(); // hide the comparison while the name no longer matches
    });

    // Typed the full name (no dropdown tap)? Load the comparison on commit.
    exerciseInput.addEventListener('change', () => {
        const name = exerciseInput.value.trim();
        if (name && (!improveCtx || improveCtx.exercise !== name)
            && allExercises.some(e => e.name === name))
            loadImproveCtx(name);
    });

    document.addEventListener('touchstart', (e) => {
        if (!exerciseAnchor.contains(e.target)) closeDropdown();
    }, { passive: true });

    exerciseInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDropdown();
    });

    // =============================================
    // 4. FORM SUBMISSION
    // =============================================
    // Rate-limit the submit. The handler is async (it awaits DB writes), so a
    // double-tap on "Log Set" fires a second submit before the first finishes and
    // logs a DUPLICATE set. `logging` blocks concurrent submits; the cooldown
    // drops rapid re-taps just after a save (visually covered by the 800ms
    // "Saved!" state). try/finally guarantees the guard releases even on error.
    let logging   = false;
    let lastLogAt = 0;
    const LOG_COOLDOWN_MS = 700;

    logForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        closeDropdown();

        if (logging || Date.now() - lastLogAt < LOG_COOLDOWN_MS) return;

        // Require reps for all non-timed tracking; require duration for timed.
        // (Invalid submits return before arming the guard/cooldown.)
        if (currentTracking !== 'timed' && (parseInt(repsInput.value) || 0) < 1) {
            repsInput.classList.add('input-error');
            repsInput.focus();
            setTimeout(() => repsInput.classList.remove('input-error'), 1000);
            return;
        }
        if (currentTracking === 'timed' && (parseInt(durationInput.value) || 0) < 1) {
            durationInput.classList.add('input-error');
            durationInput.focus();
            setTimeout(() => durationInput.classList.remove('input-error'), 1000);
            return;
        }

        logging = true;
        try {
            const set = {
                exercise: exerciseInput.value.trim(),
                weight:   toLbs(parseFloat(weightInput.value) || 0), // store canonical lbs
                reps:     parseInt(repsInput.value)     || 0,
                notes:    '', // notes are added later via the edit-set modal
            };
            if (currentTracking === 'timed')  set.duration  = parseInt(durationInput.value) || 0;
            if (currentTracking === 'banded') set.bandLevel = currentBand;

            await DB.addSet(set);
            lastLogAt = Date.now();   // arm the cooldown from the moment it's saved
            historyDirty = true; // new set logged — History must rebuild before next open
            const lastSets   = await DB.getLastSessionAllSets(set.exercise);
            const customWarn = avgIntraRestMs(lastSets, set.exercise) ?? WARN_MS;
            startTimer(Date.now(), customWarn);

            loadImproveCtx(set.exercise); // advance the comparison to the next set's order

            await refreshExerciseCache();

            const btn = logForm.querySelector('.btn-primary');
            const originalText = btn.textContent;
            btn.textContent = 'Saved!';
            btn.style.backgroundColor = '#28a745';
            btn.classList.remove('is-saved');
            void btn.offsetWidth;            // restart the pop on rapid consecutive logs
            btn.classList.add('is-saved');
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.backgroundColor = '';
                btn.classList.remove('is-saved');
            }, 800);

            loadTodaySets(true);
        } finally {
            logging = false;
        }
    });

    // =============================================
    // 5. UI RENDERING
    // =============================================
    // `animateNewest` plays the drop-in entrance on the top (just-logged) row.
    // Only the log-form submit passes it — initial load, edits and deletes
    // re-render silently so existing rows don't all re-animate.
    async function loadTodaySets(animateNewest = false) {
        const sets = await DB.getTodaySets();
        const list = document.getElementById('today-list');
        list.innerHTML = '';
        sets.forEach((set, i) => {
            const el = createSetElement(set);
            if (animateNewest && i === 0) el.classList.add('set-item-enter');
            list.appendChild(el);
        });
    }

    async function loadHistory() {
        historyDirty = false; // freshly built below; stays clean until a set changes
        const sets = await DB.getAllSets();
        const container = document.getElementById('history-container');
        container.innerHTML = '';
        if (!sets.length) { container.innerHTML = '<p style="padding:20px;">No workout history found.</p>'; return; }

        const dayKey      = ts => new Date(ts).toLocaleDateString();
        const trainedDays = new Set(sets.map(s => dayKey(s.timestamp)));

        let activeDateFilter = null;
        let activeFilter     = null; // 'push'|'pull'|'legs'|'core'|null

        // ── Summary stats ────────────────────────────────────────────────────────
        function computeStreak() {
            let streak = 0;
            const d = new Date(); d.setHours(0, 0, 0, 0);
            if (!trainedDays.has(d.toLocaleDateString())) d.setDate(d.getDate() - 1);
            while (trainedDays.has(d.toLocaleDateString())) { streak++; d.setDate(d.getDate() - 1); }
            return streak;
        }
        const nowD = new Date();
        const thisMonth = new Set(
            sets.filter(s => { const t = new Date(s.timestamp); return t.getMonth() === nowD.getMonth() && t.getFullYear() === nowD.getFullYear(); })
                .map(s => dayKey(s.timestamp))
        ).size;
        const totalVolume = Math.round(sets.reduce((a, s) => a + setVolume(s), 0));
        const fmtVol = v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'k' : v.toLocaleString();

        const statsRow = document.createElement('div');
        statsRow.className = 'stats-row';
        statsRow.innerHTML = [
            { v: computeStreak(),     l: 'Day streak'   },
            { v: thisMonth,           l: 'This month'   },
            { v: trainedDays.size,    l: 'Days trained' },
            { v: fmtVol(fromLbs(totalVolume)), l: `Total ${unitLabel()}` },
        ].map(s => `<div class="stat-card"><div class="stat-value">${s.v}</div><div class="stat-label">${s.l}</div></div>`).join('');
        container.appendChild(statsRow);

        // ── Per-day metadata ─────────────────────────────────────────────────────
        const dayMap = {}; // dateKey → sets[] (used for GTG inference + category mix)
        sets.forEach(s => { (dayMap[dayKey(s.timestamp)] ||= []).push(s); });

        // ── Heatmap ──────────────────────────────────────────────────────────────
        // A focused window of 1M / 3M that you page through time with ‹ › arrows.
        // Cells are sized to fit the card width (never scrolls) and re-render with a
        // left→right wave-in on every change.
        const HEAT_RANGES = [{ days: 30, label: '1M', weeks: 5 },
                             { days: 90, label: '3M', weeks: 13 }];
        let heatRange = parseInt(localStorage.getItem('heat_range')) || 90;
        if (!HEAT_RANGES.some(r => r.days === heatRange)) heatRange = 90;
        let heatOffset = 0; // whole-window pages back from today (0 = up to today)

        // Earliest training day — stops paging into empty pre-history. `sets` is
        // newest-first (getAllSets), so the last element is the oldest.
        const earliestDay = new Date(sets.length ? sets[sets.length - 1].timestamp : Date.now());
        earliestDay.setHours(0, 0, 0, 0);

        // Header: ‹ window-label › on the left, range slider on the right.
        const controls = document.createElement('div');
        controls.className = 'heat-controls';
        const nav = document.createElement('div');
        nav.className = 'heat-nav';
        nav.innerHTML =
            `<button type="button" class="heat-arrow" data-dir="-1" aria-label="Earlier">‹</button>` +
            `<span class="heat-range-label"></span>` +
            `<button type="button" class="heat-arrow" data-dir="1" aria-label="Later">›</button>`;
        const rangeLabel = nav.querySelector('.heat-range-label');
        const prevBtn    = nav.querySelector('[data-dir="-1"]');
        const nextBtn    = nav.querySelector('[data-dir="1"]');
        const slider = document.createElement('div');
        slider.className = 'heat-range';
        slider.innerHTML = `<div class="hr-thumb"></div>` +
            HEAT_RANGES.map(r => `<button type="button" data-days="${r.days}">${r.label}</button>`).join('');
        const thumb     = slider.querySelector('.hr-thumb');
        const rangeBtns = [...slider.querySelectorAll('button')];
        const positionThumb = () => {
            const idx = Math.max(0, HEAT_RANGES.findIndex(r => r.days === heatRange));
            thumb.style.transform = `translateX(${idx * 100}%)`;
            rangeBtns.forEach((b, i) => b.classList.toggle('active', i === idx));
        };
        rangeBtns.forEach(btn => btn.addEventListener('click', () => {
            heatRange  = parseInt(btn.dataset.days);
            heatOffset = 0; // switching range jumps back to the current window
            localStorage.setItem('heat_range', String(heatRange));
            positionThumb();
            renderHeatmap();
        }));
        prevBtn.addEventListener('click', () => { if (!prevBtn.disabled) { heatOffset++;     renderHeatmap(); } });
        nextBtn.addEventListener('click', () => { if (heatOffset > 0)    { heatOffset--;     renderHeatmap(); } });
        controls.append(nav, slider);
        container.appendChild(controls);

        const heatWrap = document.createElement('div');
        heatWrap.className = 'heat-wrap';
        const monthRow = document.createElement('div');
        monthRow.className = 'heat-months';
        const heatmap = document.createElement('div');
        heatmap.className = 'heatmap';
        heatWrap.append(monthRow, heatmap);
        container.appendChild(heatWrap);

        const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function renderHeatmap() {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const weeks = (HEAT_RANGES.find(r => r.days === heatRange) || HEAT_RANGES[1]).weeks;

            // Window of `weeks` whole weeks (Sun-aligned), shifted back by whole pages.
            const start = new Date(today);
            start.setDate(start.getDate() - start.getDay()); // this week's Sunday
            start.setDate(start.getDate() - (weeks - 1 + heatOffset * weeks) * 7);

            // Window label + arrow availability.
            const winEnd   = new Date(start); winEnd.setDate(winEnd.getDate() + weeks * 7 - 1);
            const labelEnd = winEnd > today ? today : winEnd;
            const opt = { month: 'short', day: 'numeric' };
            rangeLabel.textContent = `${start.toLocaleDateString('en-US', opt)} – ${labelEnd.toLocaleDateString('en-US', opt)}`;
            nextBtn.disabled = heatOffset === 0;
            prevBtn.disabled = start.getTime() <= earliestDay.getTime();
            [[nextBtn], [prevBtn]].forEach(([b]) => b.classList.toggle('is-disabled', b.disabled));

            // Size cells so the whole grid fits the card width — no horizontal scroll.
            const avail = Math.min(window.innerWidth, 600) - 56; // main + heat-wrap padding
            const gap   = 3;
            const cell  = Math.max(8, Math.min(20, Math.floor((avail - (weeks - 1) * gap) / weeks)));
            [heatmap, monthRow].forEach(el => {
                el.style.setProperty('--cell', cell + 'px');
                el.style.setProperty('--gap', gap + 'px');
            });

            monthRow.innerHTML = '';
            let lastMonth = -1, lastLabelWeek = -99;
            const minLabelCols = Math.ceil(22 / (cell + gap)); // keep labels from colliding
            for (let w = 0; w < weeks; w++) {
                const d = new Date(start); d.setDate(d.getDate() + w * 7);
                const lbl = document.createElement('span');
                if (d.getMonth() !== lastMonth) {
                    lastMonth = d.getMonth();
                    if (w - lastLabelWeek >= minLabelCols) {
                        lbl.textContent = d.toLocaleDateString('en-US', { month: 'short' });
                        lastLabelWeek = w;
                    }
                }
                monthRow.appendChild(lbl);
            }

            heatmap.innerHTML = '';
            for (let i = 0; i < weeks * 7; i++) {
                const d = new Date(start); d.setDate(d.getDate() + i);
                const cellEl = document.createElement('div');
                cellEl.className = 'heat-cell';
                // Wave-in: oldest column (left) first, sweeping right, offset down each row.
                if (!reduceMotion) {
                    const week = Math.floor(i / 7), row = i % 7;
                    cellEl.classList.add('heat-animate');
                    cellEl.style.animationDelay = (week * 22 + row * 10) + 'ms';
                }
                if (d > today) { cellEl.classList.add('heat-future'); heatmap.appendChild(cellEl); continue; }
                if (d.getTime() === today.getTime()) cellEl.classList.add('heat-today');

                const dateKey  = d.toLocaleDateString();
                if (dateKey === activeDateFilter) cellEl.classList.add('selected');
                const daySets  = dayMap[dateKey];
                if (daySets) {
                    const profile = dayCategoryProfile(daySets);
                    if (isGtgDay(daySets)) {
                        // Sparse / greasing the groove: don't "fill" the square — just mark
                        // it with a dot tinted by the day's dominant category.
                        cellEl.classList.add('heat-gtg');
                        cellEl.style.setProperty('--gtg-dot', CAT_COLOR[profile.dominant] || 'rgba(255,255,255,0.9)');
                    } else if (profile.mixed) {
                        const grad = proportionalGradient(profile.counts);
                        if (grad) cellEl.style.background = grad;
                        else cellEl.classList.add('heat-mixed');
                    } else if (profile.dominant) {
                        cellEl.classList.add(`heat-${profile.dominant}`);
                    }

                    cellEl.addEventListener('click', () => {
                        const isSame = activeDateFilter === dateKey;
                        activeDateFilter = isSame ? null : dateKey;
                        heatmap.querySelectorAll('.heat-cell').forEach(c => c.classList.remove('selected'));
                        if (!isSame) cellEl.classList.add('selected');
                        renderSessions();
                    });
                }
                heatmap.appendChild(cellEl);
            }
        }

        positionThumb();
        renderHeatmap();

        // Legend (includes GTG dot entry)
        const legend = document.createElement('div');
        legend.className = 'heat-legend';
        legend.innerHTML =
            [['push','Push'],['pull','Pull'],['legs','Legs'],['core','Core']]
                .map(([c, l]) => `<span class="legend-item"><span class="legend-swatch heat-${c}"></span>${l}</span>`)
                .join('') +
            `<span class="legend-item"><span class="legend-swatch legend-mixed-swatch"></span>Mixed</span>` +
            `<span class="legend-item"><span class="legend-swatch legend-gtg-swatch"></span>GTG</span>`;
        container.appendChild(legend);

        // ── Category filter chips ────────────────────────────────────────────────
        const chipsRow = document.createElement('div');
        chipsRow.className = 'filter-chips';
        [['All', null], ['Push', 'push'], ['Pull', 'pull'], ['Legs', 'legs'], ['Core', 'core']].forEach(([label, cat]) => {
            const chip = document.createElement('div');
            chip.className = 'chip' + (cat === null ? ' active' : '');
            chip.textContent = label;
            chip.addEventListener('click', () => {
                activeFilter = cat;
                chipsRow.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
                renderSessions();
            });
            chipsRow.appendChild(chip);
        });
        container.appendChild(chipsRow);

        // ── Clear-filter banner ──────────────────────────────────────────────────
        const banner = document.createElement('div');
        banner.className = 'filter-banner hidden';
        banner.addEventListener('click', () => {
            activeDateFilter = null;
            activeFilter     = null;
            heatmap.querySelectorAll('.heat-cell').forEach(c => c.classList.remove('selected'));
            chipsRow.querySelectorAll('.chip').forEach((c, idx) => c.classList.toggle('active', idx === 0));
            renderSessions();
        });
        container.appendChild(banner);

        // ── Group sets into day buckets (newest-first) ───────────────────────────
        const days = [];
        sets.forEach(s => {
            const key = dayKey(s.timestamp);
            if (!days.length || days[days.length - 1].key !== key) days.push({ key, sets: [] });
            days[days.length - 1].sets.push(s);
        });

        // ── Per-exercise trend arrows ─────────────────────────────────────────────
        function sessionMetric(s) {
            const t = trackingOf(s);
            if (t === 'timed')  return s.duration || 0;
            if (t === 'banded') return s.reps || 0;
            return e1rm(loadOf(s, getDef(s.exercise), bodyweightAt(s.timestamp)), s.reps || 0);
        }
        const exerciseDays = {};
        [...sets].reverse().forEach(s => {
            const date = dayKey(s.timestamp);
            const arr  = exerciseDays[s.exercise] ||= [];
            const m    = sessionMetric(s);
            if (!arr.length || arr[arr.length - 1].date !== date) arr.push({ date, metric: m });
            else arr[arr.length - 1].metric = Math.max(arr[arr.length - 1].metric, m);
        });
        function progressIcon(ex, date) {
            const arr = exerciseDays[ex]; if (!arr) return '';
            const i = arr.findIndex(h => h.date === date);
            if (i <= 0) return '';
            if (arr[i].metric > arr[i - 1].metric) return ' <span class="pill-up">↑</span>';
            if (arr[i].metric < arr[i - 1].metric) return ' <span class="pill-down">↓</span>';
            return '';
        }

        // ── Sessions ─────────────────────────────────────────────────────────────
        const sessionsDiv = document.createElement('div');
        container.appendChild(sessionsDiv);

        function renderSessions() {
            sessionsDiv.innerHTML = '';

            const parts = [];
            if (activeDateFilter) parts.push(new Date(activeDateFilter).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
            if (activeFilter)     parts.push(activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1));
            if (parts.length) {
                banner.classList.remove('hidden');
                banner.innerHTML = `Showing ${parts.join(' · ')} <span class="banner-x">✕ clear</span>`;
            } else banner.classList.add('hidden');

            let visible = activeDateFilter ? days.filter(d => d.key === activeDateFilter) : days;
            if (activeFilter)
                visible = visible.map(d => ({ ...d, sets: d.sets.filter(s => getCategory(s.exercise) === activeFilter) })).filter(d => d.sets.length);

            visible.forEach((day, i) => {
                const setsAsc = [...day.sets].sort((a, b) => a.timestamp - b.timestamp);
                const exNames = [...new Set(setsAsc.map(s => s.exercise))];
                const vol     = Math.round(fromLbs(day.sets.reduce((a, s) => a + setVolume(s), 0))).toLocaleString();
                const label   = new Date(setsAsc[0].timestamp).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

                // GTG/category derived from the day's actual training, not a flag.
                // Note: when a category filter is active, `day.sets` is already filtered,
                // so the profile reflects the filtered subset — which is what's shown.
                const profile = dayCategoryProfile(day.sets);
                const isGTG   = isGtgDay(day.sets);
                const tagCat  = profile.mixed ? 'mixed' : profile.dominant;
                const catTag  = tagCat ? `<span class="cat-tag" data-cat="${tagCat}">${tagCat}</span>` : '';
                const gtgTag  = isGTG ? `<span class="tag-gtg">GTG</span>` : '';

                const card = document.createElement('div');
                card.className = 'session-card' + (i === 0 ? ' open' : '');
                if (isGTG) card.dataset.gtg = 'true';

                // Left border: solid category class, or a proportional gradient when mixed.
                if (profile.mixed) {
                    const grad = proportionalGradient(profile.counts);
                    if (grad) {
                        card.style.setProperty('--mix-gradient', grad);
                        card.classList.add('session-mixed-gradient');
                    } else {
                        card.dataset.cat = 'mixed';
                    }
                } else if (profile.dominant) {
                    card.dataset.cat = profile.dominant;
                }

                card.innerHTML = `
                    <div class="session-header">
                        <div>
                            <div class="session-title">${label} ${catTag}${gtgTag}</div>
                            <div class="session-summary">${exNames.length} exercise${exNames.length !== 1 ? 's' : ''} · ${setsAsc.length} set${setsAsc.length !== 1 ? 's' : ''} · ${vol} ${unitLabel()}</div>
                        </div>
                        <span class="session-toggle">⌄</span>
                    </div>
                    <div class="session-body"></div>`;

                const body = card.querySelector('.session-body');
                // Build the timeline rows lazily — collapsed bodies are display:none,
                // so populating every day's rows upfront is wasted work that lagged the
                // History open. Only the initially-open card is built now; the rest fill
                // in the first time they're expanded.
                const populateBody = () => {
                    if (card.dataset.populated) return;
                    card.dataset.populated = 'true';
                    const seen = new Set();
                    setsAsc.forEach(s => {
                        const exCat = getCategory(s.exercise);
                        const time  = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const arrow = seen.has(s.exercise) ? '' : progressIcon(s.exercise, day.key);
                        seen.add(s.exercise);
                        const row = document.createElement('div');
                        row.className = 'timeline-row';
                        if (exCat) row.dataset.cat = exCat;
                        row.innerHTML = `
                            <span class="tl-time">${time}</span>
                            <span class="tl-ex${exCat ? ` cat-${exCat}` : ''}">${s.exercise}${arrow}</span>
                            <span class="tl-detail">${formatSet(s)}</span>`;
                        body.appendChild(row);
                    });
                };
                if (i === 0) populateBody();

                card.querySelector('.session-header').addEventListener('click', () => {
                    if (!card.classList.contains('open')) populateBody(); // build on first expand
                    card.classList.toggle('open');
                });
                sessionsDiv.appendChild(card);
            });

            if (!visible.length)
                sessionsDiv.innerHTML = '<p style="padding:20px;color:var(--text-secondary)">No sessions for this filter.</p>';
        }

        renderSessions();
    }

    function createSetElement(set) {
        const li = document.createElement('li');
        li.className = 'set-item';
        const time = new Date(set.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        li.innerHTML = `
            <div class="set-details">
                <h3>${set.exercise}</h3>
                <p>${formatSet(set)} ${set.notes ? `| ${set.notes}` : ''}</p>
            </div>
            <div class="set-time">${time}</div>
        `;

        li.addEventListener('click', () => openEditSet(set));
        return li;
    }

    function refreshSetViews() {
        loadTodaySets();
        historyDirty = true; // a set changed — History must rebuild before next view
        // A delete/edit changes today's set count, so the improvement bar's set
        // order is now stale — refresh it for whatever exercise is in the form.
        if (exerciseInput.value.trim()) loadImproveCtx(exerciseInput.value.trim());
        // If History is open right now, refresh it — but after the current
        // interaction/animation settles, so the rebuild never janks a transition.
        if (!document.getElementById('view-history').classList.contains('hidden'))
            setTimeout(loadHistory, 300);
    }

    // ── EDIT LOGGED SET MODAL ─────────────────────────────────────────────────
    const setModal       = document.getElementById('set-modal');
    const setWeightInput = document.getElementById('set-weight');
    const setRepsInput   = document.getElementById('set-reps');
    const setDurInput    = document.getElementById('set-duration');
    const setNotesInput  = document.getElementById('set-notes');
    const setWeightLabel = document.getElementById('set-weight-label');
    const setBandSeg     = document.getElementById('set-band-segmented');
    let   editingSetId   = null;
    let   editingTracking = 'weighted';
    let   editingBand    = 'medium';

    function openEditSet(set) {
        editingSetId    = set.id;
        const def       = getDef(set.exercise);
        editingTracking = def?.tracking || 'weighted';
        document.getElementById('set-modal-title').textContent = set.exercise;

        const isWeighted = editingTracking === 'weighted';
        const isBanded   = editingTracking === 'banded';
        const isTimed    = editingTracking === 'timed';
        document.getElementById('set-group-weight').classList.toggle('hidden', isBanded);
        document.getElementById('set-group-reps').classList.toggle('hidden', isTimed);
        document.getElementById('set-group-duration').classList.toggle('hidden', !isTimed);
        document.getElementById('set-group-band').classList.toggle('hidden', !isBanded);
        setWeightLabel.textContent = `${isWeighted ? 'Weight' : 'Added weight'} (${unitLabel()})`;

        setWeightInput.value = dispWeight(set.weight ?? 0);
        setRepsInput.value   = set.reps    ?? 0;
        setDurInput.value    = set.duration ?? 0;
        setNotesInput.value  = set.notes   || '';
        editingBand = set.bandLevel || 'medium';
        setBandSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.band === editingBand));

        setModal.classList.remove('hidden');
    }
    function closeEditSet() { setModal.classList.add('hidden'); editingSetId = null; }

    setBandSeg.querySelectorAll('.seg-btn').forEach(btn => {
        const pick = (e) => {
            e.preventDefault();
            editingBand = btn.dataset.band;
            setBandSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
        };
        btn.addEventListener('touchend', pick);
        btn.addEventListener('click', pick);
    });

    document.getElementById('set-cancel').addEventListener('click', closeEditSet);
    setModal.addEventListener('click', (e) => { if (e.target === setModal) closeEditSet(); });

    document.getElementById('set-save').addEventListener('click', async () => {
        if (editingSetId == null) return;

        if (editingTracking !== 'timed' && (parseInt(setRepsInput.value) || 0) < 1) {
            setRepsInput.classList.add('input-error');
            setRepsInput.focus();
            setTimeout(() => setRepsInput.classList.remove('input-error'), 1000);
            return;
        }
        if (editingTracking === 'timed' && (parseInt(setDurInput.value) || 0) < 1) {
            setDurInput.classList.add('input-error');
            setDurInput.focus();
            setTimeout(() => setDurInput.classList.remove('input-error'), 1000);
            return;
        }

        const changes = {
            weight: toLbs(parseFloat(setWeightInput.value) || 0), // store canonical lbs
            reps:   parseInt(setRepsInput.value) || 0,
            notes:  setNotesInput.value.trim(),
        };
        if (editingTracking === 'timed')  changes.duration  = parseInt(setDurInput.value) || 0;
        if (editingTracking === 'banded') changes.bandLevel = editingBand;
        await DB.updateSet(editingSetId, changes);
        closeEditSet();
        refreshSetViews();
    });

    document.getElementById('set-delete').addEventListener('click', async () => {
        if (editingSetId == null) return;
        if (!confirm('Delete this set?')) return;
        await DB.deleteSet(editingSetId);
        closeEditSet();
        refreshSetViews();
    });

    // ── ANALYSIS TAB ─────────────────────────────────────────────────────────────
    let analysisChart = null;

    async function loadAnalysis() {
        const select = document.getElementById('analysis-exercise');
        const prev   = select.value;
        const names  = await DB.getUniqueExercises();
        select.innerHTML = '<option value="">Select an exercise…</option>';
        names.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (name === prev) opt.selected = true;
            select.appendChild(opt);
        });
        if (prev) renderAnalysis(prev);
    }

    async function renderAnalysis(exerciseName) {
        const prCard      = document.getElementById('analysis-pr');
        const predictCard = document.getElementById('analysis-prediction');
        const setLogEl    = document.getElementById('analysis-set-log');
        const canvas = document.getElementById('analysis-chart');
        if (!exerciseName) {
            prCard.className = 'pr-card hidden';
            predictCard.className = 'predict-card hidden';
            setLogEl.innerHTML = '';
            if (analysisChart) { analysisChart.destroy(); analysisChart = null; }
            return;
        }

        const all  = await DB.getAllSets();
        const sets = all.filter(s => s.exercise === exerciseName);
        if (!sets.length) return;

        const sessionMap = {};
        sets.forEach(s => {
            const key = new Date(s.timestamp).toLocaleDateString();
            if (!sessionMap[key]) sessionMap[key] = { timestamp: s.timestamp, sets: [] };
            sessionMap[key].sets.push(s);
        });

        const sessions = Object.entries(sessionMap)
            .sort((a, b) => a[1].timestamp - b[1].timestamp);

        const labels = sessions.map(([, s]) =>
            new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

        const def      = getDef(exerciseName);
        const tracking = def?.tracking || 'weighted';
        const loadAt   = (s) => loadOf(s, def, bodyweightAt(s.timestamp));
        const anyAdded = sets.some(s => (s.weight || 0) > 0);
        const useE1rm  = tracking === 'weighted' || (tracking === 'bodyweight' && anyAdded);

        let lineData, lineLabel, lineAxis, barData, barLabel, barAxis, prHtml;
        const dated = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        if (tracking === 'banded') {
            lineData  = sessions.map(([, s]) => Math.round(s.sets.reduce((a, x) => a + (x.reps||0), 0) / s.sets.length));
            barData   = sessions.map(([, s]) => s.sets.reduce((a, x) => a + (x.reps||0), 0));
            lineLabel = 'Avg reps'; lineAxis = 'Reps';
            barLabel  = 'Total reps'; barAxis = 'Total reps';
            const prSet = sets.reduce((b, s) => (s.reps||0) > (b.reps||0) ? s : b);
            prHtml = `<span class="pr-set">${prSet.reps} reps · ${prSet.bandLevel||'medium'} band</span>
                      <span class="pr-e1rm">Best set · ${dated(prSet.timestamp)}</span>`;
        } else if (tracking === 'timed') {
            lineData  = sessions.map(([, s]) => Math.max(...s.sets.map(x => x.duration||0)));
            barData   = sessions.map(([, s]) => s.sets.reduce((a, x) => a + (x.duration||0), 0));
            lineLabel = 'Best hold (s)'; lineAxis = 'Seconds';
            barLabel  = 'Total time (s)'; barAxis = 'Total seconds';
            const prSet = sets.reduce((b, s) => (s.duration||0) > (b.duration||0) ? s : b);
            prHtml = `<span class="pr-set">${fmtDuration(prSet.duration)}${prSet.weight ? ` + ${fmtWeight(prSet.weight)}` : ''}</span>
                      <span class="pr-e1rm">Longest hold · ${dated(prSet.timestamp)}</span>`;
        } else if (useE1rm) {
            lineData = sessions.map(([, s]) => {
                const vals = s.sets.map(x => e1rm(loadAt(x), x.reps));
                return Math.round(fromLbs(vals.reduce((a, b) => a + b, 0) / vals.length));
            });
            barData   = sessions.map(([, s]) => Math.round(fromLbs(s.sets.reduce((a, x) => a + loadAt(x) * x.reps, 0))));
            lineLabel = `Avg e1RM (${unitLabel()})`; lineAxis = `e1RM (${unitLabel()})`;
            barLabel  = `Volume (${unitLabel()})`;   barAxis  = `Volume (${unitLabel()})`;
            const prSet = sets.reduce((b, s) => e1rm(loadAt(s), s.reps) > e1rm(loadAt(b), b.reps) ? s : b);
            const prVal = Math.round(e1rm(loadAt(prSet), prSet.reps));
            const bwNote = (tracking === 'bodyweight' && !getBodyweight())
                ? ` <span class="pr-warn">Set your bodyweight in Settings</span>` : '';
            prHtml = `<span class="pr-set">${formatSet(prSet)}</span>
                      <span class="pr-e1rm">e1RM: ${fmtWeight(prVal)} · ${dated(prSet.timestamp)}</span>${bwNote}`;
        } else {
            lineData  = sessions.map(([, s]) => Math.round(s.sets.reduce((a, x) => a + (x.reps||0), 0) / s.sets.length));
            barData   = sessions.map(([, s]) => Math.round(fromLbs(s.sets.reduce((a, x) => a + loadAt(x) * (x.reps||0), 0))));
            lineLabel = 'Avg reps'; lineAxis = 'Reps';
            barLabel  = `Volume (${unitLabel()})`; barAxis = `Volume (${unitLabel()})`;
            const prSet = sets.reduce((b, s) => (s.reps||0) > (b.reps||0) ? s : b);
            const bwNote = !getBodyweight()
                ? ` <span class="pr-warn">Set your bodyweight in Settings for volume</span>` : '';
            prHtml = `<span class="pr-set">${prSet.reps} reps</span>
                      <span class="pr-e1rm">Most reps · ${dated(prSet.timestamp)}</span>${bwNote}`;
        }

        prCard.className = 'pr-card';
        prCard.innerHTML = `<span class="pr-label">PR Set</span>${prHtml}`;

        // Avg rest from previous session (async — appended after chart renders).
        DB.getLastSessionAllSets(exerciseName).then(lastSets => {
            const avgMs = avgIntraRestMs(lastSets, exerciseName);
            if (avgMs !== null) {
                const restSpan = document.createElement('span');
                restSpan.className = 'pr-rest';
                restSpan.textContent = `Avg rest last session: ${fmtDuration(Math.round(avgMs / 1000))}`;
                prCard.appendChild(restSpan);
            }
        });

        const cat    = getCategory(exerciseName);
        const accent = cat === 'push' ? '#ff6b6b' : cat === 'pull' ? '#4dabf7' : cat === 'legs' ? '#69db7c' : '#007bff';

        await ensureChart(); // lazy-load Chart.js on first use
        if (analysisChart) { analysisChart.destroy(); }

        analysisChart = new Chart(canvas, {
            data: {
                labels,
                datasets: [
                    {
                        type: 'line',
                        label: lineLabel,
                        data: lineData,
                        borderColor: accent,
                        backgroundColor: accent + '22',
                        fill: true,
                        tension: 0.35,
                        pointRadius: 4,
                        pointBackgroundColor: accent,
                        yAxisID: 'y',
                        order: 1,
                    },
                    {
                        type: 'bar',
                        label: barLabel,
                        data: barData,
                        backgroundColor: '#ffffff12',
                        borderColor: '#ffffff25',
                        borderWidth: 1,
                        yAxisID: 'y2',
                        order: 2,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#aaa', font: { size: 11 }, boxWidth: 12 } },
                    tooltip: {
                        backgroundColor: '#1e1e1e',
                        titleColor: '#fff',
                        bodyColor: '#aaa',
                        borderColor: '#333',
                        borderWidth: 1,
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#aaa', maxRotation: 45, font: { size: 10 } },
                        grid:  { color: '#2a2a2a' }
                    },
                    y: {
                        position: 'left',
                        title: { display: true, text: lineAxis, color: '#aaa', font: { size: 10 } },
                        ticks: { color: accent, font: { size: 10 } },
                        grid:  { color: '#2a2a2a' }
                    },
                    y2: {
                        position: 'right',
                        title: { display: true, text: barAxis, color: '#aaa', font: { size: 10 } },
                        ticks: { color: '#555', font: { size: 10 } },
                        grid:  { drawOnChartArea: false }
                    }
                }
            }
        });

        // ── Progressive-overload prediction ──────────────────────────────────────
        const prediction = predictNextTarget(sets, tracking, inferIncrement(sets));
        if (prediction) {
            predictCard.className = 'predict-card';
            // Accuracy of this model on the user's own log (only shown with enough history).
            const bt = backtestPrediction(sets, tracking);
            const btBadge = bt
                ? `<span class="predict-acc" title="Reached this target in ${bt.hits} of ${bt.tested} recent sessions">${bt.rate}% likelihood</span>`
                : '';
            predictCard.innerHTML = `
                <div class="predict-head">
                    <span class="predict-label">Next target</span>
                    ${btBadge}
                </div>
                <span class="predict-next">${prediction.nextLabel}</span>
                <span class="predict-sub">from ${prediction.lastLabel} · ${prediction.basis}</span>`;
        } else {
            predictCard.className = 'predict-card hidden';
        }

        // ── Flat set log (newest first) ──────────────────────────────────────────
        // Each row carries a proportional fill bar so the e1RM scale (or the
        // tracking-appropriate metric) is visible at a glance down the list.
        const byNewest = [...sets].sort((a, b) => b.timestamp - a.timestamp);
        const dShort = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const scaleOf = (s) => useE1rm ? e1rm(loadAt(s), s.reps || 0)
                             : tracking === 'timed' ? (s.duration || 0)
                             : (s.reps || 0);
        const maxScale = Math.max(1, ...sets.map(scaleOf));
        const scaleUnit = useE1rm ? 'e1RM' : tracking === 'timed' ? 'best hold' : 'reps';
        setLogEl.innerHTML =
            `<div class="set-log-title">All sets · ${sets.length} <span class="set-log-scale">bar = ${scaleUnit} scale</span></div>` +
            byNewest.map(s => {
                const e1    = useE1rm ? Math.round(e1rm(loadAt(s), s.reps || 0)) : null;
                const notes = (s.notes && s.notes !== 'Imported from CSV') ? s.notes : '';
                const pct   = Math.round(scaleOf(s) / maxScale * 100);
                return `<div class="set-log-row"${cat ? ` data-cat="${cat}"` : ''}>
                    <div class="sl-fill" style="width:${pct}%"></div>
                    <span class="sl-date">${dShort(s.timestamp)}</span>
                    <span class="sl-set">${formatSet(s)}</span>
                    <span class="sl-e1rm">${e1 ? `e1RM ${e1}` : ''}</span>
                    ${notes ? `<span class="sl-notes">${notes}</span>` : ''}
                </div>`;
            }).join('');
    }

    document.getElementById('analysis-exercise')
        .addEventListener('change', e => renderAnalysis(e.target.value));

    // On touch devices a tapped tooltip/point stays stuck because there's no
    // mouseout. Tapping anywhere off the chart canvas clears the active point
    // and tooltip so the info dismisses.
    function dismissChartTooltips() {
        const chart = analysisChart;
        if (!chart) return;
        chart.setActiveElements([]);
        if (chart.tooltip) chart.tooltip.setActiveElements([], { x: 0, y: 0 });
        chart.update();
    }
    document.addEventListener('touchstart', (e) => {
        if (!e.target.closest || !e.target.closest('canvas')) dismissChartTooltips();
    }, { passive: true });
    document.addEventListener('click', (e) => {
        if (!e.target.closest || !e.target.closest('canvas')) dismissChartTooltips();
    });

    // ── MUSCLE MAP ───────────────────────────────────────────────────────────────
    const bodyFront   = document.getElementById('body-front');
    const bodyBack    = document.getElementById('body-back');
    const muscleTip   = document.getElementById('muscle-tooltip');
    let   muscleBuilt = false;
    let   musclePeriod = 30;

    function buildBodySVGs() {
        if (muscleBuilt) return;
        const make = (svg, parts) => {
            svg.innerHTML = parts.map(part => {
                const trainable = MUSCLE_CATEGORY[part.slug] !== undefined;
                const cls  = trainable ? 'muscle-region' : 'muscle-region neutral';
                const attr = trainable ? ` data-muscle="${part.slug}"` : '';
                return part.paths.map(d => `<path class="${cls}"${attr} d="${d}"/>`).join('');
            }).join('');
        };
        make(bodyFront, BODY_SVG.front);
        make(bodyBack,  BODY_SVG.back);

        document.querySelectorAll('#analysis-muscle-mode .muscle-region[data-muscle]').forEach(el => {
            const show = (e) => showMuscleTip(e, el.dataset.muscle);
            el.addEventListener('mouseenter', show);
            el.addEventListener('mousemove',  show);
            el.addEventListener('touchstart', show, { passive: true });
            el.addEventListener('mouseleave', () => muscleTip.classList.add('hidden'));
        });
        document.addEventListener('touchstart', (e) => {
            if (!e.target.closest('.muscle-region')) muscleTip.classList.add('hidden');
        }, { passive: true });
        muscleBuilt = true;
    }

    let muscleStats = {};
    function showMuscleTip(e, slug) {
        const s = muscleStats[slug] || { vol: 0, lbs: 0, sets: 0 };
        const pt = e.touches ? e.touches[0] : e;
        muscleTip.innerHTML =
            `<div class="mt-name">${MUSCLE_LABELS[slug] || slug}</div>` +
            `<div class="mt-stat">${Math.round(fromLbs(s.lbs)).toLocaleString()} ${unitLabel()} · ${s.sets} set${s.sets !== 1 ? 's' : ''}</div>`;
        muscleTip.classList.remove('hidden');
        const x = Math.min(pt.clientX + 12, window.innerWidth - 160);
        const y = Math.max(pt.clientY - 10, 10);
        muscleTip.style.left = x + 'px';
        muscleTip.style.top  = y + 'px';
    }

    async function renderMuscleMap(periodDays) {
        buildBodySVGs();
        const all    = await DB.getAllSets();
        const cutoff = periodDays ? Date.now() - periodDays * 86400000 : 0;
        const sets   = all.filter(s => s.timestamp >= cutoff);

        muscleStats = {};
        sets.forEach(s => {
            const def = getDef(s.exercise);
            const { vol, lbs } = muscleVolume(s, def, bodyweightAt(s.timestamp));
            const weights = getMuscleWeights(s.exercise);
            for (const slug in weights) {
                const m = muscleStats[slug] || (muscleStats[slug] = { vol: 0, lbs: 0, sets: 0 });
                m.vol  += vol * weights[slug];
                m.lbs  += lbs * weights[slug];
                m.sets += 1;
            }
        });

        const maxVol = Math.max(1, ...Object.values(muscleStats).map(m => m.vol));

        document.querySelectorAll('#analysis-muscle-mode .muscle-region[data-muscle]').forEach(el => {
            const slug = el.dataset.muscle;
            const cat  = MUSCLE_CATEGORY[slug];
            const m    = muscleStats[slug];
            if (m && m.vol > 0) {
                el.style.fill = CATEGORY_COLOR[cat];
                el.style.fillOpacity = (0.15 + 0.85 * (m.vol / maxVol)).toFixed(3);
            } else {
                el.style.fill = '';
                el.style.fillOpacity = '1';
            }
        });
    }

    // Mode toggle (Exercise | Muscles)
    const exerciseModeEl = document.getElementById('analysis-exercise-mode');
    const muscleModeEl   = document.getElementById('analysis-muscle-mode');
    let   analysisMode   = 'exercise';
    document.querySelectorAll('#analysis-mode .seg-btn').forEach(btn => {
        const pick = (e) => {
            e.preventDefault();
            analysisMode = btn.dataset.mode;
            document.querySelectorAll('#analysis-mode .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
            exerciseModeEl.classList.toggle('hidden', analysisMode !== 'exercise');
            muscleModeEl.classList.toggle('hidden', analysisMode !== 'muscles');
            if (analysisMode === 'muscles')  renderMuscleMap(musclePeriod);
        };
        btn.addEventListener('click', pick);
    });

    document.querySelectorAll('#muscle-period .chip').forEach(chip => {
        chip.addEventListener('click', () => {
            musclePeriod = parseInt(chip.dataset.days) || 0;
            document.querySelectorAll('#muscle-period .chip').forEach(c => c.classList.toggle('active', c === chip));
            renderMuscleMap(musclePeriod);
        });
    });

    // =============================================
    // 5b. BODYWEIGHT SETTING
    // =============================================
    const bodyweightInput = document.getElementById('bodyweight');

    function initBodyweight() {
        const bw = getBodyweight();
        bodyweightInput.value = bw ? dispWeight(bw) : '';
    }
    initBodyweight();
    bodyweightInput.addEventListener('change', () => {
        const v = toLbs(parseFloat(bodyweightInput.value) || 0); // store canonical lbs
        recordBodyweight(v);
        const sel = document.getElementById('analysis-exercise');
        if (sel.value && !document.getElementById('view-analysis').classList.contains('hidden'))
            renderAnalysis(sel.value);
    });

    // =============================================
    // 5b-ii. WEIGHT UNIT (lbs / kg)
    // =============================================
    // Switching units only changes display + how inputs are read — stored data is
    // canonical lbs, so every view just re-renders. Reuses refreshSetViews (which
    // refreshes Today, marks History dirty + rebuilds it if open) and re-renders
    // Analysis when visible.
    const unitToggle = document.getElementById('unit-toggle');
    const bwUnitLabel = document.getElementById('bw-unit-label');

    function reflectUnitToggle() {
        unitToggle.querySelectorAll('.seg-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.unit === getUnit()));
    }

    // Apply the current unit across the always-visible chrome (labels) + data views.
    function refreshUnitUI(prevUnit) {
        weightLabel.textContent = `${currentTracking === 'weighted' ? 'Weight' : 'Added weight'} (${unitLabel()})`;
        if (bwUnitLabel) bwUnitLabel.textContent = unitLabel();
        initBodyweight();
        // Re-interpret any value already typed in the log weight field.
        if (prevUnit && prevUnit !== getUnit() && weightInput.value !== '') {
            const asLbs = prevUnit === 'kg' ? (parseFloat(weightInput.value) || 0) * LB_PER_KG : (parseFloat(weightInput.value) || 0);
            weightInput.value = getUnit() === 'kg' ? Math.round(asLbs / LB_PER_KG * 100) / 100 : Math.round(asLbs * 100) / 100;
        }
        refreshSetViews();
        const sel = document.getElementById('analysis-exercise');
        if (sel && sel.value && !document.getElementById('view-analysis').classList.contains('hidden'))
            renderAnalysis(sel.value);
    }

    reflectUnitToggle();
    refreshUnitUI(); // set initial labels for the chosen unit on load
    unitToggle.querySelectorAll('.seg-btn').forEach(btn => {
        const pick = (e) => {
            e.preventDefault();
            const prev = getUnit();
            if (btn.dataset.unit === prev) return;
            localStorage.setItem('weight_unit', btn.dataset.unit);
            reflectUnitToggle();
            refreshUnitUI(prev);
        };
        btn.addEventListener('touchend', pick);
        btn.addEventListener('click', pick);
    });

    // =============================================
    // 5b-iii. FIRST-RUN ONBOARDING
    // =============================================
    (function onboarding() {
        if (localStorage.getItem('onboarded')) return;
        const modal   = document.getElementById('onboard-modal');
        const unitSeg = document.getElementById('onboard-unit');
        const bwIn    = document.getElementById('onboard-bw');
        if (!modal) return;
        let chosenUnit = 'lbs';
        unitSeg.querySelectorAll('.seg-btn').forEach(btn => {
            const pick = (e) => {
                e.preventDefault();
                chosenUnit = btn.dataset.unit;
                unitSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
                bwIn.placeholder = chosenUnit === 'kg' ? 'e.g. 80' : 'e.g. 175';
            };
            btn.addEventListener('touchend', pick);
            btn.addEventListener('click', pick);
        });
        modal.classList.remove('hidden');
        document.getElementById('onboard-done').addEventListener('click', () => {
            localStorage.setItem('weight_unit', chosenUnit);
            const v = parseFloat(bwIn.value);
            if (v > 0) recordBodyweight(chosenUnit === 'kg' ? v * LB_PER_KG : v);
            localStorage.setItem('onboarded', 'true');
            modal.classList.add('hidden');
            reflectUnitToggle();
            refreshUnitUI('lbs');
        });
    })();

    // =============================================
    // 5c. ADD / EDIT EXERCISE MODAL
    // =============================================
    const exModal     = document.getElementById('exercise-modal');
    const exNameInput = document.getElementById('ex-name');
    const exCategory  = document.getElementById('ex-category');
    const exEquipment = document.getElementById('ex-equipment');
    const exPattern   = document.getElementById('ex-pattern');
    const exTracking  = document.getElementById('ex-tracking');
    const exBwGroup   = document.getElementById('ex-bwfraction-group');
    const exBwInput   = document.getElementById('ex-bwfraction');
    let   exEditingOriginalName = null;

    function fillSelect(sel, values) {
        sel.innerHTML = '';
        values.forEach(v => {
            const o = document.createElement('option');
            o.value = v; o.textContent = v;
            sel.appendChild(o);
        });
    }
    fillSelect(exEquipment, EQUIPMENT_TYPES);
    fillSelect(exPattern,   MOVEMENT_PATTERNS);
    fillSelect(exTracking,  TRACKING_TYPES);

    exTracking.addEventListener('change', () => {
        exBwGroup.classList.toggle('hidden', exTracking.value !== 'bodyweight');
    });

    function openExerciseModal(def, nameSeed = '') {
        exEditingOriginalName = def ? def.name : null;
        document.getElementById('exercise-modal-title').textContent = def ? 'Edit Exercise' : 'New Exercise';
        exNameInput.value  = def ? def.name : nameSeed;
        exCategory.value   = def?.category  || 'push';
        exEquipment.value  = def?.equipment || 'barbell';
        exPattern.value    = def?.pattern   || 'other';
        exTracking.value   = def?.tracking  || 'weighted';
        exBwInput.value    = def?.bwFraction ?? 0.70;
        exBwGroup.classList.toggle('hidden', exTracking.value !== 'bodyweight');
        exModal.classList.remove('hidden');
    }
    function closeExerciseModal() { exModal.classList.add('hidden'); }

    document.getElementById('ex-cancel').addEventListener('click', closeExerciseModal);
    exModal.addEventListener('click', (e) => { if (e.target === exModal) closeExerciseModal(); });
    document.getElementById('btn-add-exercise').addEventListener('click', () => openExerciseModal(null));

    document.getElementById('ex-save').addEventListener('click', async () => {
        const name = exNameInput.value.trim();
        if (!name) { alert('Please enter a name.'); return; }

        const def = {
            name,
            category:  exCategory.value,
            equipment: exEquipment.value,
            pattern:   exPattern.value,
            tracking:  exTracking.value,
        };
        if (def.tracking === 'bodyweight') def.bwFraction = parseFloat(exBwInput.value) || 1;

        if (exEditingOriginalName && exEditingOriginalName !== name)
            await DB.deleteExercise(exEditingOriginalName);

        await DB.upsertExercise(def);
        await loadExerciseDefs();
        await refreshExerciseCache();
        closeExerciseModal();
        renderManageList();

        if (!exEditingOriginalName || exEditingOriginalName === name) {
            const item = allExercises.find(e => e.name === name) || { name, def };
            if (document.getElementById('view-log').classList.contains('active') ||
                !document.getElementById('view-log').classList.contains('hidden')) {
                selectExercise(item);
            }
        }
    });

    async function renderManageList() {
        const list = document.getElementById('exercise-manage-list');
        const defs = await DB.getAllExercises();
        list.innerHTML = '';
        defs.forEach(def => {
            const item = document.createElement('div');
            item.className = 'exercise-manage-item';
            const bw = def.tracking === 'bodyweight' ? ` · ${def.bwFraction ?? 1}×BW` : '';
            item.innerHTML = `
                <div>
                    <div>${def.name}</div>
                    <div class="ex-meta">${def.category} · ${def.equipment} · ${def.tracking}${bw}</div>
                </div>
                <div class="ex-actions">
                    <button class="ex-edit">Edit</button>
                    <button class="ex-del">Delete</button>
                </div>`;
            item.querySelector('.ex-edit').addEventListener('click', () => openExerciseModal(def));
            item.querySelector('.ex-del').addEventListener('click', async () => {
                if (confirm(`Delete the "${def.name}" exercise definition? (Logged sets are kept.)`)) {
                    await DB.deleteExercise(def.name);
                    await loadExerciseDefs();
                    renderManageList();
                }
            });
            list.appendChild(item);
        });
    }

    // =============================================
    // 6. NAVIGATION
    // =============================================
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            closeDropdown();
            navBtns.forEach(b => b.classList.remove('active'));
            views.forEach(v => v.classList.add('hidden'));

            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.remove('hidden');

            // Defer the heavy per-view DOM build to the next frame so the view swap
            // and nav-pill animation paint first — otherwise the synchronous build
            // (history heatmap + every session card, etc.) janks the transition.
            const afterPaint = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

            // History is pre-built and stays cached until a set changes, so the
            // normal open does no work and the pill animates like the other tabs.
            if (btn.dataset.target === 'view-history' && historyDirty) afterPaint(loadHistory);
            if (btn.dataset.target === 'view-analysis') {
                afterPaint(() => {
                    loadAnalysis();
                    if (analysisMode === 'muscles')  renderMuscleMap(musclePeriod);
                });
            }
            if (btn.dataset.target === 'view-backup') afterPaint(renderManageList);
        });
    });
});
