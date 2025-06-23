// swcp_analysis_worker.js

self.importScripts('https://unpkg.com/@turf/turf@6/turf.min.js');

let swcpGeoJSON = null;
let swcpTotalDistance = 0;
const DISTANCE_THRESHOLD_METERS = 100;
const ACTIVITY_SAMPLE_INTERVAL_METERS = 100;

self.onmessage = function(e) {
    const { type, activityId, activityStream, existingPoints, swcpGeoJSONString, swcpTotalDistance: totalDist } = e.data;

    if (type === 'init_swcp') {
        swcpGeoJSON = JSON.parse(swcpGeoJSONString);
        swcpTotalDistance = totalDist;
        console.log('Worker: SWCP data initialized.');
    } else if (type === 'process_activity') {
        if (!swcpGeoJSON) {
            self.postMessage({ type: 'error', payload: { activityId, error: 'Worker not initialized.' } });
            return;
        }

        const newOverlappingPoints = findOverlappingPoints(activityStream, activityId);
        const allCompletedPoints = existingPoints.concat(newOverlappingPoints);
        const resultPayload = calculateOverallProgress(allCompletedPoints);
        resultPayload.activityId = activityId;
       
        self.postMessage({ type: 'result', payload: resultPayload });
    }
};

function findOverlappingPoints(activityStream, activityId) {
    if (!activityStream || activityStream.length === 0) return [];
   
    const activityLine = turf.lineString(activityStream);
    const overlappingPoints = [];
    const totalLength = turf.length(activityLine, { units: 'meters' });
    let lastReportedProgress = -1;

    for (let d = 0; d <= totalLength; d += ACTIVITY_SAMPLE_INTERVAL_METERS) {
        const activityPoint = turf.along(activityLine, d, { units: 'meters' });
        const nearestOnSWCP = turf.nearestPointOnLine(swcpGeoJSON, activityPoint, { units: 'meters' });
       
        if (nearestOnSWCP.properties.dist <= DISTANCE_THRESHOLD_METERS) {
            overlappingPoints.push(nearestOnSWCP.geometry.coordinates);
        }

        // Send progress update back to the main thread
        const progress = Math.round((d / totalLength) * 100);
        if (progress > lastReportedProgress) {
            self.postMessage({ type: 'progress', payload: { activityId, progress } });
            lastReportedProgress = progress;
        }
    }
    // Ensure a final 100% is sent
    if (lastReportedProgress < 100) {
        self.postMessage({ type: 'progress', payload: { activityId, progress: 100 } });
    }

    return overlappingPoints;
}

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
            if (sortedPoints[i].location - sortedPoints[i-1].location > 0.2) {
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
   
    return {
        segments: segments,
        totalDistance: totalCompletedDistance,
        percentage: percentage,
        newCompletedPoints: uniquePoints
    };
}
