// swcp_analysis_worker.js

// Import Turf.js library from local file
let turfLoaded = false;
try {
    self.importScripts('turf.min.js');
    turfLoaded = true;
    console.log('Worker: Turf.js loaded successfully from local file');
} catch (error) {
    console.error('Worker: Failed to load Turf.js from local file:', error);
    turfLoaded = false;
}

if (!turfLoaded) {
    console.error('Worker: Critical error - Turf.js could not be loaded. Analysis will not work.');
    self.postMessage({ 
        type: 'error', 
        payload: { 
            activityId: 'worker_init', 
            error: 'Turf.js library could not be loaded from local file. Please check if turf.min.js exists in the project directory.' 
        } 
    });
}

let swcpGeoJSON = null; // Will store the Turf.js LineString geometry of the SWCP
let swcpTotalDistance = 0; // Total length of SWCP in kilometers

// Thresholds for determining overlap and sampling
const DISTANCE_THRESHOLD_METERS = 100; // How close an activity point must be to the SWCP to be considered "on path"
const ACTIVITY_SAMPLE_INTERVAL_METERS = 50; // How frequently to sample points along the activity line (increased precision from 100 to 50 for more accuracy)
const UNIQUE_POINT_MERGE_THRESHOLD_METERS = 20; // How close points must be to be considered the same unique point for completion tracking
const SEGMENT_BREAK_THRESHOLD_KM = 0.2; // How far apart points can be along the SWCP before a segment is considered broken

self.onmessage = function(e) {
    const { type, activityId, activityStream, existingPoints, swcpGeoJSONString, swcpTotalDistance: totalDist } = e.data;

    // Check if Turf.js is loaded before processing
    if (!turfLoaded) {
        self.postMessage({ 
            type: 'error', 
            payload: { 
                activityId: activityId || 'unknown', 
                error: 'Turf.js library is not loaded. Cannot process activities. Please refresh the page.' 
            } 
        });
        return;
    }

    if (type === 'init_swcp') {
        try {
            // Parse the SWCP GeoJSON string sent from the main thread
            swcpGeoJSON = JSON.parse(swcpGeoJSONString);
            swcpTotalDistance = totalDist;
            console.log('Worker: SWCP data initialized successfully.');
        } catch (error) {
            console.error('Worker: Failed to initialize SWCP GeoJSON:', error);
            self.postMessage({ type: 'error', payload: { activityId: 'init_worker', error: `SWCP GeoJSON parsing error: ${error.message}` } });
        }
    } else if (type === 'process_activity') {
        if (!swcpGeoJSON) {
            self.postMessage({ type: 'error', payload: { activityId, error: 'Worker: SWCP data not initialized. Cannot process activity.' } });
            return;
        }

        let newOverlappingPoints = [];
        // Only run findOverlappingPoints if an actual activity stream is provided (not null/empty for initial_load)
        if (activityStream && activityStream.length > 0) {
            newOverlappingPoints = findOverlappingPoints(activityStream, activityId);
        } else {
            // If activityStream is null/empty (e.g., initial_load), simply log and proceed with existing points
            console.log(`Worker: activityStream is empty or null for activityId: ${activityId}. Processing existing points only.`);
        }
       
        // Combine newly found points with previously completed points
        const allCompletedPoints = existingPoints.concat(newOverlappingPoints);
       
        // Calculate overall progress using all unique completed points
        const resultPayload = calculateOverallProgress(allCompletedPoints);
        resultPayload.activityId = activityId; // Attach activityId back to the result

        self.postMessage({ type: 'result', payload: resultPayload });
    }
};

/**
 * Finds points from an activity stream that overlap with the SWCP.
 * @param {Array<Array<number>>} activityStream - Array of [latitude, longitude] pairs from Strava.
 * @param {string} activityId - The ID of the activity.
 * @returns {Array<Array<number>>} Array of [longitude, latitude] points on the SWCP that overlap.
 */
function findOverlappingPoints(activityStream, activityId) {
    // IMPORTANT FIX: Convert Strava's [lat, lon] to Turf.js's [lon, lat] for activity points
    const turfActivityCoords = activityStream.map(p => [p[1], p[0]]);

    // Create a Turf.js LineString from the activity coordinates
    // Defensive check: ensure turfActivityCoords has at least 2 points for a valid lineString
    if (turfActivityCoords.length < 2) {
        console.warn(`Worker: Activity ${activityId} has insufficient coordinates (${turfActivityCoords.length}) to form a line. Skipping overlap calculation.`);
        return [];
    }
    const activityLine = turf.lineString(turfActivityCoords);
   
    const overlappingPoints = [];
    const totalLength = turf.length(activityLine, { units: 'meters' });
    let lastReportedProgress = -1;

    for (let d = 0; d <= totalLength; d += ACTIVITY_SAMPLE_INTERVAL_METERS) {
        // Sample a point along the activity line
        const activityPoint = turf.along(activityLine, d, { units: 'meters' });
       
        // Find the nearest point on the SWCP to this activity sample point
        // nearestPointOnLine returns a Turf.js point, which includes its original coordinates
        const nearestOnSWCP = turf.nearestPointOnLine(swcpGeoJSON, activityPoint); // Default units are meters

        // If the distance from the activity point to the nearest point on SWCP is within threshold
        if (nearestOnSWCP.properties.dist <= DISTANCE_THRESHOLD_METERS) {
            // Add the coordinates of the point *on the SWCP* to our list of overlapping points
            overlappingPoints.push(nearestOnSWCP.geometry.coordinates); // These are already [lon, lat]
        }

        // Send progress update back to the main thread for UI
        const progress = Math.round((d / totalLength) * 100);
        if (progress > lastReportedProgress) {
            self.postMessage({ type: 'progress', payload: { activityId, progress } });
            lastReportedProgress = progress;
        }
    }
    // Ensure a final 100% is sent, as loop might stop just before
    if (lastReportedProgress < 100) {
        self.postMessage({ type: 'progress', payload: { activityId, progress: 100 } });
    }

    console.log(`Worker: Found ${overlappingPoints.length} overlapping points for activity ${activityId}.`);
    return overlappingPoints;
}

/**
 * Calculates the overall progress along the SWCP based on all unique completed points.
 * @param {Array<Array<number>>} allPoints - Array of [longitude, latitude] points that are on the SWCP.
 * @returns {Object} Progress details including segments, total distance, percentage, and unique points.
 */
function calculateOverallProgress(allPoints) {
    if (allPoints.length === 0) {
        console.log("Worker: No points to calculate progress. Returning 0.");
        return { segments: [], totalDistance: 0, percentage: "0.00", newCompletedPoints: [] };
    }

    // Step 1: Filter out duplicate points that are very close to each other
    // This uses turf.distance which expects turf.point objects, so conversion is needed.
    const uniquePoints = allPoints.reduce((acc, point) => {
        // Only add if no existing point in 'acc' is within UNIQUE_POINT_MERGE_THRESHOLD_METERS
        if (!acc.some(p => turf.distance(turf.point(p), turf.point(point), {units: 'meters'}) < UNIQUE_POINT_MERGE_THRESHOLD_METERS)) {
            acc.push(point);
        }
        return acc;
    }, []);

    // Step 2: Sort unique points by their location along the SWCP
    // We calculate 'location' as the distance from the start of the SWCP to the point closest to the unique point.
    const sortedPoints = uniquePoints.map(p => {
        const nearestOnSWCP = turf.nearestPointOnLine(swcpGeoJSON, turf.point(p));
       
        // Defensive check: ensure nearestOnSWCP.geometry.coordinates is valid before slicing
        if (!nearestOnSWCP || !nearestOnSWCP.geometry || !nearestOnSWCP.geometry.coordinates) {
             console.warn(`Worker: nearestOnSWCP invalid for point ${p}. Skipping location calculation.`);
             return { coords: p, location: -1 }; // Assign a negative location to put it at the start if sort fails
        }

        // Use turf.length(turf.lineSlice(...)) to get the distance of this nearest point from the start of swcpGeoJSON
        // This implicitly gets the "location" along the main SWCP line.
        let location = 0;
        try {
            // Ensure swcpGeoJSON has coordinates property for lineSlice source
            if (swcpGeoJSON && swcpGeoJSON.coordinates && swcpGeoJSON.coordinates.length > 0) {
                 location = turf.length(turf.lineSlice(turf.point(swcpGeoJSON.coordinates[0]), nearestOnSWCP, swcpGeoJSON), { units: 'kilometers' });
            } else {
                console.warn("Worker: swcpGeoJSON.coordinates is empty or invalid for lineSlice source.");
            }
        } catch (sliceError) {
            console.error(`Worker: Error calculating lineSlice for point ${p}: ${sliceError.message}`);
            location = -1; // Indicate error
        }
       
        return {
            coords: p, // Keep original point coordinates ([lon, lat])
            location: location // Distance along the SWCP in kilometers
        };
    }).sort((a, b) => a.location - b.location); // Sort by distance along the path

    // Filter out points that failed location calculation (location < 0)
    const filteredSortedPoints = sortedPoints.filter(p => p.location >= 0);

    // Step 3: Segment the sorted points into continuous sections
    let segments = [];
    let totalCompletedDistance = 0; // Initialize here
    let currentSegment = [];

    if (filteredSortedPoints.length > 0) {
        currentSegment.push(filteredSortedPoints[0].coords); // Start the first segment with the first point
        for (let i = 1; i < filteredSortedPoints.length; i++) {
            // If the current point is too far from the previous point along the path, start a new segment
            if (filteredSortedPoints[i].location - filteredSortedPoints[i-1].location > SEGMENT_BREAK_THRESHOLD_KM) {
                if (currentSegment.length > 1) { // Only add segments with more than one point
                    segments.push(currentSegment);
                    totalCompletedDistance += turf.length(turf.lineString(currentSegment), { units: 'kilometers' });
                }
                currentSegment = [filteredSortedPoints[i].coords]; // Start a new segment
            } else {
                currentSegment.push(filteredSortedPoints[i].coords); // Continue the current segment
            }
        }
        // Add the last segment if it's valid
        if (currentSegment.length > 1) {
            segments.push(currentSegment);
            totalCompletedDistance += turf.length(turf.lineString(currentSegment), { units: 'kilometers' });
        }
    }
   
    // Step 5: Calculate the percentage completion
    const percentage = swcpTotalDistance > 0 ? ((totalCompletedDistance / swcpTotalDistance) * 100).toFixed(2) : "0.00";
   
    const result = {
        segments: segments, // Array of [lon, lat] coordinate arrays
        totalDistance: totalCompletedDistance,
        percentage: percentage,
        newCompletedPoints: uniquePoints // All unique points found, for saving to local storage
    };

    console.log("Worker: Calculated overall progress:", result);
    return result;
}
