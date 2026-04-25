// Global helper for stepper buttons
window.step = (id, amount) => {
    const el = document.getElementById(id);
    const currentVal = parseFloat(el.value) || 0;
    const newVal = currentVal + amount;
    el.value = (id === 'reps') ? Math.max(0, newVal) : newVal;
};

document.addEventListener('DOMContentLoaded', () => {

    // --- ELEMENTS ---
    const navBtns       = document.querySelectorAll('.nav-btn');
    const views         = document.querySelectorAll('.view');
    const logForm       = document.getElementById('log-form');
    const exerciseInput = document.getElementById('exercise');
    const exerciseAnchor= document.getElementById('exercise-anchor');
    const dropdown      = document.getElementById('autocomplete-dropdown');
    const weightInput   = document.getElementById('weight');
    const repsInput     = document.getElementById('reps');
    const notesInput    = document.getElementById('notes');

    // --- STATE ---
    // In-memory cache so every keystroke doesn't hit IndexedDB
    let allExercises = []; // [{ name: string, lastWeight: number, lastReps: number }]

    // --- INITIALIZATION ---
    autoImportCSV();
    refreshExerciseCache().then(() => {
        // Pre-warm: show full list as soon as the field is first focused
    });
    loadTodaySets();

    // ── Rest Timer ───────────────────────────────────────────────────────────────
    const restTimer   = document.getElementById('rest-timer');
    const timerDisplay = restTimer.querySelector('.timer-display');
    let   timerInterval = null;
    const MAX_REST_MS   = 6 * 60 * 1000; // 6 minutes
    const WARN_MS       = 4 * 60 * 1000; // go red at 4 min

    function startTimer(fromTimestamp) {
        clearInterval(timerInterval);
        function tick() {
            const elapsed = Date.now() - fromTimestamp; // always wall-clock, survives sleep
            if (elapsed >= MAX_REST_MS) {
                restTimer.classList.add('hidden');
                clearInterval(timerInterval);
                return;
            }
            const secs  = Math.floor(elapsed / 1000);
            const m     = String(Math.floor(secs / 60)).padStart(2, '0');
            const s     = String(secs % 60).padStart(2, '0');
            timerDisplay.textContent = `${m}:${s}`;
            restTimer.classList.toggle('warn', elapsed >= WARN_MS);
            restTimer.classList.remove('hidden');
        }
        tick();
        timerInterval = setInterval(tick, 1000);
    }

    // On load: resume timer if last set was within the window
    async function initTimer() {
        const sets = await DB.getTodaySets(); // newest-first
        if (sets.length && (Date.now() - sets[0].timestamp) < MAX_REST_MS)
            startTimer(sets[0].timestamp);
    }
    initTimer();
    // ─────────────────────────────────────────────────────────────────────────────

    // =============================================
    // 1. EXERCISE CACHE  (rebuilt after each save)
    // =============================================
    async function refreshExerciseCache() {
        const names = await DB.getUniqueExercises(); // already sorted A→Z
        // Fetch last set for each exercise in parallel
        allExercises = await Promise.all(
            names.map(async name => {
                const last = await DB.getLastSetForExercise(name);
                return {
                    name,
                    lastWeight: last ? last.weight : null,
                    lastReps:   last ? last.reps   : null,
                };
            })
        );
    }

    // =============================================
    // 2. AUTOCOMPLETE DROPDOWN
    // =============================================

    // Build a highlighted name span: wraps the matched substring in <mark>
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

        // Filter: substring match (case-insensitive)
        const matches = q
            ? allExercises.filter(e =>
                e.name.toLowerCase().includes(q.toLowerCase()))
            : allExercises; // empty query → show all (on focus)

        dropdown.innerHTML = '';

        if (matches.length === 0) {
            dropdown.innerHTML = '<div class="autocomplete-empty">No matches — type to add new</div>';
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

                // Use touchstart for instant response on iOS (no 300ms delay)
                el.addEventListener('touchstart', () => {
                    el.classList.add('is-pressing');
                }, { passive: true });

                el.addEventListener('touchend', (e) => {
                    e.preventDefault(); // prevent ghost click
                    selectExercise(item);
                });

                // Fallback for non-touch (dev/desktop)
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // keep focus on input
                    selectExercise(item);
                });

                dropdown.appendChild(el);
            });
        }

        openDropdown();
    }

    function openDropdown() {
        exerciseAnchor.classList.add('is-open');
    }

    function closeDropdown() {
        exerciseAnchor.classList.remove('is-open');
        // Clean up press states
        dropdown.querySelectorAll('.is-pressing').forEach(el =>
            el.classList.remove('is-pressing'));
    }

    function selectExercise(item) {
        exerciseInput.value = item.name;

        // Auto-fill weight & reps from the last time this exercise was logged
        if (item.lastWeight !== null) weightInput.value = item.lastWeight;
        if (item.lastReps   !== null) repsInput.value   = item.lastReps;

        closeDropdown();

        // Move focus to notes so the keyboard doesn't re-open on weight/reps
        // (user just got their values pre-filled — they can adjust with steppers)
        notesInput.focus();
    }

    // Open on focus (show full list)
    exerciseInput.addEventListener('focus', () => {
        renderDropdown(exerciseInput.value);
    });

    // Filter as user types
    exerciseInput.addEventListener('input', () => {
        renderDropdown(exerciseInput.value);
    });

    // Close when user taps outside the anchor
    document.addEventListener('touchstart', (e) => {
        if (!exerciseAnchor.contains(e.target)) {
            closeDropdown();
        }
    }, { passive: true });

    // Keyboard: close on Escape
    exerciseInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDropdown();
    });

    // =============================================
    // 3. DATA IMPORT (One-time from codebase)
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
                const timeStr  = cols[0]?.trim();   // "Feb-08 13:53"
                const exercise = cols[1]?.trim();
                const reps     = parseInt(cols[2]);
                const weight   = parseFloat(cols[3]);
                if (!timeStr || !exercise) continue;
    
                // Split "Feb-08 13:53" into date and time parts
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

        const set = {
            exercise: exerciseInput.value.trim(),
            weight:   parseFloat(weightInput.value) || 0,
            reps:     parseInt(repsInput.value)     || 0,
            notes:    notesInput.value.trim()
        };

        await DB.addSet(set);
        startTimer(Date.now()); // ← must be inside DOMContentLoaded, after addSet

        // Only clear notes; keep exercise/weight/reps for quick re-logging
        notesInput.value = '';

        // Rebuild cache so the new exercise (if novel) appears immediately
        await refreshExerciseCache();

        // Success feedback
        const btn = logForm.querySelector('.btn-primary');
        const originalText = btn.textContent;
        btn.textContent = "Saved!";
        btn.style.backgroundColor = "#28a745";
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.backgroundColor = "";
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
    
        // ── Build per-day metadata ───────────────────────────────────────────────
        // keyed by toLocaleDateString() to match the days[] structure below
        const dayMeta = {}; // { dateKey: { exercises: Set } }
        sets.forEach(s => {
            const k = new Date(s.timestamp).toLocaleDateString();
            if (!dayMeta[k]) dayMeta[k] = { exercises: new Set() };
            dayMeta[k].exercises.add(s.exercise);
        });
    
        // ── Heatmap (last 84 days) ───────────────────────────────────────────────
        let activeDateFilter = null;
        const heatmap = document.createElement('div');
        heatmap.className = 'heatmap';
    
        for (let i = 83; i >= 0; i--) {
            const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-i);
            const dateKey = d.toLocaleDateString();
            const meta    = dayMeta[dateKey];
            const cell    = document.createElement('div');
    
            if (meta) {
                const cat = sessionCategory([...meta.exercises]);
                cell.className = `heat-cell heat-${cat||'mixed'}`;
                cell.addEventListener('click', () => {
                    const isSame = activeDateFilter === dateKey;
                    activeDateFilter = isSame ? null : dateKey;
                    heatmap.querySelectorAll('.heat-cell').forEach(c => c.classList.remove('selected'));
                    if (!isSame) cell.classList.add('selected');
                    renderSessions();
                });
            } else {
                cell.className = 'heat-cell'; // rest day — no interaction
            }
            heatmap.appendChild(cell);
        }
        container.appendChild(heatmap);
    
        // ── Filter chips ─────────────────────────────────────────────────────────
        const exercises = [...new Set(sets.map(s => s.exercise))].sort();
        let activeFilter = null;
        const chipsRow = document.createElement('div');
        chipsRow.className = 'filter-chips';
        ['All', ...exercises].forEach(ex => {
            const chip = document.createElement('div');
            chip.className = 'chip' + (ex==='All'?' active':'');
            chip.textContent = ex;
            chip.addEventListener('click', () => {
                activeFilter = ex==='All' ? null : ex;
                chipsRow.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c===chip));
                renderSessions();
            });
            chipsRow.appendChild(chip);
        });
        container.appendChild(chipsRow);
    
        // ── Group sets into day buckets ──────────────────────────────────────────
        const days = [];
        sets.forEach(s => {
            const key = new Date(s.timestamp).toLocaleDateString();
            if (!days.length || days[days.length-1].key !== key) days.push({key, sets:[]});
            days[days.length-1].sets.push(s);
        });
    
        // ── Per-exercise history for progress arrows ─────────────────────────────
        const exerciseDays = {};
        [...sets].reverse().forEach(s => {
            const date = new Date(s.timestamp).toLocaleDateString();
            if (!exerciseDays[s.exercise]) exerciseDays[s.exercise] = [];
            const arr = exerciseDays[s.exercise];
            if (!arr.length || arr[arr.length-1].date !== date)
                arr.push({date, maxW:s.weight, maxR:s.reps});
            else {
                const last = arr[arr.length-1];
                if (s.weight>last.maxW||(s.weight===last.maxW&&s.reps>last.maxR)){last.maxW=s.weight;last.maxR=s.reps;}
            }
        });
    
        function progressIcon(ex, date) {
            const arr = exerciseDays[ex]; if (!arr) return '';
            const i = arr.findIndex(h => h.date===date);
            if (i<=0) return '';
            const [cur,prev] = [arr[i],arr[i-1]];
            if (cur.maxW>prev.maxW||(cur.maxW===prev.maxW&&cur.maxR>prev.maxR)) return ' <span class="pill-up">↑</span>';
            if (cur.maxW<prev.maxW||(cur.maxW===prev.maxW&&cur.maxR<prev.maxR)) return ' <span class="pill-down">↓</span>';
            return '';
        }
    
        // ── Sessions ─────────────────────────────────────────────────────────────
        const sessionsDiv = document.createElement('div');
        container.appendChild(sessionsDiv);
    
        function renderSessions() {
            sessionsDiv.innerHTML = '';
            let visible = activeDateFilter
                ? days.filter(d => d.key === activeDateFilter)
                : days;
            if (activeFilter)
                visible = visible.map(d => ({...d, sets:d.sets.filter(s => s.exercise===activeFilter)})).filter(d => d.sets.length);
    
            visible.forEach((day, i) => {
                const byEx = {};
                day.sets.forEach(s => { (byEx[s.exercise]||(byEx[s.exercise]=[])).push(s); });
                const exNames = Object.keys(byEx);
                const vol = Math.round(day.sets.reduce((a,s) => a+s.weight*s.reps, 0)).toLocaleString();
                const label = new Date(day.sets[0].timestamp).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
                const sessionCat = sessionCategory(exNames);
    
                const card = document.createElement('div');
                card.className = 'session-card' + (i===0?' open':'');
                if (sessionCat) card.dataset.cat = sessionCat;
                card.innerHTML = `
                    <div class="session-header">
                        <div><div style="font-weight:600">${label}</div>
                        <div class="session-summary">${exNames.length} exercise${exNames.length!==1?'s':''} · ${vol} lbs</div></div>
                        <span class="session-toggle">⌄</span>
                    </div>
                    <div class="session-body"></div>`;
    
                const body = card.querySelector('.session-body');
                exNames.forEach(ex => {
                    const exCat = getCategory(ex);
                    const pills = byEx[ex].map(s =>
                        `<span class="set-pill"${exCat?` data-cat="${exCat}"`:''}>${s.weight}lb × ${s.reps}</span>`
                    ).join('');
                    const g = document.createElement('div');
                    g.className = 'exercise-group';
                    g.innerHTML = `<div class="exercise-name${exCat?` cat-${exCat}`:''}">
                        ${ex}${progressIcon(ex, day.key)}
                    </div><div class="set-pills">${pills}</div>`;
                    body.appendChild(g);
                });
    
                card.querySelector('.session-header').addEventListener('click', () => card.classList.toggle('open'));
                sessionsDiv.appendChild(card);
            });
    
            if (!visible.length)
                sessionsDiv.innerHTML = '<p style="padding:20px;color:var(--text-secondary)">No sessions for this day.</p>';
        }
    
        renderSessions();
    }

    function createSetElement(set) {
        const li = document.createElement('li');
        li.className = 'set-item';
        const time = new Date(set.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        li.innerHTML = `
            <div class="set-details">
                <h3>${set.exercise}</h3>
                <p>${set.weight} lbs × ${set.reps} reps ${set.notes ? `| ${set.notes}` : ''}</p>
            </div>
            <div class="set-time">${time}</div>
        `;

        li.addEventListener('click', async () => {
            if (confirm(`Delete this ${set.exercise} set?`)) {
                await DB.deleteSet(set.id);
                loadTodaySets();
                if (!document.getElementById('view-history').classList.contains('hidden')) {
                    loadHistory();
                }
            }
        });
        return li;
    }
        // ── ANALYSIS TAB ─────────────────────────────────────────────────────────────
    let analysisChart = null;

    function e1rm(weight, reps) {
        return weight * (1 + reps / 30); // Epley formula
    }

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
        const canvas  = document.getElementById('analysis-chart');
        if (!exerciseName) {
            prCard.className = 'pr-card hidden';
            if (analysisChart) { analysisChart.destroy(); analysisChart = null; }
            return;
        }

        const all  = await DB.getAllSets();
        const sets = all.filter(s => s.exercise === exerciseName);
        if (!sets.length) return;

        // Group into sessions by calendar day
        const sessionMap = {};
        sets.forEach(s => {
            const key = new Date(s.timestamp).toLocaleDateString();
            if (!sessionMap[key]) sessionMap[key] = { timestamp: s.timestamp, sets: [] };
            sessionMap[key].sets.push(s);
        });

        const sessions = Object.entries(sessionMap)
            .sort((a, b) => a[1].timestamp - b[1].timestamp);

        const labels   = sessions.map(([, s]) =>
            new Date(s.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric' }));

        const avgE1rms = sessions.map(([, s]) => {
            const vals = s.sets.map(x => e1rm(x.weight, x.reps));
            return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
        });

        const volumes  = sessions.map(([, s]) =>
            Math.round(s.sets.reduce((a, x) => a + x.weight * x.reps, 0)));

        // PR = single set with highest e1RM
        const prSet  = sets.reduce((best, s) => e1rm(s.weight, s.reps) > e1rm(best.weight, best.reps) ? s : best);
        const prVal  = Math.round(e1rm(prSet.weight, prSet.reps));
        const prDate = new Date(prSet.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });

        prCard.className = 'pr-card';
        prCard.innerHTML = `
            <span class="pr-label">🏆 PR Set</span>
            <span class="pr-set">${prSet.weight} lbs × ${prSet.reps} reps</span>
            <span class="pr-e1rm">e1RM: ${prVal} lbs · ${prDate}</span>`;

        const cat      = getCategory(exerciseName);
        const accent   = cat==='push' ? '#ff6b6b' : cat==='pull' ? '#4dabf7' : cat==='legs' ? '#69db7c' : '#007bff';

        if (analysisChart) { analysisChart.destroy(); }

        analysisChart = new Chart(canvas, {
            data: {
                labels,
                datasets: [
                    {
                        type: 'line',
                        label: 'Avg e1RM (lbs)',
                        data: avgE1rms,
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
                        label: 'Volume (lbs)',
                        data: volumes,
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
                        title: { display: true, text: 'e1RM (lbs)', color: '#aaa', font: { size: 10 } },
                        ticks: { color: accent, font: { size: 10 } },
                        grid:  { color: '#2a2a2a' }
                    },
                    y2: {
                        position: 'right',
                        title: { display: true, text: 'Volume (lbs)', color: '#aaa', font: { size: 10 } },
                        ticks: { color: '#555', font: { size: 10 } },
                        grid:  { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    document.getElementById('analysis-exercise')
        .addEventListener('change', e => renderAnalysis(e.target.value));
    // ─────────────────────────────────────────────────────────────────────────────

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
            if (btn.dataset.target === 'view-analysis') loadAnalysis(); 
        });
    });
});