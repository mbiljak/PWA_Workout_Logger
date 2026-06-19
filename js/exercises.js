// ─────────────────────────────────────────────────────────────────────────────
// EXERCISE DEFINITIONS
//
// Each exercise is a full object describing how it should be logged & analyzed:
//   name       unique display name (primary key in the `exercises` IndexedDB store)
//   category   'push' | 'pull' | 'legs' | 'core'   (drives heatmap / coloring)
//   equipment  'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'bands'
//   pattern    movement pattern — see MOVEMENT_PATTERNS below
//   tracking   'weighted' | 'bodyweight' | 'banded' | 'timed'
//   bwFraction (bodyweight only) fraction of bodyweight loaded by the movement
//
// EXERCISE_SEED is inserted into the DB once on first run (see DB.seedExercises).
// After that, the DB is the source of truth and is editable in-app. The in-memory
// `EXERCISE_DEFS` map is kept in sync by ui.js so getCategory() works synchronously.
// ─────────────────────────────────────────────────────────────────────────────

const MOVEMENT_PATTERNS = [
    'horizontal-push', 'vertical-push',
    'horizontal-pull', 'vertical-pull',
    'squat', 'hinge', 'lunge', 'carry',
    'core', 'isolation', 'other',
];

const EQUIPMENT_TYPES = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'bands'];
const TRACKING_TYPES  = ['weighted', 'bodyweight', 'banded', 'timed'];
const BAND_LEVELS     = ['light', 'medium', 'heavy'];

const EXERCISE_SEED = [
    // ── LEGS ──────────────────────────────────────────────────────────────────
    { name: 'Squat',                  category: 'legs', equipment: 'barbell',    pattern: 'squat',     tracking: 'weighted' },
    { name: 'RDL',                    category: 'legs', equipment: 'barbell',    pattern: 'hinge',     tracking: 'weighted' },
    { name: 'Good Mornings',          category: 'legs', equipment: 'barbell',    pattern: 'hinge',     tracking: 'weighted' },
    { name: 'Glute Bridges',          category: 'legs', equipment: 'barbell',    pattern: 'hinge',     tracking: 'weighted' },
    { name: 'Leg Extensions',         category: 'legs', equipment: 'machine',    pattern: 'isolation', tracking: 'weighted' },
    { name: 'Leg Press',              category: 'legs', equipment: 'machine',    pattern: 'squat',     tracking: 'weighted' },
    { name: 'Bodyweight Squat',       category: 'legs', equipment: 'bodyweight', pattern: 'squat',     tracking: 'bodyweight', bwFraction: 0.65 },
    { name: 'Hamstring Curls',        category: 'legs', equipment: 'machine',    pattern: 'isolation', tracking: 'weighted' },
    { name: 'Calf Raises (Seated)',   category: 'legs', equipment: 'machine',    pattern: 'isolation', tracking: 'weighted' },
    { name: 'Hip Adduction Machine',  category: 'legs', equipment: 'machine',    pattern: 'isolation', tracking: 'weighted' },

    // ── PULL ──────────────────────────────────────────────────────────────────
    { name: 'Deadlift',                   category: 'pull', equipment: 'barbell',    pattern: 'hinge',         tracking: 'weighted' },
    { name: 'Back Extension Machine',     category: 'pull', equipment: 'machine',    pattern: 'hinge',         tracking: 'weighted' },
    { name: 'Pull-ups',                   category: 'pull', equipment: 'bodyweight', pattern: 'vertical-pull', tracking: 'bodyweight', bwFraction: 1.00 },
    { name: 'Pull-ups (Close Grip)',      category: 'pull', equipment: 'bodyweight', pattern: 'vertical-pull', tracking: 'bodyweight', bwFraction: 1.00 },
    { name: 'Assisted Pull-ups',          category: 'pull', equipment: 'machine',    pattern: 'vertical-pull', tracking: 'bodyweight', bwFraction: 1.00 },
    { name: 'Lat Pulldown',               category: 'pull', equipment: 'cable',      pattern: 'vertical-pull', tracking: 'weighted' },
    { name: 'Lat Pulldown (Close Grip)',  category: 'pull', equipment: 'cable',      pattern: 'vertical-pull', tracking: 'weighted' },
    { name: 'Machine Front Pull Down',    category: 'pull', equipment: 'machine',    pattern: 'vertical-pull', tracking: 'weighted' },
    { name: 'Cable Rows (Close Grip)',    category: 'pull', equipment: 'cable',      pattern: 'horizontal-pull', tracking: 'weighted' },
    { name: 'Cable Rows (Wide Grip)',     category: 'pull', equipment: 'cable',      pattern: 'horizontal-pull', tracking: 'weighted' },
    { name: 'Machine Rows',               category: 'pull', equipment: 'machine',    pattern: 'horizontal-pull', tracking: 'weighted' },
    { name: 'Chest-Supported T-Bar Rows', category: 'pull', equipment: 'machine',    pattern: 'horizontal-pull', tracking: 'weighted' },
    { name: 'BB Bicep Curls',             category: 'pull', equipment: 'barbell',    pattern: 'isolation',     tracking: 'weighted' },
    { name: 'DB Bicep Curls',             category: 'pull', equipment: 'dumbbell',   pattern: 'isolation',     tracking: 'weighted' },
    { name: 'Incline DB Bicep Curls',     category: 'pull', equipment: 'dumbbell',   pattern: 'isolation',     tracking: 'weighted' },
    { name: 'Preacher Curls',             category: 'pull', equipment: 'machine',    pattern: 'isolation',     tracking: 'weighted' },
    { name: 'Hammer Curls',               category: 'pull', equipment: 'dumbbell',   pattern: 'isolation',     tracking: 'weighted' },
    { name: 'BB Wrist Curls',             category: 'pull', equipment: 'barbell',    pattern: 'isolation',     tracking: 'weighted' },
    { name: 'Reverse Wrist Curls',        category: 'pull', equipment: 'barbell',    pattern: 'isolation',     tracking: 'weighted' },
    { name: 'Machine Rear Delt Flyes',    category: 'pull', equipment: 'machine',    pattern: 'isolation',     tracking: 'weighted' },
    { name: 'Face Pulls',                 category: 'pull', equipment: 'cable',      pattern: 'isolation',     tracking: 'weighted' },
    { name: 'Upright Rows',               category: 'pull', equipment: 'barbell',    pattern: 'vertical-pull', tracking: 'weighted' },

    // ── PUSH ──────────────────────────────────────────────────────────────────
    { name: 'Standing OHP',             category: 'push', equipment: 'barbell',    pattern: 'vertical-push',   tracking: 'weighted' },
    { name: 'Smith Machine OHP',        category: 'push', equipment: 'machine',    pattern: 'vertical-push',   tracking: 'weighted' },
    { name: 'DB Shoulder Press',        category: 'push', equipment: 'dumbbell',   pattern: 'vertical-push',   tracking: 'weighted' },
    { name: 'Machine Shoulder Press',   category: 'push', equipment: 'machine',    pattern: 'vertical-push',   tracking: 'weighted' },
    { name: 'Bench Press',              category: 'push', equipment: 'barbell',    pattern: 'horizontal-push', tracking: 'weighted' },
    { name: 'Incline Bench Press',      category: 'push', equipment: 'barbell',    pattern: 'horizontal-push', tracking: 'weighted' },
    { name: 'Close-Grip Bench Press',   category: 'push', equipment: 'barbell',    pattern: 'horizontal-push', tracking: 'weighted' },
    { name: 'Incline Smith Press',      category: 'push', equipment: 'machine',    pattern: 'horizontal-push', tracking: 'weighted' },
    { name: 'Machine Chest Press',      category: 'push', equipment: 'machine',    pattern: 'horizontal-push', tracking: 'weighted' },
    { name: 'Push-ups',                 category: 'push', equipment: 'bodyweight', pattern: 'horizontal-push', tracking: 'bodyweight', bwFraction: 0.70 },
    { name: 'Diamond Push-ups',         category: 'push', equipment: 'bodyweight', pattern: 'horizontal-push', tracking: 'bodyweight', bwFraction: 0.70 },
    { name: 'Dips',                     category: 'push', equipment: 'bodyweight', pattern: 'vertical-push',   tracking: 'bodyweight', bwFraction: 1.00 },
    { name: 'Assisted Dips',            category: 'push', equipment: 'machine',    pattern: 'vertical-push',   tracking: 'bodyweight', bwFraction: 1.00 },
    { name: 'Cable Flyes',              category: 'push', equipment: 'cable',      pattern: 'isolation',       tracking: 'weighted' },
    { name: 'Machine Flyes',            category: 'push', equipment: 'machine',    pattern: 'isolation',       tracking: 'weighted' },
    { name: 'Tricep Cable Extension',   category: 'push', equipment: 'cable',      pattern: 'isolation',       tracking: 'weighted' },
    { name: 'Overhead Cable Extension', category: 'push', equipment: 'cable',      pattern: 'isolation',       tracking: 'weighted' },
    { name: 'Single Arm Cable Extension', category: 'push', equipment: 'cable',    pattern: 'isolation',       tracking: 'weighted' },
    { name: 'DB Lateral Raise',         category: 'push', equipment: 'dumbbell',   pattern: 'isolation',       tracking: 'weighted' },
    { name: 'Machine Lateral Raise',    category: 'push', equipment: 'machine',    pattern: 'isolation',       tracking: 'weighted' },
    { name: 'Cable Lateral Raise',      category: 'push', equipment: 'cable',      pattern: 'isolation',       tracking: 'weighted' },

    // ── CORE ──────────────────────────────────────────────────────────────────
    { name: 'Plank',              category: 'core', equipment: 'bodyweight', pattern: 'core',  tracking: 'timed' },
    { name: 'Hanging Leg Raises', category: 'core', equipment: 'bodyweight', pattern: 'core',  tracking: 'bodyweight', bwFraction: 0.50 },
    { name: 'Leg Raises',         category: 'core', equipment: 'bodyweight', pattern: 'core',  tracking: 'bodyweight', bwFraction: 0.50 },
    { name: 'Sit-ups',           category: 'core', equipment: 'bodyweight', pattern: 'core',  tracking: 'bodyweight', bwFraction: 0.50 },
    { name: 'Machine Crunches',   category: 'core', equipment: 'machine',    pattern: 'core',  tracking: 'weighted' },
    { name: 'Side Planks',        category: 'core', equipment: 'bodyweight', pattern: 'core',  tracking: 'timed' },
    { name: 'Suitcase Carry',     category: 'core', equipment: 'dumbbell',   pattern: 'carry', tracking: 'timed' },
    { name: 'Wood Chops',         category: 'core', equipment: 'cable',      pattern: 'core',  tracking: 'weighted' },

    // ── THERAPY / BANDED ────────────────────────────────────────────────────────
    { name: 'YTL Raises (Bands)', category: 'pull', equipment: 'bands', pattern: 'isolation', tracking: 'banded' },
];

// In-memory definition map: { name -> def }. Kept in sync by ui.js (loadExerciseDefs).
// Falls back to the seed so getCategory() works before the DB has loaded.
let EXERCISE_DEFS = Object.fromEntries(EXERCISE_SEED.map(e => [e.name, e]));

// Returns 'push' | 'pull' | 'legs' | 'core' | null
function getCategory(exerciseName) {
    return EXERCISE_DEFS[exerciseName]?.category ?? null;
}

// Returns the full definition (or null for an unknown exercise)
function getDef(exerciseName) {
    return EXERCISE_DEFS[exerciseName] ?? null;
}
