// swcp_analysis_worker.js

// Import the Turf.js library. The worker has its own scope.
self.importScripts('https://unpkg.com/@turf/turf@6/turf.min.js');

let swcpGeoJSON = null;
const DISTANCE_THRESHOLD_METERS = 100;
const ACTIVITY_SAMPLE_INTERVAL_METERS = 100;

// Listen for messages from the main script
self.onmessage = function(e) {
    const { type, activityId, activityLineCoords, swcpGeoJSONString } = e.data;

    if (type === 'init_swcp') {
        try {
            swcpGeoJSON = JSON.parse(swcpGeoJSONString);
            console.log('Worker: SWCP GeoJSON initialized.');
        } catch (error) {
            console.error('Worker: Failed to parse SWCP GeoJSON.', error);
        }
        return;
    }

    if (type === 'analyze_activity') {
        if (!swcpGeoJSON) {
            self.postMessage({
                type: 'error',
                payload: { activityId: activityId, error: 'SWCP GeoJSON not initialized in worker.' }
            });
            return;
        }
        try {
            const activityLine = turf.lineString(activityLineCoords);
            const overlappingPoints = findOverlappingPoints(activityLine, activityId);
            self.postMessage({
                type: 'result',
                payload: { activityId: activityId, overlappingPoints: overlappingPoints }
            });
        } catch (error) {
             self.postMessage({
                type: 'error',
                payload: { activityId: activityId, error: error.message }
            });
        }
    }
};

function findOverlappingPoints(activityLine, activityId) {
    const overlappingPoints = [];
    const totalLength = turf.length(activityLine, { units: 'meters' });
    let lastProgress = -1;

    for (let d = 0; d <= totalLength; d += ACTIVITY_SAMPLE_INTERVAL_METERS) {
        const activityPoint = turf.along(activityLine, d, { units: 'meters' });
        const nearestOnSWCP = turf.nearestPointOnLine(swcpGeoJSON, activityPoint, { units: 'meters' });

        if (nearestOnSWCP.properties.dist <= DISTANCE_THRESHOLD_METERS) {
            overlappingPoints.push(nearestOnSWCP.geometry.coordinates);
        }
       
        const progress = Math.round((d / totalLength) * 100);
        if (progress > lastProgress) {
            self.postMessage({ type: 'progress', payload: { activityId, progress } });
            lastProgress = progress;
        }
    }
   
    if (lastProgress < 100) {
        self.postMessage({ type: 'progress', payload: { activityId, progress: 100 } });
    }
    return overlappingPoints;
}
