// swcp_analysis_worker.js

// Import the Turf.js library into the worker's scope
// IMPORTANT: The path to turf.min.js here must be accessible from where your worker script is served.
importScripts('https://unpkg.com/@turf/turf@6/turf.min.js');

let swcpGeoJSON = null; // To store the main path GeoJSON

// Constants that the worker needs
// These must match the values in index.html for consistent behavior
const DISTANCE_THRESHOLD_METERS = 100;
const ACTIVITY_SAMPLE_INTERVAL_METERS = 100; // Changed sample interval to 100m

// This function is the core analysis logic, moved from main.js
function findOverlappingPoints(activityLine, activityId) { // Pass activityId for progress reporting
    const matchedPoints = [];
    if (!swcpGeoJSON) {
        console.error("Worker: SWCP GeoJSON not initialized.");
        return [];
    }
   
    const activityLength = turf.length(activityLine, {units: 'meters'});
    const numSamples = Math.max(2, Math.ceil(activityLength / ACTIVITY_SAMPLE_INTERVAL_METERS));
   
    // Send initial progress
    self.postMessage({ type: 'progress', activityId: activityId, percentage: 0 });

    // Update approx 20 times during the loop
    const progressUpdateInterval = Math.max(1, Math.floor(numSamples / 20));

    for (let i = 0; i <= numSamples; i++) {
        const distance = (i / numSamples) * activityLength;
        const sampledPoint = turf.along(activityLine, distance, {units: 'meters'});
       
        if (!sampledPoint) continue;

        const nearestPointOnLine = turf.nearestPointOnLine(swcpGeoJSON, sampledPoint);
       
        if (turf.distance(sampledPoint, nearestPointOnLine, {units: 'meters'}) < DISTANCE_THRESHOLD_METERS) {
            matchedPoints.push(nearestPointOnLine.geometry.coordinates);
        }

        // Send progress update
        if (i > 0 && i % progressUpdateInterval === 0 || i === numSamples) {
            const percentage = Math.floor((i / numSamples) * 100);
            self.postMessage({ type: 'progress', activityId: activityId, percentage: percentage });
        }
    }
    return matchedPoints;
}

// Listen for messages from the main thread
self.onmessage = function(e) {
    const data = e.data;

    switch (data.type) {
        case 'init_swcp':
            // Receive the main SWCP GeoJSON once
            try {
                swcpGeoJSON = JSON.parse(data.swcpGeoJSONString);
            } catch (error) {
                console.error("Worker: Error parsing SWCP GeoJSON:", error);
            }
            break;
        case 'analyze_activity':
            // Receive activity data and perform analysis
            if (!swcpGeoJSON) {
                self.postMessage({ type: 'error', message: 'SWCP GeoJSON not initialized in worker.' });
                return;
            }
            try {
                const activityLine = turf.lineString(data.activityLineCoords);
                // Call findOverlappingPoints with activityId for progress reporting
                const matchedPoints = findOverlappingPoints(activityLine, data.activityId);
                // Send results back to the main thread
                self.postMessage({ type: 'result', activityId: data.activityId, matchedPoints: matchedPoints });
            } catch (error) {
                console.error("Worker: Error during analysis:", error);
                self.postMessage({ type: 'error', message: `Analysis failed for activity ${data.activityId}: ${error.message}` });
            }
            break;
    }
};

// Error handling in the worker
self.onerror = function(e) {
    console.error("Worker Error:", e);
    self.postMessage({ type: 'error', message: `Worker error: ${e.message}` });
};
