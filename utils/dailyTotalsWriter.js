import { getFirestore, doc, setDoc, increment, arrayUnion, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

/**
 * Append an activity to the user's per-day totals document.
 * Creates the doc if it does not exist.
 *
 * @param {string} uid                      Firebase Auth UID
 * @param {Object} activity                Strava activity object (expects id, distance in metres or km, start_date_local or start_date)
 */
export async function writeDailyTotals(uid, activity) {
  try {
    if (!uid || !activity) return;

    // get date key (YYYY-MM-DD)
    const dateKey = (activity.start_date_local || activity.start_date || '').slice(0, 10);
    if (!dateKey) return;

    // distance in km (Strava = metres)
    let km = 0;
    if (typeof activity.distance_km === 'number') km = activity.distance_km;
    else if (typeof activity.distanceKm === 'number') km = activity.distanceKm;
    else if (typeof activity.distance === 'number') km = activity.distance / 1000; // metres → km

    const db = getFirestore();
    const ref = doc(db, 'userDailyTotals', uid, 'days', dateKey);

    await setDoc(
      ref,
      {
        totalKm:    increment(km),
        activities: arrayUnion({ id: Number(activity.id), distance: km }),
        updatedAt:  serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    console.warn('writeDailyTotals failed:', err.message || err);
  }
} 