// swcp_analysis_worker.js

// Import the Turf.js library for geospatial calculations
self.importScripts('https://unpkg.com/@turf/turf@6/turf.min.js');

// Worker-scoped global variables
let swcpGeoJSON = null;
let swcpTotalDistance = 0;
const DISTANCE_THRESHOLD_METERS = 100;
const ACTIVITY_SAMPLE_INTERVAL_METERS = 100;

// Main message handler for the worker
self.onmessage = function(e) {
    const { type, activityId, activityStream, existingPoints, swcpGeoJSONString, swcpTotalDistance: totalDist } = e.data;

    if (type === 'init_swcp') {
        // Initialize the worker with the main path data
        swcpGeoJSON = JSON.parse(swcpGeoJSONString);
        swcpTotalDistance = totalDist;
        console.log('Worker: SWCP data initialized.');
    } else if (type === 'process_activity') {
        // This is the main analysis task
        if (!swcpGeoJSON) {
            self.postMessage({ type: 'error', payload: { activityId, error: 'Worker not initialized with SWCP data.' } });
            return;
        }

        // 1. Find new points from the latest activity
        const newOverlappingPoints = findOverlappingPoints(activityStream);
       
        // 2. Combine with all previously found points
        const allCompletedPoints = existingPoints.concat(newOverlappingPoints);

        // 3. Perform all heavy calculations here, in the background
        const resultPayload = calculateOverallProgress(allCompletedPoints);
        resultPayload.activityId = activityId; // Add activityId for the response

        // 4. Send the final, lightweight result back to the main thread
        self.postMessage({ type: 'result', payload: resultPayload });
    }
};

/**
 * Takes an activity's GPS stream and finds which points overlap with the SWCP.
 */
function findOverlappingPoints(activityStream) {
    if (!activityStream || activityStream.length === 0) return [];
   
    const activityLine = turf.lineString(activityStream);
    const overlappingPoints = [];
    const totalLength = turf.length(activityLine, { units: 'meters' });

    for (let d = 0; d <= totalLength; d += ACTIVITY_SAMPLE_INTERVAL_METERS) {
        const activityPoint = turf.along(activityLine, d, { units: 'meters' });
        const nearestOnSWCP = turf.nearestPointOnLine(swcpGeoJSON, activityPoint, { units: 'meters' });
       
        if (nearestOnSWCP.properties.dist <= DISTANCE_THRESHOLD_METERS) {
            overlappingPoints.push(nearestOnSWCP.geometry.coordinates);
        }
    }
    return overlappingPoints;
}

/**
 * Takes the master list of all completed points and calculates the final progress.
 * This function contains all the heavy logic that was previously freezing the main thread.
 */
function calculateOverallProgress(allPoints) {
    if (allPoints.length === 0) {
        return { segments: [], totalDistance: 0, percentage: "0.00", newCompletedPoints: [] };
    }

    const uniquePoints = allPoints.reduce((acc, point) => {
        if (!acc.some(p => turf.distance(turf.point(p), turf.point(point), {units: 'meters'}) < 20)) {
            acc.push(point);
        }
        return acc;
    }, []);

    const sortedPoints = uniquePoints.map(p => ({
        coords: p,
        location: turf.nearestPointOnLine(swcpGeoJSON, turf.point(p)).properties.location
    })).sort((a, b) => a.location - b.location);

    let segments = [], currentSegment = [];
    if (sortedPoints.length > 0) {
        currentSegment.push(sortedPoints[0].coords);
        for (let i = 1; i < sortedPoints.length; i++) {
            if (sortedPoints[i].location - sortedPoints[i-1].location > 0.2) { // Gap > 200m
                if (currentSegment.length > 1) segments.push(currentSegment);
                currentSegment = [sortedPoints[i].coords];
            } else {
                currentSegment.push(sortedPoints[i].coords);
            }
        }
        if (currentSegment.length > 1) segments.push(currentSegment);
    }

    const totalCompletedDistance = segments.reduce((sum, seg) => {
        return sum + turf.length(turf.lineString(seg), { units: 'kilometers' });
    }, 0);

    const percentage = swcpTotalDistance > 0 ? ((totalCompletedDistance / swcpTotalDistance) * 100).toFixed(2) : "0.00";
   
    // Return the final payload for the main thread to use
    return {
        segments: segments,
        totalDistance: totalCompletedDistance,
        percentage: percentage,
        newCompletedPoints: uniquePoints // This is the new master list for storage
    };
}
