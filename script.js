// Constants (No changes here)
const SWCP_GEOJSON_URL = 'routes.geojson';
const PROCESSED_ACTIVITIES_KEY = 'swcp_processed_activities';
const COMPLETED_POINTS_KEY = 'swcp_completed_points';
const ACTIVITY_STREAMS_CACHE_PREFIX = 'swcp_activity_stream_';
const CACHED_ACTIVITIES_KEY = 'swcp_cached_activities';
const CACHED_ACTIVITIES_TIMESTAMP_KEY = 'swcp_cached_activities_timestamp';
const CACHE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const BACKGROUND_IMAGE_PATH = 'background.webp'; // Kept for reference, though loaded via CSS
const STRAVA_ACCESS_TOKEN_KEY = 'stravaAccessToken';
const STRAVA_REFRESH_TOKEN_KEY = 'stravaRefreshToken';
const STRAVA_EXPIRES_AT_KEY = 'stravaExpiresAt';

// UI Elements collected into a single object for easier access and clarity
const UIElements = {};

// Global variables for map and data
let mainMap, swcpGeoJSON, swcpTotalDistance = 0, completedSegmentsLayer, currentPercentage = 0, allFetchedActivities = [];
let analysisWorker = null;
let swcpDataPromise = null; // Will store the promise for loading SWCP data

/**
 * Logs messages to the status log UI element.
 * @param {string} message - The message to log.
 * @param {'info' | 'warn' | 'error' | 'success'} type - The type of message for styling.
 */
const log = (message, type = 'info') => {
    if (!UIElements.statusLog) {
        console.warn('Status log element not found (UIElements.statusLog is null or undefined). Logging to console:', message);
        return;
    }
    const now = new Date().toLocaleTimeString();
    const p = document.createElement('p');
    let className = 'text-gray-900';
    if (type === 'error') className = 'text-red-600';
    else if (type === 'success') className = 'text-green-600';
    else if (type === 'warn') className = 'text-yellow-600';

    p.innerHTML = `<span class="text-gray-500">${now}:</span> <span class="${className}">${message}</span>`;
    UIElements.statusLog.appendChild(p);
    UIElements.statusLog.scrollTop = UIElements.statusLog.scrollHeight;
};

/**
 * Simple async delay function.
 * @param {number} ms - Milliseconds to wait.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Makes an authenticated call to the Strava API, with token refresh and retry logic.
 * @param {string} url - The API endpoint URL.
 * @param {RequestInit} options = {} - Fetch options.
 * @param {number} retries = 1 - Number of retries for 401 errors (for token refresh).
 * @returns {Promise<Response|null>} The fetch response or null on critical failure.
 */
async function makeStravaApiCall(url, options = {}, retries = 1) {
    let accessToken = localStorage.getItem(STRAVA_ACCESS_TOKEN_KEY);
    let expiresAt = localStorage.getItem(STRAVA_EXPIRES_AT_KEY);
   
    // Check if token is expired or about to expire (within 5 minutes)
    if (accessToken && expiresAt && (Date.now() / 1000 > parseInt(expiresAt) - 300)) {
        log('Access token expired or near expiry. Refreshing...', 'warn');
        const newAccessToken = await refreshAccessToken();
        if (newAccessToken) {
            accessToken = JSON.stringify(newAccessToken); // Store as string, use parsed here
        } else {
            log('Token refresh failed. Please log in again.', 'error');
            resetProgress(); // Force re-authentication if token refresh fails
            return null;
        }
    }

    options.headers = { ...options.headers, 'Authorization': `Bearer ${accessToken ? JSON.parse(accessToken) : ''}` };

    try {
        const response = await fetch(url, options);
        if (response.status === 401 && retries > 0) {
            log('API call unauthorized (401). Retrying with token refresh...', 'warn');
            const newAccessToken = await refreshAccessToken();
            return newAccessToken ? makeStravaApiCall(url, options, retries - 1) : null;
        }
        // Handle rate limits with exponential backoff
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After') || 5; // Default 5 seconds
            log(`Strava API Rate Limit Exceeded. Retrying in ${retryAfter} seconds...`, 'warn');
            await sleep(retryAfter * 1000 + (Math.random() * 1000)); // Add jitter for better distribution
            if (retries > 0) {
                return makeStravaApiCall(url, options, retries - 1);
            } else {
                log('Max retries for rate limit exceeded. Consider waiting longer.', 'error');
                alert('Strava API Rate Limit Exceeded after retries. Please wait at least 15 minutes and try again later.');
                return null;
            }
        }
        return response;
    } catch (error) {
        log(`API call network error: ${error.message}`, 'error');
        throw error; // Re-throw to allow calling functions to handle
    }
}

/**
 * Refreshes the Strava access token using the refresh token.
 * @returns {Promise<string|null>} The new access token or null if refresh fails.
 */
async function refreshAccessToken() {
    log('Attempting to refresh access token...');
    const refreshToken = localStorage.getItem(STRAVA_REFRESH_TOKEN_KEY);
    const clientId = localStorage.getItem('stravaClientId');
    const clientSecret = localStorage.getItem('stravaClientSecret');

    if (!refreshToken || !clientId || !clientSecret) {
        log('Missing refresh token or client credentials for refresh.', 'error');
        return null;
    }

    try {
        const response = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: JSON.parse(refreshToken),
                grant_type: 'refresh_token'
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
        }
        const data = await response.json();
        localStorage.setItem(STRAVA_ACCESS_TOKEN_KEY, JSON.stringify(data.access_token));
        localStorage.setItem(STRAVA_REFRESH_TOKEN_KEY, JSON.stringify(data.refresh_token));
        localStorage.setItem(STRAVA_EXPIRES_AT_KEY, data.expires_at.toString());
        log('Token refreshed successfully.', 'success');
        return data.access_token;
    } catch (error) {
        log(`Token refresh error: ${error.message}. Please re-authenticate.`, 'error');
        return null;
    }
}
   
/** Updates the CSS grid layout based on screen width. */
function updateGridLayout() {
    if (!UIElements.mainLayoutContainer) return; // Ensure elements are ready

    const isMobile = window.innerWidth <= 1024; // Tailwind's 'lg' breakpoint

    // Use a dataset attribute to prevent unnecessary DOM manipulations if layout hasn't changed
    if (isMobile) {
        if (UIElements.mainLayoutContainer.dataset.layout !== 'mobile') {
            UIElements.mainLayoutContainer.style.gridTemplateColumns = '1fr';
            UIElements.mainLayoutContainer.style.gridTemplateRows = 'auto auto auto auto auto';
            if (UIElements.headerSection) UIElements.headerSection.style.gridColumn = '1'; UIElements.headerSection.style.gridRow = '1';
            if (UIElements.progressSummarySection) UIElements.progressSummarySection.style.gridColumn = '1'; UIElements.progressSummarySection.style.gridRow = '2';
            if (UIElements.mapSection) UIElements.mapSection.style.gridColumn = '1'; UIElements.mapSection.style.gridRow = '3';
            if (UIElements.activitiesSection) UIElements.activitiesSection.style.gridColumn = '1'; UIElements.activitiesSection.style.gridRow = '4';
            if (UIElements.statusLogSectionContainer) UIElements.statusLogSectionContainer.style.gridColumn = '1'; UIElements.statusLogSectionContainer.style.gridRow = '5';
            if (UIElements.activitiesSection) {
                UIElements.activitiesSection.style.position = 'static';
                UIElements.activitiesSection.style.height = 'auto';
                UIElements.activitiesSection.style.top = 'auto'; // Remove sticky top on mobile
            }
            UIElements.mainLayoutContainer.dataset.layout = 'mobile';
        }
    } else {
        if (UIElements.mainLayoutContainer.dataset.layout !== 'desktop') {
            UIElements.mainLayoutContainer.style.gridTemplateColumns = '2fr 1fr';
            UIElements.mainLayoutContainer.style.gridTemplateRows = 'auto auto 1fr auto';
            if (UIElements.headerSection) UIElements.headerSection.style.gridColumn = '1'; UIElements.headerSection.style.gridRow = '1';
            if (UIElements.progressSummarySection) UIElements.progressSummarySection.style.gridColumn = '1'; UIElements.progressSummarySection.style.gridRow = '2';
            if (UIElements.mapSection) UIElements.mapSection.style.gridColumn = '1'; UIElements.mapSection.style.gridRow = '3';
            if (UIElements.statusLogSectionContainer) UIElements.statusLogSectionContainer.style.gridColumn = '1'; UIElements.statusLogSectionContainer.style.gridRow = '4';
            if (UIElements.activitiesSection) {
                UIElements.activitiesSection.style.gridColumn = '2';
                UIElements.activitiesSection.style.gridRow = '1 / span 4';
                UIElements.activitiesSection.style.position = 'sticky';
                UIElements.activitiesSection.style.height = 'calc(100vh - 2rem)';
                UIElements.activitiesSection.style.top = '1rem'; // Ensure sticky top is set
            }
            UIElements.mainLayoutContainer.dataset.layout = 'desktop';
        }
    }
    // Invalidate map size after layout change to ensure tiles load correctly
    if (mainMap) mainMap.invalidateSize();
}

/** Checks if client ID and secret inputs are filled and enables/disables the connect button. */
function checkInputs() {
    if (UIElements.connectButton && UIElements.clientId && UIElements.clientSecret) { // Ensure elements exist
        const isDisabled = !(UIElements.clientId.value.trim() && UIElements.clientSecret.value.trim());
        UIElements.connectButton.disabled = isDisabled;
    }
}
   
/** Initiates the Strava OAuth authorization flow. */
function connectToStrava() {
    const clientId = UIElements.clientId.value.trim();
    const clientSecret = UIElements.clientSecret.value.trim();

    if (!clientId || !clientSecret) {
        alert('Please enter both Client ID and Client Secret.');
        return;
    }

    localStorage.setItem('stravaClientId', clientId);
    localStorage.setItem('stravaClientSecret', clientSecret);
    const redirectUri = window.location.origin + window.location.pathname;
    window.location.href = `https://www.strava.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=read,activity:read_all,activity:write`;
}

/**
 * Exchanges the Strava authorization code for access and refresh tokens.
 * @param {string} code - The authorization code from Strava.
 */
async function getAccessToken(code) {
    log('Exchanging authorization code for token...');
    try {
        const response = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: localStorage.getItem('stravaClientId'),
                client_secret: localStorage.getItem('stravaClientSecret'),
                code, grant_type: 'authorization_code'
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Authentication failed: ${response.status} - ${errorText}`);
        }
        const data = await response.json();
        localStorage.setItem(STRAVA_ACCESS_TOKEN_KEY, JSON.stringify(data.access_token));
        localStorage.setItem(STRAVA_REFRESH_TOKEN_KEY, JSON.stringify(data.refresh_token));
        localStorage.setItem(STRAVA_EXPIRES_AT_KEY, data.expires_at.toString());
        localStorage.setItem('stravaAthlete', JSON.stringify(data.athlete));
        window.location.href = window.location.pathname; // Clean URL and reload
    } catch (error) {
        log(`Authentication failed: ${error.message}`, 'error');
        alert(`Authentication failed: ${error.message}. Please try again.`);
        resetProgress(); // Clear all data, go back to login on auth failure
    }
}
   
/** Hides the login screen and displays the main application. */
async function showMainApp() {
    log('Loading main application...');
    const athlete = JSON.parse(localStorage.getItem('stravaAthlete') || '{}');
    if (UIElements.stravaUserInfo) { // Defensive check
        if (athlete.firstname) {
            UIElements.stravaUserInfo.innerHTML = `<p class="font-semibold">${athlete.firstname} ${athlete.lastname}</p>`;
        } else {
            UIElements.stravaUserInfo.innerHTML = `<p class="font-semibold">Strava User</p>`; // Fallback
        }
    }
   
    // Initialize map and load SWCP data
    initializeMapAndData(); // This will also initiate swcpDataPromise inside
   
    await fetchAndRenderActivities();

    // Ensure loadProgressFromStorage waits for SWCP data to be loaded
    await loadProgressFromStorage();
    if (mainMap) mainMap.invalidateSize(); // Ensure map tiles load correctly
    log('Application loaded.', 'success');
}
   
/** Fetches and then renders Strava activities. */
async function fetchAndRenderActivities() {
    if (UIElements.activitiesLoadingSpinner) UIElements.activitiesLoadingSpinner.classList.remove('hidden');
    allFetchedActivities = await fetchAllActivities();
    if (UIElements.activitiesLoadingSpinner) UIElements.activitiesLoadingSpinner.classList.add('hidden');
   
    if (allFetchedActivities) {
        filterActivities();
    } else {
        log('Could not load activities from Strava or cache. Please refresh or check connection.', 'error');
    }
}

/** Initializes the Leaflet map and loads SWCP data. */
function initializeMapAndData() {
    log('Initializing map...');
   
    // Set a strict bounding box for the UK/SWCP area
    const corner1 = L.latLng(49.8, -6.0); // South-west (e.g., Land's End area)
    const corner2 = L.latLng(51.3, -1.7); // North-east (e.g., Minehead area)
    const bounds = L.latLngBounds(corner1, corner2);

    // Initialize map with maxBounds and minZoom to keep focus on SWCP
    if (!mainMap && UIElements.mainMap) { // Prevent re-initialization if already present, ensure div exists
        mainMap = L.map(UIElements.mainMap.id, { maxBounds: bounds, minZoom: 8 });
    } else if (!UIElements.mainMap) {
        log('Error: Main map container (id="map") not found. Cannot initialize map.', 'error');
        return;
    }
   
    if (mainMap) { // Only proceed if map was successfully initialized
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(mainMap);
       
        // Ensure layer group is reset or initialized
        if (completedSegmentsLayer) {
            completedSegmentsLayer.clearLayers(); // Clear old layers if re-initializing
        } else {
            completedSegmentsLayer = L.layerGroup().addTo(mainMap);
        }

        // Assign the promise from loadSwcpData() to the global variable
        swcpDataPromise = loadSwcpData();
    }
}

/** Loads the SWCP GeoJSON data and renders it on the main map. */
async function loadSwcpData() {
    log('Loading SWCP route data in background...');
    if (UIElements.mapLoadingOverlay) UIElements.mapLoadingOverlay.classList.remove('hidden');
    try {
        const response = await fetch(SWCP_GEOJSON_URL);
        if (!response.ok) {
            // Provide more detail if the fetch itself fails
            throw new Error(`HTTP error! Status: ${response.status}. Could not load ${SWCP_GEOJSON_URL}. Check if the file exists and is accessible in your deployment.`);
        }
        const data = await response.json(); // This will throw if the response is not valid JSON
       
        // --- CRITICAL FIX FOR 3D COORDINATES IN GEOJSON ---
        // Extract coordinates, ensuring only [longitude, latitude] pairs are used for Turf.js
        const allCoordinates = [];
        data.features.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates) {
                if (feature.geometry.type === 'LineString') {
                    // Map 3D coordinates to 2D [lon, lat]
                    feature.geometry.coordinates.forEach(c => allCoordinates.push([c[0], c[1]]));
                }
                else if (feature.geometry.type === 'MultiLineString') {
                    // For MultiLineString, iterate through each sub-lineString
                    feature.geometry.coordinates.forEach(subLine => {
                        subLine.forEach(c => allCoordinates.push([c[0], c[1]])); // Map 3D to 2D for each point in sub-line
                    });
                }
            }
        });

        // The filter for length === 2 is now appropriate because we explicitly extracted 2D points
        const validCoordinates = allCoordinates.filter(c =>
            Array.isArray(c) && c.length === 2 &&
            typeof c[0] === 'number' && typeof c[1] === 'number'
        );
       
        if (validCoordinates.length === 0) {
            // More specific error message if no valid line coordinates are found
            throw new Error('No valid LineString or MultiLineString features with proper 2D coordinates found within the GeoJSON data after processing.');
        }

        swcpGeoJSON = turf.lineString(validCoordinates).geometry;
        swcpTotalDistance = turf.length(swcpGeoJSON, { units: 'kilometers' });

        if (analysisWorker) {
             // Send a stringified version to the worker to ensure a clean copy
            analysisWorker.postMessage({ type: 'init_swcp', swcpGeoJSONString: JSON.stringify(swcpGeoJSON), swcpTotalDistance });
        } else {
            log('Analysis worker not initialized, cannot send SWCP data to it. Ensure worker script is loaded.', 'warn');
        }
       
        // Add the GeoJSON data to the Leaflet map
        if (mainMap) { // Ensure mainMap is initialized before adding GeoJSON
            // For Leaflet rendering, we can use the original data as Leaflet can handle 3D points
            // Or explicitly map to 2D if preferred, but original L.geoJSON usually handles it gracefully
            const leafletGeoJson = L.geoJSON(data, {
                style: { color: 'blue', weight: 3, opacity: 0.7 }
            }).addTo(mainMap);
            mainMap.fitBounds(leafletGeoJson.getBounds());
        } else {
            log('Main map not initialized, cannot render SWCP route. This is an unexpected state.', 'error');
        }
       
        if (UIElements.totalDistance) UIElements.totalDistance.textContent = swcpTotalDistance.toFixed(2);
        log('SWCP route rendered on map.', 'success');
    } catch(e) {
        log(`Failed to load SWCP map data: ${e.message}. Please check your 'routes.geojson' file and its deployment.`, 'error');
        alert(`Failed to load SWCP map data: ${e.message}.`);
    } finally {
        if (UIElements.mapLoadingOverlay) UIElements.mapLoadingOverlay.classList.add('hidden');
    }
}
   
/** Loads existing progress data from local storage and initiates re-calculation. */
async function loadProgressFromStorage() {
    // --- SHOW LOADING INDICATOR ---
    if (UIElements.overallProgressLoading) {
        UIElements.overallProgressLoading.classList.remove('hidden');
    }

    await swcpDataPromise; // Ensure SWCP data is loaded before processing points
    const completedPoints = JSON.parse(localStorage.getItem(COMPLETED_POINTS_KEY) || '[]');
    if (completedPoints.length > 0) {
        log('Calculating initial progress from stored data...');
        analysisWorker.postMessage({ type: 'process_activity', activityId: 'initial_load', activityStream: null, existingPoints: completedPoints });
    } else {
        updateProgressUI({ segments: [], totalDistance: 0, percentage: "0.00", newCompletedPoints: [] });
        log('No existing progress found.', 'info');
        // Hide indicator if no points to load
        if (UIElements.overallProgressLoading) UIElements.overallProgressLoading.classList.add('hidden');
    }
}
   
function resetProgress() {
    if (confirm("This will reset ALL data, including your Strava connection and saved progress. Are you sure? This action cannot be undone.")) {
        localStorage.clear();
        window.location.reload();
    }
}

function filterActivities() {
    if (!UIElements.activitySearchBox || !UIElements.filterButtons) return;

    const searchTerm = UIElements.activitySearchBox.value.toLowerCase();
    const activeFilterBtn = UIElements.filterButtons.querySelector('.filter-btn.active');
    const typeFilter = activeFilterBtn ? activeFilterBtn.dataset.filter : 'all';
   
    let filtered = allFetchedActivities || [];
    if (typeFilter !== 'all') {
        filtered = filtered.filter(act => act.type === typeFilter);
    }
    if (searchTerm) {
        filtered = filtered.filter(act => act.name.toLowerCase().includes(searchTerm));
    }
    renderActivityList(filtered);
}

function handleFilterClick(e) {
    if (e.target.tagName !== 'BUTTON' || !e.target.classList.contains('filter-btn')) return;
    UIElements.filterButtons.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');
    filterActivities();
}

async function refreshActivities() {
    if (!confirm("This will clear your local activity cache (and stream data) and fetch all activities from Strava again. This might take some time and count towards Strava API rate limits. Continue?")) {
        return;
    }
    localStorage.removeItem(CACHED_ACTIVITIES_KEY);
    localStorage.removeItem(CACHED_ACTIVITIES_TIMESTAMP_KEY);
    // Clear activity stream cache as well for consistency
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith(ACTIVITY_STREAMS_CACHE_PREFIX)) {
            localStorage.removeItem(key);
        }
    });

    log('Activity cache cleared. Fetching new activities from Strava...', 'info');
    await fetchAndRenderActivities();
}

function renderActivityList(activities) {
    if (!UIElements.activityListContainer) return;

    UIElements.activityListContainer.innerHTML = ''; // Clear previous list
    UIElements.activityCount.textContent = `(${activities.length} found)`;
    const processedIds = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));
   
    activities.forEach(activity => {
        const card = UIElements.activityCardTemplate.content.cloneNode(true);
        const cardDiv = card.querySelector('div');
        cardDiv.querySelector('[data-name]').textContent = activity.name;
        cardDiv.querySelector('[data-date]').textContent = new Date(activity.start_date).toLocaleDateString();
        cardDiv.querySelector('[data-type]').textContent = activity.type;
        cardDiv.querySelector('[data-distance]').innerHTML = `<strong>Distance:</strong> ${(activity.distance / 1000).toFixed(2)} km`;
        cardDiv.querySelector('[data-time]').innerHTML = `<strong>Moving Time:</strong> ${new Date(activity.moving_time * 1000).toISOString().substr(11, 8)}`;
        cardDiv.querySelector('[data-elevation]').innerHTML = `<strong>Elevation Gain:</strong> ${activity.total_elevation_gain.toFixed(0)} m`;
       
        const mapEl = card.querySelector('[data-map-id]');
        mapEl.id = `map-${activity.id}`; // Assign unique ID for Leaflet map initialization
       
        const analyzeBtn = card.querySelector('[data-analyze-btn]');
        analyzeBtn.dataset.activityId = activity.id;
       
        // --- REANALYZE FUNCTIONALITY & GREY STYLING ---
        // Remove all previous color classes to ensure clean slate
        analyzeBtn.classList.remove('btn-primary', 'btn-secondary', 'bg-gray-300', 'text-gray-700');
       
        if (processedIds.has(String(activity.id))) {
            analyzeBtn.textContent = 'Reanalyze';
            analyzeBtn.classList.add('bg-gray-300', 'text-gray-700'); // Apply grey styling
            analyzeBtn.disabled = false; // Keep it clickable
        } else {
            analyzeBtn.textContent = 'Analyze for SWCP';
            analyzeBtn.classList.add('btn-primary'); // Apply primary styling for initial analyze
            analyzeBtn.disabled = false;
        }
        analyzeBtn.onclick = () => analyzeSingleActivity(activity, analyzeBtn); // Always assign the handler

        const addDescriptionBtn = card.querySelector('[data-update-btn]');
        addDescriptionBtn.dataset.activityId = activity.id;
        addDescriptionBtn.onclick = () => addDescriptionToStrava(activity, addDescriptionBtn);

        UIElements.activityListContainer.appendChild(card);
       
        // Initialize mini-map for activity
        if (activity.map && activity.map.summary_polyline) {
            try {
                const latlngs = polyline.decode(activity.map.summary_polyline);
                if (latlngs.length > 0) {
                    const activityMap = L.map(mapEl.id, {
                        scrollWheelZoom: false,
                        attributionControl: false, // No need for attribution on mini-maps
                        zoomControl: false // Disable zoom control for smaller maps
                    }).setView(latlngs[0], 13);
                   
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(activityMap);
                    L.polyline(latlngs, {color: '#FC5200', weight: 3}).addTo(activityMap);
                   
                    // Call fitBounds on the map object, not the polyline
                    activityMap.fitBounds(latlngs);
                   
                    // Invalidate size immediately after map is likely rendered or container is sized
                    activityMap.invalidateSize();

                } else {
                    mapEl.innerHTML = '<div class="text-center text-gray-500 pt-8 text-sm">No valid polyline data for map.</div>';
                }
            } catch (e) {
                console.warn(`Failed to decode polyline for activity ${activity.id}: ${e.message}`);
                log(`Failed to render mini-map for activity ${activity.id}. Check activity data on Strava.`, 'warn');
                mapEl.innerHTML = '<div class="text-center text-gray-500 pt-8 text-sm">Map not available (decoding error).</div>';
            }
        } else {
            mapEl.innerHTML = '<div class="text-center text-gray-500 pt-8 text-sm">No GPS data for this activity.</div>';
        }
    });
}
   
/**
 * Initiates the analysis of a single Strava activity using the web worker.
 * @param {Object} activity - The Strava activity object.
 * @param {HTMLButtonElement} button - The analyze button element.
 */
async function analyzeSingleActivity(activity, button) {
    button.disabled = true;
   
    // Store original text to restore on error/completion
    const originalText = button.textContent;

    // Set up initial spinner state for the button
    button.innerHTML = '<span class="loader"></span><span class="button-text">Analyzing (0%)...</span>';
    const buttonTextSpan = button.querySelector('.button-text');

    await swcpDataPromise; // Ensure SWCP GeoJSON is loaded before starting analysis
    if (!swcpGeoJSON) {
        log('SWCP GeoJSON not available for analysis.', 'error');
        alert('SWCP map data is still loading or failed to load. Please try again in a moment.');
        button.disabled = false;
        button.innerHTML = originalText; // Revert
        return;
    }
    if (!analysisWorker) {
        log('Analysis worker is offline or failed to initialize.', 'error');
        button.disabled = false;
        button.innerHTML = originalText; // Revert
        return;
    }

    const stream = await getActivityStream(activity.id);
    if (stream === null) {
        log(`Failed to get activity stream for ${activity.id}.`, 'error');
        button.innerHTML = 'API Error';
        setTimeout(() => {
            button.disabled = false;
            button.innerHTML = originalText; // Revert
        }, 3000);
        return;
    }
    if (!stream.latlng || !stream.latlng.data || stream.latlng.data.length === 0) {
        log(`No GPS data found for activity ${activity.id}.`, 'warn');
        alert(`Could not get GPS data for activity "${activity.name}". Please check its privacy and map visibility settings on Strava.`);
        button.disabled = false;
        button.innerHTML = 'No GPS Data'; // Revert
        return;
    }
   
    const existingPoints = JSON.parse(localStorage.getItem(COMPLETED_POINTS_KEY) || '[]');
    log(`Sending activity ${activity.id} data to worker for analysis...`);
   
    // Capture the current activityId to update the specific button from the global worker handler
    const currentActivityId = String(activity.id);

    // The main analysisWorker.onmessage handler (defined in init) will now manage button updates.
    // Ensure the global handler correctly uses `document.querySelector` to find THIS specific button.
    analysisWorker.postMessage({
        type: 'process_activity',
        activityId: currentActivityId, // Pass the ID
        activityStream: stream.latlng.data,
        existingPoints: existingPoints
    });
}
   
async function getActivityStream(activityId) {
    const cacheKey = `${ACTIVITY_STREAMS_CACHE_PREFIX}${activityId}`;
    const cachedStream = localStorage.getItem(cacheKey);
    if (cachedStream) { return JSON.parse(cachedStream); }
    log(`Fetching stream for activity ${activityId} from Strava...`);
    try {
        const response = await makeStravaApiCall(`https://www.strava.com/api/v3/activities/${activityId}/streams?keys=latlng&key_by_type=true`);
        if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 429 || errorText.includes("Rate Limit Exceeded")) {
                const message = "Strava API Rate Limit Exceeded. Please wait 15 minutes and try again.";
                log(message, 'error'); alert(message); throw new Error(message);
            }
            throw new Error(`API Error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        if (data && data.latlng && data.latlng.data) {
            localStorage.setItem(cacheKey, JSON.stringify(data));
        }
        return data;
    } catch (e) {
        log(`Failed to fetch stream for ${activityId}: ${e.message}`, 'error');
        return null;
    }
}
   
async function fetchAllActivities() {
    const cachedData = localStorage.getItem(CACHED_ACTIVITIES_KEY);
    const timestamp = localStorage.getItem(CACHED_ACTIVITIES_TIMESTAMP_KEY);
    if (cachedData && timestamp && (Date.now() - timestamp < CACHE_EXPIRY_MS)) {
        let activities = JSON.parse(cachedData);
        log(`Loaded ${activities.length} total activities from cache.`, 'info');
        return activities.filter(act => ['Hike', 'Walk'].includes(act.type));
    }

    log('Fetching all activities from Strava...');
    let activities = [];
    for (let page = 1; page < 10; page++) {
        try {
            const response = await makeStravaApiCall(`https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=100`);
            if (!response) return null;
            if (!response.ok) { continue; }
            const pageActivities = await response.json();
            if (pageActivities.length === 0) break;
            activities.push(...pageActivities);
            log(`Fetched page ${page} of activities...`);
            await sleep(200);
        } catch (e) {
            log(`Error during activity fetch loop: ${e.message}`, 'error');
            return null;
        }
    }
    log(`Fetched ${activities.length} total activities from API.`);
    localStorage.setItem(CACHED_ACTIVITIES_KEY, JSON.stringify(activities));
    localStorage.setItem(CACHED_ACTIVITIES_TIMESTAMP_KEY, String(Date.now()));
   
    return activities.filter(act => ['Hike', 'Walk'].includes(act.type));
}

function updateProgressUI(payload) {
    // --- DEBUGGING LOGS ---
    console.log("updateProgressUI: Payload received:", payload);
    console.log("updateProgressUI: totalDistance (from payload):", payload.totalDistance);
    console.log("updateProgressUI: percentage (from payload):", payload.percentage);
    console.log("updateProgressUI: segments (from payload):", payload.segments);
    // --- END DEBUGGING LOGS ---

    if (!completedSegmentsLayer || !UIElements.completedDistance || !UIElements.progressPercentage || !UIElements.progressBar || !mainMap) {
        console.error('UI elements or map for progress update are not ready. Cannot update UI. Re-initializing map if possible.');
        log('Critical UI elements missing for progress update.', 'error');
        // Attempt to re-initialize map if components are missing
        if (!mainMap && UIElements.mainMap) { // Only if map not initialized but container exists
            initializeMapAndData();
            // Note: This re-init will restart the swcpDataPromise, so subsequent calls to updateProgressUI might wait again.
            // A more robust solution for large apps might be to have a dedicated map state manager.
        }
        return;
    }
    const { segments, totalDistance, percentage, newCompletedPoints } = payload; // Destructure newCompletedPoints

    completedSegmentsLayer.clearLayers();
    if (segments && segments.length > 0) {
        segments.forEach(seg => {
            const leafletCoords = seg.map(c => [c[1], c[0]]);
            L.polyline(leafletCoords, { color: '#FC5200', weight: 5, opacity: 0.8 }).addTo(completedSegmentsLayer);
        });
        log(`Rendered ${segments.length} completed segments on the map.`, 'info');
    } else {
        log('No new completed segments to render on map.', 'info');
    }

    // Ensure values are numbers before setting textContent and style.width
    UIElements.completedDistance.textContent = parseFloat(totalDistance).toFixed(2);
    UIElements.progressPercentage.textContent = `${parseFloat(percentage).toFixed(2)}%`;
    UIElements.progressBar.style.width = `${parseFloat(percentage)}%`;
    localStorage.setItem(COMPLETED_POINTS_KEY, JSON.stringify(newCompletedPoints)); // Ensure newCompletedPoints are saved
    log(`Overall progress updated: ${totalDistance.toFixed(2)} km (${parseFloat(percentage).toFixed(2)}%)`, 'success');
}
   
async function addDescriptionToStrava(activity, button) {
    button.disabled = true; button.innerHTML = `<span class="loader"></span>Adding...`;
    try {
        const responseGet = await makeStravaApiCall(`https://www.strava.com/api/v3/activities/${activity.id}`);
        if (!responseGet.ok) throw new Error(await responseGet.text());
        const fullActivity = await responseGet.json();
        const existingDescription = fullActivity.description || '';
        const newText = `I've now completed ${currentPercentage}% of the South West Coast Path! 🥾`;
        const updatedDescription = existingDescription ? `${newText}

---

${existingDescription}` : newText;
            const responsePut = await makeStravaApiCall(`https://www.strava.com/api/v3/activities/${activity.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: updatedDescription })
            });
            if (!responsePut.ok) throw new Error(await responsePut.text());
            log('Strava description updated.', 'success');
            button.textContent = 'Description Added!';
        } catch (e) {
            log(`Error updating description: ${e.message}`, 'error');
            button.textContent = 'Error';
        } finally {
            setTimeout(() => { button.textContent = 'Add to Strava Description'; button.disabled = false; }, 3000);
        }
    }
   
    const init = async () => {
        // This explicit assignment method is the most robust and prevents initialization errors.
        UIElements.clientId = document.getElementById('clientId');
        UIElements.clientSecret = document.getElementById('clientSecret');
        UIElements.connectButton = document.getElementById('connect-button');
        UIElements.configSection = document.getElementById('config-section');
        UIElements.activityListContainer = document.getElementById('activity-list-container');
        UIElements.activityCardTemplate = document.getElementById('activity-card-template');
        UIElements.activityCount = document.getElementById('activity-count');
        UIElements.filterButtons = document.getElementById('filter-buttons');
        UIElements.resetButton = document.getElementById('reset-button');
        UIElements.statusLog = document.getElementById('status-log');
        UIElements.stravaUserInfo = document.getElementById('strava-user-info');
        UIElements.progressBar = document.getElementById('progress-bar');
        UIElements.progressPercentage = document.getElementById('progress-percentage');
        UIElements.completedDistance = document.getElementById('completed-distance');
        UIElements.totalDistance = document.getElementById('total-distance');
        UIElements.mainMap = document.getElementById('map');
        UIElements.mainLayoutContainer = document.getElementById('main-layout-container');
        UIElements.loginScreenWrapper = document.getElementById('login-screen-wrapper');
        UIElements.statusLogDetails = document.getElementById('status-log-details');
        UIElements.statusLogSectionContainer = document.getElementById('status-log-section-container');
        UIElements.activitiesSection = document.getElementById('activities-section');
        UIElements.mapSection = document.getElementById('map-section');
        UIElements.activitiesLoadingSpinner = document.getElementById('activities-loading-spinner');
        UIElements.activitySearchBox = document.getElementById('activity-search-box');
        UIElements.mapLoadingOverlay = document.getElementById('map-loading-overlay');
        UIElements.refreshActivitiesBtn = document.getElementById('refresh-activities-btn');
        UIElements.headerSection = document.getElementById('header-section');
        UIElements.progressSummarySection = document.getElementById('progress-summary-section');
        UIElements.appBackground = document.getElementById('app-background');
        UIElements.initialLoadingScreen = document.getElementById('initial-loading-screen');
        // --- NEW UI ELEMENT FOR PROGRESS LOADING ---
        UIElements.overallProgressLoading = document.getElementById('overall-progress-loading');
       
        log('App initialized.');
   
        try {
            analysisWorker = new Worker('swcp_analysis_worker.js');
            log('Analysis worker initialized.', 'success');
        } catch (e) { log('Failed to initialize analysis worker.', 'error'); }
   
        UIElements.connectButton.addEventListener('click', connectToStrava);
        UIElements.resetButton.addEventListener('click', resetProgress);
        UIElements.filterButtons.addEventListener('click', handleFilterClick);
        UIElements.activitySearchBox.addEventListener('input', filterActivities);
        UIElements.refreshActivitiesBtn.addEventListener('click', refreshActivities);
        UIElements.clientId.addEventListener('input', checkInputs);
        UIElements.clientSecret.addEventListener('input', checkInputs);
       
        UIElements.clientId.value = localStorage.getItem('stravaClientId') || '';
        UIElements.clientSecret.value = localStorage.getItem('stravaClientSecret') || '';
        checkInputs();
   
        const authCode = new URLSearchParams(window.location.search).get('code');
       
        UIElements.initialLoadingScreen.classList.add('hidden');
        if (authCode) {
            UIElements.loginScreenWrapper.innerHTML = `<div class="text-center p-8"><div class="loader mr-3"></div><span class="text-gray-500 text-lg">Authenticating...</span></div>`;
            UIElements.loginScreenWrapper.classList.remove('hidden');
            await getAccessToken(authCode);
        } else if (localStorage.getItem(STRAVA_ACCESS_TOKEN_KEY)) {
            UIElements.mainLayoutContainer.classList.remove('hidden');
            await showMainApp();
        } else {
            UIElements.loginScreenWrapper.classList.remove('hidden');
        }
       
        updateGridLayout();
        window.addEventListener('resize', updateGridLayout);
    };
   
    document.addEventListener('DOMContentLoaded', init);
