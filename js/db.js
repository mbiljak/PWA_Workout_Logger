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

    async updateSet(id, changes) {
        return await db.sets.update(id, changes);
    },

    // Full replace from a JSON backup (object form, or a legacy bare sets array).
    async restore(backup) {
        const sets = Array.isArray(backup) ? backup : (backup.sets || []);
        const exercises = (!Array.isArray(backup) && backup.exercises) || null;
        await db.transaction('rw', db.sets, db.exercises, async () => {
            await db.sets.clear();
            if (sets.length) await db.sets.bulkPut(sets);
            if (exercises && exercises.length) {
                await db.exercises.clear();
                await db.exercises.bulkPut(exercises);
                localStorage.setItem('exercises_seeded', 'true'); // don't re-seed over a restore
            }
        });
        if (!Array.isArray(backup)) {
            if (backup.bodyweight != null) localStorage.setItem('bodyweight', backup.bodyweight);
            if (backup.bodyweight_log != null) localStorage.setItem('bodyweight_log', backup.bodyweight_log);
        }
        return { sets: sets.length, exercises: exercises ? exercises.length : 0 };
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

    // Returns ALL sets (any exercise) from the most recent session day for `name`
    // that is NOT today. Returning the full day lets callers detect interleaved
    // exercises and avoid counting cross-exercise gaps as rest.
    async getLastSessionAllSets(name) {
        if (!name) return [];
        const todayKey = new Date().toLocaleDateString();
        const prevSet = await db.sets
            .where('exercise').equals(name)
            .reverse()
            .filter(s => new Date(s.timestamp).toLocaleDateString() !== todayKey)
            .first();
        if (!prevSet) return [];
        const day = new Date(prevSet.timestamp);
        const startOfDay = new Date(day).setHours(0, 0, 0, 0);
        const endOfDay   = new Date(day).setHours(23, 59, 59, 999);
        const daySets = await db.sets.where('timestamp').between(startOfDay, endOfDay).toArray();
        return daySets.sort((a, b) => a.timestamp - b.timestamp);
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