// Initialize Dexie
const db = new Dexie('WorkoutDB');

db.version(1).stores({
    sets: '++id, timestamp, exercise, weight, reps, notes'
});

// v2: add an editable exercise-definition store.
// (Extra, non-indexed fields on a set — duration, bandLevel — need no schema change.)
db.version(2).stores({
    sets: '++id, timestamp, exercise, weight, reps, notes',
    exercises: '&name, category, equipment, tracking'
});

const DB = {
    async addSet(set) {
        return await db.sets.add({
            ...set,
            timestamp: Date.now()
        });
    },
    async importSet(set) {
        return await db.sets.add(set);
    },

    async getTodaySets() {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        
        return await db.sets
            .where('timestamp')
            .aboveOrEqual(startOfDay.getTime())
            .reverse()
            .sortBy('timestamp');
    },

    async getAllSets() {
        return await db.sets.orderBy('timestamp').reverse().toArray();
    },

    async deleteSet(id) {
        return await db.sets.delete(id);
    },

    async getUniqueExercises() {
        const allSets = await db.sets.toArray();
        const exercises = [...new Set(allSets.map(s => s.exercise))];
        return exercises.sort();
    },

    // Returns { exercise, weight, reps } from the most recent set of this exercise
    async getLastSetForExercise(exerciseName) {
        if (!exerciseName) return null;
        return await db.sets
            .where('exercise').equals(exerciseName)
            .reverse()
            .first() || null;
    },

    async getRoutineFromLastTime(exerciseName) {
        if (!exerciseName) return [];
        
        const lastSet = await db.sets
            .where('exercise').equals(exerciseName)
            .reverse()
            .first();
        
        if (!lastSet) return [];

        const day = new Date(lastSet.timestamp);
        const startOfDay = new Date(day.setHours(0, 0, 0, 0)).getTime();
        const endOfDay = new Date(day.setHours(23, 59, 59, 999)).getTime();

        const setsFromThatDay = await db.sets
            .where('timestamp')
            .between(startOfDay, endOfDay)
            .toArray();

        return [...new Set(setsFromThatDay.map(s => s.exercise))];
    },

    // ── Exercise definitions ─────────────────────────────────────────────────
    async getAllExercises() {
        return await db.exercises.orderBy('name').toArray();
    },

    async getExercise(name) {
        if (!name) return null;
        return await db.exercises.get(name) || null;
    },

    async upsertExercise(def) {
        // `def.name` is the primary key — put() inserts or replaces.
        return await db.exercises.put(def);
    },

    async deleteExercise(name) {
        return await db.exercises.delete(name);
    },

    // One-time seed from EXERCISE_SEED (defined in exercises.js).
    async seedExercises() {
        if (!localStorage.getItem('exercises_seeded')) {
            try {
                await db.exercises.bulkPut(EXERCISE_SEED);
                localStorage.setItem('exercises_seeded', 'true');
            } catch (err) {
                console.error('Exercise seed failed:', err);
            }
        }
        await this.runExerciseMigrations();
    },

    // Idempotent, versioned corrections to already-seeded definitions.
    async runExerciseMigrations() {
        // v1: Assisted Pull-ups / Dips were mistakenly tracked as 'weighted', so the
        // (negative) assistance value became the whole load → negative volume. Retrack
        // them as bodyweight so assistance is subtracted from the bodyweight load.
        if (!localStorage.getItem('exmig_assisted_v1')) {
            try {
                for (const name of ['Assisted Pull-ups', 'Assisted Dips']) {
                    const def = await db.exercises.get(name);
                    if (def && def.tracking === 'weighted') {
                        await db.exercises.put({ ...def, tracking: 'bodyweight', bwFraction: def.bwFraction ?? 1.0 });
                    }
                }
                localStorage.setItem('exmig_assisted_v1', 'true');
            } catch (err) {
                console.error('Assisted migration failed:', err);
            }
        }
    }
};