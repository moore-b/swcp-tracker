// functions/index.js
// Cloud Function to maintain per-day activity totals for each user.
// Triggered after a processed activity document is created.
// Adjust collection paths to match your setup.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// Path to processed activities per user
const PROCESSED_COLLECTION = 'processedActivities'; // processedActivities/{uid}/{activityId}

exports.updateDailyTotals = functions.firestore
  .document(`${PROCESSED_COLLECTION}/{userId}/{activityId}`)
  .onWrite(async (change, context) => {
    const { userId, activityId } = context.params;
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;

    // If document was deleted, we can bail out (or handle decrement logic)
    if (!after) return null;

    // Ignore updates that do not change distance
    if (before && before.distance_km === after.distance_km) return null;

    const distanceKm = after.distance_km || 0;
    const dateStr    = (after.start_date_local || '').slice(0, 10); // YYYY-MM-DD

    if (!dateStr) return null;

    const dayRef = admin.firestore()
      .collection('userDailyTotals').doc(userId)
      .collection('days').doc(dateStr);

    await dayRef.set({
      totalKm: admin.firestore.FieldValue.increment(distanceKm),
      activities: admin.firestore.FieldValue.arrayUnion({
        id: Number(activityId),
        distance: distanceKm
      }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return null;
  }); 