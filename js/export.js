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