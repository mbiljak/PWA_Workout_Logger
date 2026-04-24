document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-export-json').addEventListener('click', async () => {
        const sets = await DB.getAllSets();
        const dataStr = JSON.stringify(sets, null, 2);
        downloadFile(dataStr, 'workout-backup.json', 'application/json');
    });

    document.getElementById('btn-export-csv').addEventListener('click', async () => {
        const sets = await DB.getAllSets();
        if (sets.length === 0) return alert("No data to export.");

        const headers = ['id', 'timestamp', 'date', 'exercise', 'weight', 'reps', 'notes'];
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