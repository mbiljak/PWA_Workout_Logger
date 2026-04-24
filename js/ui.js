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
    const headerTitle   = document.getElementById('header-title');
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

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const [timeStr, exercise, reps, weight] = line.split(',');
                if (!timeStr || !exercise) continue;

                const dateClean = timeStr.replace('-', ' ');
                const timestamp = Date.parse(`${dateClean} ${currentYear}`);

                if (!isNaN(timestamp)) {
                    await DB.addSet({
                        exercise: exercise.trim(),
                        reps: parseInt(reps),
                        weight: parseFloat(weight),
                        timestamp,
                        notes: "Imported from CSV"
                    });
                }
            }
            localStorage.setItem('sample_data_imported', 'true');
            await refreshExerciseCache();
            loadTodaySets();
        } catch (err) {
            console.error("Auto-import failed:", err);
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

        if (sets.length === 0) {
            container.innerHTML = '<p style="padding:20px;">No workout history found.</p>';
            return;
        }

        let currentDate = '';
        let currentList = null;

        sets.forEach(set => {
            const dateStr = new Date(set.timestamp).toLocaleDateString();
            if (dateStr !== currentDate) {
                currentDate = dateStr;
                const header = document.createElement('h2');
                header.className = 'history-date';
                header.textContent = dateStr;
                container.appendChild(header);

                currentList = document.createElement('ul');
                currentList.className = 'set-list';
                container.appendChild(currentList);
            }
            currentList.appendChild(createSetElement(set));
        });
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
            headerTitle.textContent = btn.dataset.title;

            if (btn.dataset.target === 'view-history') loadHistory();
        });
    });
});