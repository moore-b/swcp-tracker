// swcp_analysis_worker.js

// Import the Turf.js library into the worker's scope
// IMPORTANT: The path to turf.min.js here must be accessible from where your worker script is served.
// If your worker.js is in the same folder as index.html, and unpkg.com is allowed, this is fine.
importScripts('https://unpkg.com/@turf/turf@6/turf.min.js');

let swcpGeoJSON = null; // To store the main path GeoJSON

// Constants that the worker needs
const DISTANCE_THRESHOLD_METERS = 100;
const ACTIVITY_SAMPLE_INTERVAL_METERS = 50;

// This function is the core analysis logic, moved from main.js
function findOverlappingPoints(activityLine) {
    const matchedPoints = [];
    if (!swcpGeoJSON) {
        // Log to worker console if SWCP GeoJSON isn't initialized
        console.error("Worker: SWCP GeoJSON not initialized.");
        return [];
    }
   
    const activityLength = turf.length(activityLine, {units: 'meters'});
    const numSamples = Math.max(2, Math.ceil(activityLength / ACTIVITY_SAMPLE_INTERVAL_METERS));
   
    for (let i = 0; i <= numSamples; i++) {
        const distance = (i / numSamples) * activityLength;
        const sampledPoint = turf.along(activityLine, distance, {units: 'meters'});
       
        if (!sampledPoint) continue;

        const nearestPointOnLine = turf.nearestPointOnLine(swcpGeoJSON, sampledPoint);
       
        if (turf.distance(sampledPoint, nearestPointOnLine, {units: 'meters'}) < DISTANCE_THRESHOLD_METERS) {
            matchedPoints.push(nearestPointOnLine.geometry.coordinates);
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
                const matchedPoints = findOverlappingPoints(activityLine);
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
