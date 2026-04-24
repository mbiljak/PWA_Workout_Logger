// Initialize Dexie
const db = new Dexie('WorkoutDB');

db.version(1).stores({
    sets: '++id, timestamp, exercise, weight, reps, notes'
});

const DB = {
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
    }
};