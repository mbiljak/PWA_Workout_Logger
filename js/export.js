document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-export-json').addEventListener('click', async () => {
        // Full backup: logged sets AND exercise definitions (incl. user-created ones),
        // plus bodyweight settings, so nothing is lost on restore.
        const backup = {
            exportedAt: new Date().toISOString(),
            sets: await DB.getAllSets(),
            exercises: await DB.getAllExercises(),
            bodyweight: localStorage.getItem('bodyweight') || null,
            bodyweight_log: localStorage.getItem('bodyweight_log') || null,
        };
        downloadFile(JSON.stringify(backup, null, 2), 'workout-backup.json', 'application/json');
    });

    document.getElementById('btn-export-csv').addEventListener('click', async () => {
        const sets = await DB.getAllSets();
        if (sets.length === 0) return alert("No data to export.");

        const headers = ['id', 'timestamp', 'date', 'exercise', 'weight', 'reps', 'duration', 'bandLevel', 'notes'];
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

        downloadFile(csvRows.join('\n'), 'workout-backup.csv', 'text/csv');
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

    function downloadFile(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
});