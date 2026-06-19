// Global helper for stepper buttons
window.step = (id, amount) => {
    const el = document.getElementById(id);
    const currentVal = parseFloat(el.value) || 0;
    const newVal = currentVal + amount;
    const clampZero = id === 'reps' || id === 'duration' || id === 'set-reps' || id === 'set-duration';
    el.value = clampZero ? Math.max(0, newVal) : newVal;
};

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
            return `${fmtDuration(set.duration)}${set.weight ? ` + ${set.weight} lbs` : ''}`;
        case 'banded':
            return `${set.reps} reps · ${set.bandLevel || 'medium'} band`;
        case 'bodyweight':
            return `${set.reps} reps${set.weight ? ` + ${set.weight} lbs` : ''}`;
        default:
            return `${set.weight} lbs × ${set.reps} reps`;
    }
}

function formatSetShort(set) {
    switch (trackingOf(set)) {
        case 'timed':
            return fmtDuration(set.duration);
        case 'banded':
            return `${set.reps} (${(set.bandLevel || 'med').slice(0,3)})`;
        case 'bodyweight':
            return `${set.reps}${set.weight ? `+${set.weight}` : ''}`;
        default:
            return `${set.weight}lb × ${set.reps}`;
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
    const notesInput     = document.getElementById('notes');

    const groupWeight    = document.getElementById('group-weight');
    const groupReps      = document.getElementById('group-reps');
    const groupDuration  = document.getElementById('group-duration');
    const groupBand      = document.getElementById('group-band');
    const weightLabel    = document.getElementById('weight-label');
    const bandSegmented  = document.getElementById('band-segmented');

    // --- STATE ---
    let allExercises    = []; // [{ name, lastWeight, lastReps, def }]
    let currentTracking = 'weighted';

    // --- INITIALIZATION ---
    DB.seedExercises()
        .then(loadExerciseDefs)
        .then(autoImportCSV)
        .then(refreshExerciseCache);
    loadTodaySets();

    async function loadExerciseDefs() {
        const defs = await DB.getAllExercises();
        if (defs.length) {
            EXERCISE_DEFS = Object.fromEntries(defs.map(d => [d.name, d]));
        }
    }

    // ── Rest Timer ───────────────────────────────────────────────────────────
    const restTimer    = document.getElementById('rest-timer');
    const timerDisplay = restTimer.querySelector('.timer-display');
    let   timerInterval = null;
    const MAX_REST_MS   = 6 * 60 * 1000;
    const WARN_MS       = 4 * 60 * 1000;

    function startTimer(fromTimestamp) {
        clearInterval(timerInterval);
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
            restTimer.classList.toggle('warn', elapsed >= WARN_MS);
            restTimer.classList.remove('hidden');
        }
        tick();
        timerInterval = setInterval(tick, 1000);
    }

    async function initTimer() {
        const sets = await DB.getTodaySets();
        if (sets.length && (Date.now() - sets[0].timestamp) < MAX_REST_MS)
            startTimer(sets[0].timestamp);
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
            const empty = document.createElement('div');
            empty.className = 'autocomplete-empty';
            empty.textContent = q ? 'No matches — add it in Settings → Exercises' : 'No exercises yet — add one in Settings';
            dropdown.appendChild(empty);
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

                el.addEventListener('touchstart', () => {
                    el.classList.add('is-pressing');
                }, { passive: true });

                el.addEventListener('touchend', (e) => {
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
        if (item.lastWeight !== null) weightInput.value = item.lastWeight;
        if (item.lastReps   !== null) repsInput.value   = item.lastReps;
        closeDropdown();
        notesInput.focus();
    }

    function applyTracking(def) {
        currentTracking = def?.tracking || 'weighted';
        const isWeighted = currentTracking === 'weighted';
        const isBanded   = currentTracking === 'banded';
        const isTimed    = currentTracking === 'timed';

        groupWeight.classList.toggle('hidden', isBanded);
        weightLabel.textContent = isWeighted ? 'Weight (lbs)' : 'Added weight (lbs)';
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
        };
        btn.addEventListener('touchend', pick);
        btn.addEventListener('click', pick);
    });

    exerciseInput.addEventListener('focus', () => {
        exerciseInput.value = '';
        renderDropdown('');
    });

    exerciseInput.addEventListener('input', () => {
        renderDropdown(exerciseInput.value);
    });

    document.addEventListener('touchstart', (e) => {
        if (!exerciseAnchor.contains(e.target)) closeDropdown();
    }, { passive: true });

    exerciseInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDropdown();
    });

    // =============================================
    // 3. DATA IMPORT (one-time from codebase)
    // =============================================
    async function autoImportCSV() {
        if (localStorage.getItem('sample_data_imported')) return;
        try {
            const response = await fetch('./data.csv');
            if (!response.ok) return;
            const csvText = await response.text();
            const lines = csvText.split('\n');
            const currentYear = new Date().getFullYear();
            const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const cols     = line.split(',');
                const timeStr  = cols[0]?.trim();
                const exercise = cols[1]?.trim();
                const reps     = parseInt(cols[2]);
                const weight   = parseFloat(cols[3]);
                if (!timeStr || !exercise) continue;

                const [datePart, timePart = '00:00'] = timeStr.split(' ');
                const [monthStr, dayStr]  = datePart.split('-');
                const [hours, minutes]    = timePart.split(':').map(Number);
                const monthIdx = MONTHS[monthStr.toLowerCase().slice(0, 3)];
                const day      = parseInt(dayStr);

                if (monthIdx === undefined || isNaN(day)) continue;

                const timestamp = new Date(currentYear, monthIdx, day, hours, minutes).getTime();

                await DB.importSet({
                    exercise,
                    reps:   isNaN(reps)   ? 0 : reps,
                    weight: isNaN(weight) ? 0 : weight,
                    notes:  'Imported from CSV',
                    timestamp,
                });
            }
            localStorage.setItem('sample_data_imported', 'true');
            await refreshExerciseCache();
            loadTodaySets();
        } catch (err) {
            console.error('Auto-import failed:', err);
        }
    }

    // =============================================
    // 4. FORM SUBMISSION
    // =============================================
    logForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        closeDropdown();

        // Require reps for all non-timed tracking; require duration for timed.
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

        const set = {
            exercise: exerciseInput.value.trim(),
            weight:   parseFloat(weightInput.value) || 0,
            reps:     parseInt(repsInput.value)     || 0,
            notes:    notesInput.value.trim(),
        };
        if (currentTracking === 'timed')  set.duration  = parseInt(durationInput.value) || 0;
        if (currentTracking === 'banded') set.bandLevel = currentBand;

        await DB.addSet(set);
        startTimer(Date.now());

        notesInput.value = '';

        await refreshExerciseCache();

        const btn = logForm.querySelector('.btn-primary');
        const originalText = btn.textContent;
        btn.textContent = 'Saved!';
        btn.style.backgroundColor = '#28a745';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.backgroundColor = '';
        }, 800);

        loadTodaySets();
    });

    // =============================================
    // 5. UI RENDERING
    // =============================================
    async function loadTodaySets() {
        const sets = await DB.getTodaySets();
        const list = document.getElementById('today-list');
        list.innerHTML = '';
        sets.forEach(set => list.appendChild(createSetElement(set)));
    }

    async function loadHistory() {
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
            { v: fmtVol(totalVolume), l: 'Total lbs'   },
        ].map(s => `<div class="stat-card"><div class="stat-value">${s.v}</div><div class="stat-label">${s.l}</div></div>`).join('');
        container.appendChild(statsRow);

        // ── Per-day metadata ─────────────────────────────────────────────────────
        const dayMap = {}; // dateKey → sets[] (used for GTG inference + category mix)
        sets.forEach(s => { (dayMap[dayKey(s.timestamp)] ||= []).push(s); });

        // ── Heatmap ──────────────────────────────────────────────────────────────
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const start = new Date(today); start.setDate(start.getDate() - 83);
        start.setDate(start.getDate() - start.getDay()); // back up to Sunday
        const weeks = Math.ceil((Math.round((today - start) / 86400000) + 1) / 7);

        const heatWrap = document.createElement('div');
        heatWrap.className = 'heat-wrap';

        const monthRow = document.createElement('div');
        monthRow.className = 'heat-months';
        let lastMonth = -1;
        for (let w = 0; w < weeks; w++) {
            const d = new Date(start); d.setDate(d.getDate() + w * 7);
            const lbl = document.createElement('span');
            if (d.getMonth() !== lastMonth) {
                lbl.textContent = d.toLocaleDateString('en-US', { month: 'short' });
                lastMonth = d.getMonth();
            }
            monthRow.appendChild(lbl);
        }

        const heatmap = document.createElement('div');
        heatmap.className = 'heatmap';
        for (let i = 0; i < weeks * 7; i++) {
            const d = new Date(start); d.setDate(d.getDate() + i);
            const cell = document.createElement('div');
            cell.className = 'heat-cell';
            if (d > today) { cell.classList.add('heat-future'); heatmap.appendChild(cell); continue; }
            if (d.getTime() === today.getTime()) cell.classList.add('heat-today');

            const dateKey  = d.toLocaleDateString();
            const daySets  = dayMap[dateKey];
            if (daySets) {
                const profile = dayCategoryProfile(daySets);
                if (isGtgDay(daySets)) {
                    // Sparse / greasing the groove: don't "fill" the square — just mark
                    // it with a dot tinted by the day's dominant category.
                    cell.classList.add('heat-gtg');
                    cell.style.setProperty('--gtg-dot', CAT_COLOR[profile.dominant] || 'rgba(255,255,255,0.9)');
                } else if (profile.mixed) {
                    const grad = proportionalGradient(profile.counts);
                    if (grad) cell.style.background = grad;
                    else cell.classList.add('heat-mixed');
                } else if (profile.dominant) {
                    cell.classList.add(`heat-${profile.dominant}`);
                }

                cell.addEventListener('click', () => {
                    const isSame = activeDateFilter === dateKey;
                    activeDateFilter = isSame ? null : dateKey;
                    heatmap.querySelectorAll('.heat-cell').forEach(c => c.classList.remove('selected'));
                    if (!isSame) cell.classList.add('selected');
                    renderSessions();
                });
            }
            heatmap.appendChild(cell);
        }
        heatWrap.appendChild(monthRow);
        heatWrap.appendChild(heatmap);
        container.appendChild(heatWrap);

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
                const vol     = Math.round(day.sets.reduce((a, s) => a + setVolume(s), 0)).toLocaleString();
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
                            <div class="session-summary">${exNames.length} exercise${exNames.length !== 1 ? 's' : ''} · ${setsAsc.length} set${setsAsc.length !== 1 ? 's' : ''} · ${vol} lbs</div>
                        </div>
                        <span class="session-toggle">⌄</span>
                    </div>
                    <div class="session-body"></div>`;

                const body = card.querySelector('.session-body');
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

                card.querySelector('.session-header').addEventListener('click', () => card.classList.toggle('open'));
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
        if (!document.getElementById('view-history').classList.contains('hidden')) loadHistory();
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
        setWeightLabel.textContent = isWeighted ? 'Weight (lbs)' : 'Added weight (lbs)';

        setWeightInput.value = set.weight  ?? 0;
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
            weight: parseFloat(setWeightInput.value) || 0,
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
        const prCard = document.getElementById('analysis-pr');
        const canvas = document.getElementById('analysis-chart');
        if (!exerciseName) {
            prCard.className = 'pr-card hidden';
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
            prHtml = `<span class="pr-set">${fmtDuration(prSet.duration)}${prSet.weight ? ` + ${prSet.weight} lbs` : ''}</span>
                      <span class="pr-e1rm">Longest hold · ${dated(prSet.timestamp)}</span>`;
        } else if (useE1rm) {
            lineData = sessions.map(([, s]) => {
                const vals = s.sets.map(x => e1rm(loadAt(x), x.reps));
                return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
            });
            barData   = sessions.map(([, s]) => Math.round(s.sets.reduce((a, x) => a + loadAt(x) * x.reps, 0)));
            lineLabel = 'Avg e1RM (lbs)'; lineAxis = 'e1RM (lbs)';
            barLabel  = 'Volume (lbs)';   barAxis  = 'Volume (lbs)';
            const prSet = sets.reduce((b, s) => e1rm(loadAt(s), s.reps) > e1rm(loadAt(b), b.reps) ? s : b);
            const prVal = Math.round(e1rm(loadAt(prSet), prSet.reps));
            const bwNote = (tracking === 'bodyweight' && !getBodyweight())
                ? ` <span class="pr-e1rm">⚠️ set your bodyweight in Settings</span>` : '';
            prHtml = `<span class="pr-set">${formatSet(prSet)}</span>
                      <span class="pr-e1rm">e1RM: ${prVal} lbs · ${dated(prSet.timestamp)}</span>${bwNote}`;
        } else {
            lineData  = sessions.map(([, s]) => Math.round(s.sets.reduce((a, x) => a + (x.reps||0), 0) / s.sets.length));
            barData   = sessions.map(([, s]) => Math.round(s.sets.reduce((a, x) => a + loadAt(x) * (x.reps||0), 0)));
            lineLabel = 'Avg reps'; lineAxis = 'Reps';
            barLabel  = 'Volume (lbs)'; barAxis = 'Volume (lbs)';
            const prSet = sets.reduce((b, s) => (s.reps||0) > (b.reps||0) ? s : b);
            const bwNote = !getBodyweight()
                ? ` <span class="pr-e1rm">⚠️ set your bodyweight in Settings for volume</span>` : '';
            prHtml = `<span class="pr-set">${prSet.reps} reps</span>
                      <span class="pr-e1rm">Most reps · ${dated(prSet.timestamp)}</span>${bwNote}`;
        }

        prCard.className = 'pr-card';
        prCard.innerHTML = `<span class="pr-label">🏆 PR Set</span>${prHtml}`;

        const cat    = getCategory(exerciseName);
        const accent = cat === 'push' ? '#ff6b6b' : cat === 'pull' ? '#4dabf7' : cat === 'legs' ? '#69db7c' : '#007bff';

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
    }

    document.getElementById('analysis-exercise')
        .addEventListener('change', e => renderAnalysis(e.target.value));

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
            `<div class="mt-stat">${Math.round(s.lbs).toLocaleString()} lbs · ${s.sets} set${s.sets !== 1 ? 's' : ''}</div>`;
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
            const muscles = analysisMode === 'muscles';
            exerciseModeEl.classList.toggle('hidden', muscles);
            muscleModeEl.classList.toggle('hidden', !muscles);
            if (muscles) renderMuscleMap(musclePeriod);
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
        if (bw) bodyweightInput.value = bw;
    }
    initBodyweight();
    bodyweightInput.addEventListener('change', () => {
        const v = parseFloat(bodyweightInput.value) || 0;
        recordBodyweight(v);
        const sel = document.getElementById('analysis-exercise');
        if (sel.value && !document.getElementById('view-analysis').classList.contains('hidden'))
            renderAnalysis(sel.value);
    });

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

            if (btn.dataset.target === 'view-history') loadHistory();
            if (btn.dataset.target === 'view-analysis') {
                loadAnalysis();
                if (analysisMode === 'muscles') renderMuscleMap(musclePeriod);
            }
            if (btn.dataset.target === 'view-backup') renderManageList();
        });
    });
});
