// Extend this as you add new exercises. Unknown exercises = no color (neutral).
const EXERCISES = {
    // ── LEGS ──────────────────────────────────────────────────────
    'Squat':                     'legs',
    'RDL':                       'legs',
    'Good Mornings':             'legs',
    'Glute Bridges':             'legs',
    'Leg Extensions':            'legs',
    'Leg Press':                 'legs',
    'Bodyweight Squat':          'legs',
    'Hamstring Curls':           'legs',
    'Calf Raises (Seated)':      'legs',
    'Hip Adduction Machine':     'legs',

    // ── PULL ──────────────────────────────────────────────────────
    'Deadlift':                  'pull',
    'Back Extension Machine':    'pull',
    'Pull-ups':                  'pull',
    'Pull-ups (Close Grip)':     'pull',
    'Assisted Pull-ups':         'pull',
    'Lat Pulldown':              'pull',
    'Lat Pulldown (Close Grip)': 'pull',
    'Machine Front Pull Down':   'pull',
    'Cable Rows (Close Grip)':   'pull',
    'Cable Rows (Wide Grip)':    'pull',
    'Machine Rows':              'pull',
    'Chest-Supported T-Bar Rows':'pull',
    'BB Bicep Curls':            'pull',
    'DB Bicep Curls':            'pull',
    'Incline DB Bicep Curls':    'pull',
    'Preacher Curls':            'pull',
    'Hammer Curls':              'pull',
    'BB Wrist Curls':            'pull',
    'Reverse Wrist Curls':       'pull',
    'Machine Rear Delt Flyes':   'pull',
    'Face Pulls':                'pull',
    'Upright Rows':              'pull',

    // ── PUSH ──────────────────────────────────────────────────────
    'Standing OHP':              'push',
    'Smith Machine OHP':         'push',
    'DB Shoulder Press':         'push',
    'Machine Shoulder Press':    'push',
    'Bench Press':               'push',
    'Incline Bench Press':       'push',
    'Close-Grip Bench Press':    'push',
    'Incline Smith Press':       'push',
    'Machine Chest Press':       'push',
    'Push-ups':                  'push',
    'Diamond Push-ups':          'push',
    'Dips':                      'push',
    'Assisted Dips':             'push',
    'Cable Flyes':               'push',
    'Machine Flyes':             'push',
    'Tricep Cable Extension':    'push',
    'Overhead Cable Extension':  'push',
    'Single Arm Cable Extension':'push',
    'DB Lateral Raise':          'push',
    'Machine Lateral Raise':     'push',
    'Cable Lateral Raise':       'push',

    // ── CORE ──────────────────────────────────────────────────────
    'Plank':                     'core',
    'Hanging Leg Raises':        'core',
    'Leg Raises':                'core',
    'Sit-ups':                   'core',
    'Machine Crunches':          'core',
    'Side Planks':               'core',
    'Suitcase Carry':            'core',
    'Wood Chops':                'core',
};

// Returns 'push' | 'pull' | 'legs' | null
function getCategory(exerciseName) {
    return EXERCISES[exerciseName] ?? null;
}

// Given an array of exercise names, returns the dominant category (or 'mixed')
function sessionCategory(names) {
    const counts = {push:0, pull:0, legs:0};
    names.forEach(n => { const c = getCategory(n); if (c) counts[c]++; });
    const top = Object.entries(counts).sort((a,b) => b[1]-a[1]);
    if (top[0][1] === 0) return null;
    if (top[0][1] === top[1][1] && top[1][1] > 0) return 'mixed';
    return top[0][0];
}