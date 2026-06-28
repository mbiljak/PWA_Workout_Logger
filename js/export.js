document.addEventListener('DOMContentLoaded', () => {
    const backupStatusEl = document.getElementById('backup-status');

    // ── "Last backup" status ──────────────────────────────────────────────────
    // Data is device-only (no backend), so a stale or missing backup is the real
    // risk. Surface it: nudge in a warning colour when it's been too long.
    const STALE_MS = 14 * 86400000; // 14 days
    async function renderBackupStatus() {
        if (!backupStatusEl) return;
        const count = (await DB.getAllSets()).length;
        const last  = parseInt(localStorage.getItem('last_export')) || 0;
        if (count === 0) { backupStatusEl.textContent = ''; backupStatusEl.classList.remove('warn'); return; }
        if (!last) {
            backupStatusEl.textContent = 'No backup yet — export to keep your data safe.';
            backupStatusEl.classList.add('warn');
            return;
        }
        const days = Math.floor((Date.now() - last) / 86400000);
        const ago  = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
        backupStatusEl.textContent = `Last backup: ${ago}.`;
        backupStatusEl.classList.toggle('warn', Date.now() - last > STALE_MS);
    }
    renderBackupStatus();

    function stampBackup() {
        localStorage.setItem('last_export', String(Date.now()));
        renderBackupStatus();
    }

    // Save a file: prefer the native share sheet (so iOS offers "Save to Files" /
    // iCloud Drive / AirDrop — real off-device durability), and fall back to a
    // plain download where file-sharing isn't supported. Only stamp the backup
    // when the save actually goes through (a cancelled share doesn't count).
    async function saveBackup(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const file = new File([blob], fileName, { type: mimeType });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: 'Workout backup' });
                stampBackup();
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return; // user cancelled — no stamp
                // Any other failure: fall through to a download.
            }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        stampBackup();
    }

    document.getElementById('btn-export-json').addEventListener('click', async () => {
        // Full backup: logged sets AND exercise definitions (incl. user-created ones),
        // plus bodyweight settings, so nothing is lost on restore. Weights are stored
        // canonical (lbs); the unit preference is display-only, so backups are portable.
        const backup = {
            exportedAt: new Date().toISOString(),
            sets: await DB.getAllSets(),
            exercises: await DB.getAllExercises(),
            bodyweight: localStorage.getItem('bodyweight') || null,
            bodyweight_log: localStorage.getItem('bodyweight_log') || null,
        };
        await saveBackup(JSON.stringify(backup, null, 2), 'workout-backup.json', 'application/json');
    });

    document.getElementById('btn-export-csv').addEventListener('click', async () => {
        const sets = await DB.getAllSets();
        if (sets.length === 0) return alert("No data to export.");

        // weight is always in lbs (canonical storage unit).
        const headers = ['id', 'timestamp', 'date', 'exercise', 'weight_lbs', 'reps', 'duration', 'bandLevel', 'notes'];
        const csvRows = [headers.join(',')];

        sets.forEach(set => {
            const dateStr = new Date(set.timestamp).toISOString();
            const row = [
                set.id,
                set.timestamp,
                dateStr,
                `"${set.exercise.replace(/"/g, '""')}"`,
                set.weight,
                set.reps,
                set.duration ?? '',
                set.bandLevel ?? '',
                `"${(set.notes || '').replace(/"/g, '""')}"`
            ];
            csvRows.push(row.join(','));
        });

        await saveBackup(csvRows.join('\n'), 'workout-backup.csv', 'text/csv');
    });

    // ── Restore from JSON backup ──────────────────────────────────────────────
    const importFile = document.getElementById('import-file');
    document.getElementById('btn-import-json').addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
        const file = importFile.files && importFile.files[0];
        importFile.value = ''; // allow re-selecting the same file later
        if (!file) return;
        let parsed;
        try {
            parsed = JSON.parse(await file.text());
        } catch {
            return alert('Not a valid backup file.');
        }
        const hasSets = Array.isArray(parsed) || Array.isArray(parsed.sets);
        if (!hasSets) return alert('Not a valid backup file.');
        if (!confirm('Replace ALL current data with this backup? Export first if unsure.')) return;
        const { sets } = await DB.restore(parsed);
        alert(`Restored ${sets} set${sets !== 1 ? 's' : ''}.`);
        location.reload();
    });
});
