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

// Define UIElements as an empty object at the top. Its properties will be populated later.
const UIElements = {};

// Global variables for map and data
let mainMap, swcpGeoJSON, swcpTotalDistance = 0, completedSegmentsLayer, currentPercentage = 0, allFetchedActivities = [];
let analysisWorker = null;
let swcpDataPromise = null;

/**
 * Logs messages to the status log UI element.
 * @param {string} message - The message to log.
 * @param {'info' | 'warn' | 'error' | 'success'} type - The type of message for styling.
 */
const log = (message, type = 'info') => {
    if (!UIElements.statusLog) {
        console.warn('Status log element not yet available in UI. Logging to console:', message);
        console.log(`[${new Date().toLocaleTimeString()}]: ${message}`);
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function makeStravaApiCall(url, options = {}, retries = 1) {
    let accessToken = localStorage.getItem(STRAVA_ACCESS_TOKEN_KEY);
    let expiresAt = localStorage.getItem(STRAVA_EXPIRES_AT_KEY);
   
    if (accessToken && expiresAt && (Date.now() / 1000 > parseInt(expiresAt) - 300)) {
        log('Access token expired or near expiry. Refreshing...', 'warn');
        const newAccessToken = await refreshAccessToken();
        if (newAccessToken) {
            accessToken = JSON.stringify(newAccessToken);
        } else {
            log('Token refresh failed. Please log in again.', 'error');
            resetProgress();
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
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After') || 5;
            log(`Strava API Rate Limit Exceeded. Retrying in ${retryAfter} seconds...`, 'warn');
            await sleep(retryAfter * 1000 + (Math.random() * 1000));
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
        throw error;
    }
}

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
    if (!UIElements.mainLayoutContainer || !UIElements.mobileHeader || !UIElements.headerSection || !UIElements.progressSummarySection || !UIElements.statusLogSectionContainer || !UIElements.mapSection || !UIElements.activitiesDrawer || !UIElements.activitiesDrawerClose) {
        console.warn('updateGridLayout: Critical UIElements for layout are not defined yet.');
        return;
    }

    const isMobile = window.innerWidth <= 1024;

    if (isMobile) {
        UIElements.mobileHeader.style.display = 'flex';
        UIElements.headerSection.style.display = 'none';
        UIElements.progressSummarySection.style.display = 'none';
        UIElements.statusLogSectionContainer.style.display = 'none';
       
        UIElements.mapSection.style.flexGrow = '1';
        UIElements.mapSection.style.height = 'auto';

        UIElements.activitiesDrawer.classList.add('fixed', 'top-0', 'right-0');
        UIElements.activitiesDrawer.classList.remove('lg:static', 'lg:block');
        UIElements.activitiesDrawer.style.width = '85%';
        UIElements.activitiesDrawer.style.maxWidth = '380px';
        UIElements.activitiesDrawer.style.height = '100vh';
        UIElements.activitiesDrawer.style.boxShadow = '-4px 0 15px rgba(0,0,0,0.2)';
        UIElements.activitiesDrawer.style.transform = 'translateX(100%)';
        UIElements.activitiesDrawer.style.transition = 'transform 0.3s ease-out';
        UIElements.activitiesDrawer.style.zIndex = '30';
        UIElements.activitiesDrawer.style.overflowY = 'auto';
        UIElements.activitiesDrawer.style.padding = '1rem';
        UIElements.activitiesDrawer.style.borderRadius = '0';
        UIElements.activitiesDrawerClose.style.display = 'block';
       
        UIElements.mainLayoutContainer.style.display = 'flex';
        UIElements.mainLayoutContainer.style.flexDirection = 'column';
        UIElements.mainLayoutContainer.style.padding = '0';
        UIElements.mainLayoutContainer.style.minHeight = '100vh';
        UIElements.mainLayoutContainer.style.position = 'relative';

    } else {
        UIElements.mobileHeader.style.display = 'none';
        UIElements.headerSection.style.display = 'block';
        UIElements.progressSummarySection.style.display = 'block';
        UIElements.statusLogSectionContainer.style.display = 'block';

        UIElements.mapSection.style.flexGrow = 'unset';
        UIElements.mapSection.style.height = '700px';
        UIElements.mapSection.style.padding = '1.5rem';

        UIElements.activitiesDrawer.classList.remove('fixed', 'top-0', 'right-0', 'open');
        UIElements.activitiesDrawer.classList.add('lg:static', 'lg:block');
        UIElements.activitiesDrawer.style.width = 'auto';
        UIElements.activitiesDrawer.style.maxWidth = 'unset';
        UIElements.activitiesDrawer.style.height = 'calc(100vh - 2rem)';
        UIElements.activitiesDrawer.style.boxShadow = '0 12px 20px -3px rgba(0, 0, 0, 0.1), 0 6px 10px -2px rgba(0, 0, 0, 0.05)';
        UIElements.activitiesDrawer.style.transform = 'translateX(0)';
        UIElements.activitiesDrawer.style.transition = 'none';
        UIElements.activitiesDrawer.style.zIndex = 'auto';
        UIElements.activitiesDrawer.style.overflowY = 'auto';
        UIElements.activitiesDrawer.style.padding = '1.5rem';
        UIElements.activitiesDrawer.style.borderRadius = '0.5rem';
        UIElements.activitiesDrawerClose.style.display = 'none';

        UIElements.mainLayoutContainer.style.display = 'grid';
        UIElements.mainLayoutContainer.style.gridTemplateColumns = '2fr 1fr';
        UIElements.mainLayoutContainer.style.gridTemplateRows = 'auto auto 1fr auto';
        UIElements.mainLayoutContainer.style.gap = '1rem';
        UIElements.mainLayoutContainer.style.padding = '1rem';
        UIElements.mainLayoutContainer.style.minHeight = '100vh';
        UIElements.mainLayoutContainer.style.position = 'static';
    }
   
    if (mainMap) mainMap.invalidateSize();
}


function checkInputs() {
    if (UIElements.connectButton && UIElements.clientId && UIElements.clientSecret) {
        const isDisabled = !(UIElements.clientId.value.trim() && UIElements.clientSecret.value.trim());
        UIElements.connectButton.disabled = isDisabled;
    }
}
   
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
        window.location.href = window.location.pathname;
    } catch (error) {
        log(`Authentication failed: ${error.message}`, 'error');
        alert(`Authentication failed: ${error.message}. Please try again.`);
        resetProgress();
    }
}
   
async function showMainApp() {
    log('Loading main application...');
    const athlete = JSON.parse(localStorage.getItem('stravaAthlete') || '{}');
    if (UIElements.stravaUserInfo) {
        if (athlete.firstname) {
            UIElements.stravaUserInfo.innerHTML = `<p class="font-semibold">${athlete.firstname} ${athlete.lastname}</p>`;
        } else {
            UIElements.stravaUserInfo.innerHTML = `<p class="font-semibold">Strava User</p>`;
        }
    }
   
    initializeMapAndData();
    await fetchAndRenderActivities();

    await loadProgressFromStorage();
    if (mainMap) mainMap.invalidateSize();
    log('Application loaded.', 'success');
}
   
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

function initializeMapAndData() {
    log('Initializing map...');
   
    const corner1 = L.latLng(49.8, -6.0);
    const corner2 = L.latLng(51.3, -1.7);
    const bounds = L.latLngBounds(corner1, corner2);

    if (!mainMap && UIElements.mainMap) {
        mainMap = L.map(UIElements.mainMap.id, { maxBounds: bounds, minZoom: 8 });
    } else if (!UIElements.mainMap) {
        log('Error: Main map container (id="map") not found. Cannot initialize map.', 'error');
        return;
    }
   
    if (mainMap) {
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(mainMap);
       
        if (completedSegmentsLayer) {
            completedSegmentsLayer.clearLayers();
        } else {
            completedSegmentsLayer = L.layerGroup().addTo(mainMap);
        }

        swcpDataPromise = loadSwcpData();
    }
}

async function loadSwcpData() {
    log('Loading SWCP route data in background...');
    if (UIElements.mapLoadingOverlay) UIElements.mapLoadingOverlay.classList.remove('hidden');
    try {
        const response = await fetch(SWCP_GEOJSON_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}. Could not load ${SWCP_GEOJSON_URL}. Check if the file exists and is accessible in your deployment.`);
        }
        const data = await response.json();
       
        const allCoordinates = [];
        data.features.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates) {
                if (feature.geometry.type === 'LineString') {
                    feature.geometry.coordinates.forEach(c => allCoordinates.push([c[0], c[1]]));
                }
                else if (feature.geometry.type === 'MultiLineString') {
                    feature.geometry.coordinates.forEach(subLine => {
                        subLine.forEach(c => allCoordinates.push([c[0], c[1]]));
                    });
                }
            }
        });

        const validCoordinates = allCoordinates.filter(c =>
            Array.isArray(c) && c.length === 2 &&
            typeof c[0] === 'number' && typeof c[1] === 'number'
        );
       
        if (validCoordinates.length === 0) {
            throw new Error('No valid LineString or MultiLineString features with proper 2D coordinates found within the GeoJSON data after processing.');
        }

        swcpGeoJSON = turf.lineString(validCoordinates).geometry;
        swcpTotalDistance = turf.length(swcpGeoJSON, { units: 'kilometers' });

        if (analysisWorker) {
            analysisWorker.postMessage({ type: 'init_swcp', swcpGeoJSONString: JSON.stringify(swcpGeoJSON), swcpTotalDistance });
        } else {
            log('Analysis worker not initialized, cannot send SWCP data to it. Ensure worker script is loaded.', 'warn');
        }
       
        if (mainMap) {
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
   
async function loadProgressFromStorage() {
    if (UIElements.overallProgressLoading) {
        UIElements.overallProgressLoading.classList.remove('hidden');
    }

    await swcpDataPromise;
    const completedPoints = JSON.parse(localStorage.getItem(COMPLETED_POINTS_KEY) || '[]');
    if (completedPoints.length > 0) {
        log('Calculating initial progress from stored data...');
        analysisWorker.postMessage({ type: 'process_activity', activityId: 'initial_load', activityStream: null, existingPoints: completedPoints });
    } else {
        updateProgressUI({ segments: [], totalDistance: 0, percentage: "0.00", newCompletedPoints: [] });
        log('No existing progress found. Overall progress set to 0.', 'info');
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

    UIElements.activityListContainer.innerHTML = '';
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
        mapEl.id = `map-${activity.id}`;
        const analyzeBtn = card.querySelector('[data-analyze-btn]');
        analyzeBtn.dataset.activityId = activity.id;
       
        analyzeBtn.classList.remove('btn-primary', 'btn-secondary', 'bg-gray-300', 'text-gray-700');
       
        if (processedIds.has(String(activity.id))) {
            analyzeBtn.textContent = 'Reanalyze';
            analyzeBtn.classList.add('bg-gray-300', 'text-gray-700');
            analyzeBtn.disabled = false;
        } else {
            analyzeBtn.textContent = 'Analyze for SWCP';
            analyzeBtn.classList.add('btn-primary');
            analyzeBtn.disabled = false;
        }
        analyzeBtn.onclick = () => analyzeSingleActivity(activity, analyzeBtn);
       
        const addDescriptionBtn = card.querySelector('[data-update-btn]');
        addDescriptionBtn.dataset.activityId = activity.id;
        addDescriptionBtn.onclick = () => addDescriptionToStrava(activity, addDescriptionBtn);

        UIElements.activityListContainer.appendChild(card);
       
        if (activity.map && activity.map.summary_polyline) {
            try {
                const latlngs = polyline.decode(activity.map.summary_polyline);
                if (latlngs.length > 0) {
                    const activityMap = L.map(mapEl.id, {
                        scrollWheelZoom: false,
                        attributionControl: false,
                        zoomControl: false
                    }).setView(latlngs[0], 13);
                   
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(activityMap);
                    L.polyline(latlngs, {color: '#FC5200', weight: 3}).addTo(activityMap);
                   
                    activityMap.fitBounds(latlngs);
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
   
    const originalText = button.textContent;

    button.innerHTML = '<span class="loader"></span><span class="button-text">Analyzing (0%)...</span>';
    const buttonTextSpan = button.querySelector('.button-text');

    await swcpDataPromise;
    if (!swcpGeoJSON) {
        log('SWCP GeoJSON not available for analysis.', 'error');
        alert('SWCP map data is still loading or failed to load. Please try again in a moment.');
        button.disabled = false;
        button.innerHTML = originalText;
        return;
    }
    if (!analysisWorker) {
        log('Analysis worker is offline or failed to initialize.', 'error');
        button.disabled = false;
        button.innerHTML = originalText;
        return;
    }

    const stream = await getActivityStream(activity.id);
    if (stream === null) {
        log(`Failed to get activity stream for ${activity.id}.`, 'error');
        button.innerHTML = 'API Error';
        setTimeout(() => {
            button.disabled = false;
            button.innerHTML = originalText;
        }, 3000);
        return;
    }
    if (!stream.latlng || !stream.latlng.data || stream.latlng.data.length === 0) {
        log(`No GPS data found for activity ${activity.id}.`, 'warn');
        alert(`Could not get GPS data for activity "${activity.name}". Please check its privacy and map visibility settings on Strava.`);
        button.disabled = false;
        button.innerHTML = 'No GPS Data';
        return;
    }
   
    const existingPoints = JSON.parse(localStorage.getItem(COMPLETED_POINTS_KEY) || '[]');
    log(`Sending activity ${activity.id} data to worker for analysis...`);
   
    const currentActivityId = String(activity.id);

    analysisWorker.postMessage({
        type: 'process_activity',
        activityId: currentActivityId,
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
    }
    catch (e) {
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
    console.log("updateProgressUI: Payload received:", payload);
    console.log("updateProgressUI: totalDistance (from payload):", payload.totalDistance);
    console.log("updateProgressUI: percentage (from payload):", payload.percentage);
    console.log("updateProgressUI: segments (from payload):", payload.segments);

    if (!completedSegmentsLayer || !UIElements.completedDistance || !UIElements.progressPercentage || !UIElements.progressBar || !mainMap) {
        console.error('updateProgressUI: Critical UI elements or map for progress update are not ready. Cannot update UI.');
        log('Critical UI elements missing for progress update.', 'error');
        if (!mainMap && UIElements.mainMap) {
            initializeMapAndData();
        }
        return;
    }
    const { segments, totalDistance, percentage, newCompletedPoints } = payload;

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

    UIElements.completedDistance.textContent = parseFloat(totalDistance).toFixed(2);
    UIElements.progressPercentage.textContent = `${parseFloat(percentage).toFixed(2)}%`;
    UIElements.progressBar.style.width = `${parseFloat(percentage)}%`;
   
    currentPercentage = parseFloat(percentage);

    if (newCompletedPoints) {
        localStorage.setItem(COMPLETED_POINTS_KEY, JSON.stringify(newCompletedPoints));
        console.log("updateProgressUI: Saved newCompletedPoints to localStorage:", newCompletedPoints.length);
    } else {
        console.warn("updateProgressUI: newCompletedPoints was null or undefined in payload. Not saving to localStorage.");
    }

    log(`Overall progress updated: ${totalDistance.toFixed(2)} km (${parseFloat(percentage).toFixed(2)}%)`, 'success');
}
   
async function addDescriptionToStrava(activity, button) {
    button.disabled = true; button.innerHTML = `<span class="loader"></span>Adding...`;
    try {
        const responseGet = await makeStravaApiCall(`https://www.strava.com/api/v3/activities/${activity.id}`);
        if (!responseGet.ok) throw new Error(await responseGet.text());
        const fullActivity = await responseGet.json();
        const existingDescription = fullActivity.description || '';
       
        const totalKilometersWalked = UIElements.completedDistance ? parseFloat(UIElements.completedDistance.textContent) : 0;
        const totalPathDistance = UIElements.totalDistance ? parseFloat(UIElements.totalDistance.textContent) : 0;

        const emojiCliffCoast = '🌊';
        const emojiHikingBoot = '🥾';

        const newTextLine1 = `${currentPercentage.toFixed(2)}% of the South West Coast Path completed! ${emojiCliffCoast}`;
        const newTextLine2 = `${totalKilometersWalked.toFixed(2)} out of ${totalPathDistance.toFixed(2)} kilometres walked ${emojiHikingBoot}`;
       
        const newText = `${newTextLine1}\n${newTextLine2}`;

        const updatedDescription = existingDescription ? `${newText}\n\n---\n\n${existingDescription}` : newText;

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
    // --- CRITICAL FIX: Initialize all UIElements properties immediately ---
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
    UIElements.overallProgressLoading = document.getElementById('overall-progress-loading');

    log('Application initialization started.');
   
    try {
        analysisWorker = new Worker('swcp_analysis_worker.js');
        log('Analysis worker initialized.', 'success');
       
        analysisWorker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (!payload || !payload.activityId) return;
           
            const { activityId, progress, error } = payload;
            const analyzeBtn = document.querySelector(`button[data-analyze-btn][data-activity-id='${activityId}']`);
           
            if (type === 'progress') {
                if (analyzeBtn) {
                    const buttonTextSpan = analyzeBtn.querySelector('.button-text');
                    if (buttonTextSpan) {
                        buttonTextSpan.textContent = `Analyzing (${progress}%)...`;
                    }
                }
            } else if (type === 'result') {
                log(`Analysis complete for activity ${activityId}. Updating UI.`, 'success');
                console.log("Worker Result Payload (Result):", payload);

                if (activityId !== 'initial_load') {
                    if(analyzeBtn) {
                        analyzeBtn.textContent = 'Reanalyze';
                        analyzeBtn.classList.remove('btn-primary', 'btn-secondary');
                        analyzeBtn.classList.add('bg-gray-300', 'text-gray-700');
                        analyzeBtn.disabled = false;
                        const loaderSpan = analyzeBtn.querySelector('.loader');
                        if(loaderSpan) loaderSpan.remove();
                    }
                    const processedIds = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));
                    processedIds.add(activityId);
                    localStorage.setItem(PROCESSED_ACTIVITIES_KEY, JSON.stringify(Array.from(processedIds)));
                } else {
                    if (UIElements.overallProgressLoading) {
                        UIElements.overallProgressLoading.classList.add('hidden');
                    }
                }
                updateProgressUI(payload);
            } else if (type === 'error') {
                log(`Worker error for ${activityId}: ${error}`, 'error');
                if (analyzeBtn) {
                    analyzeBtn.textContent = 'Analysis Failed';
                    analyzeBtn.disabled = false;
                    const loaderSpan = analyzeBtn.querySelector('.loader');
                    if(loaderSpan) loaderSpan.remove();
                }
                alert(`Analysis failed for activity ${activityId}: ${error}. Check console for details.`);
                if (activityId === 'initial_load' && UIElements.overallProgressLoading) {
                    UIElements.overallProgressLoading.classList.add('hidden');
                }
            }
        };

        analysisWorker.onerror = (e) => {
            log(`Critical worker error: ${e.message || 'Unknown worker error'}`, 'error');
            alert(`A critical error occurred with the analysis worker: ${e.message || 'Check console for details'}. Please refresh the page.`);
            if (UIElements.overallProgressLoading) {
                UIElements.overallProgressLoading.classList.add('hidden');
            }
        };
    } catch (e) {
        log(`Failed to initialize analysis worker: ${e.message}`, 'error');
        alert('Failed to load background analysis. Progress tracking might not work. Check console for "swcp_analysis_worker.js" errors.');
        if (UIElements.overallProgressLoading) {
            UIElements.overallProgressLoading.classList.add('hidden');
        }
    }

    // Event Listeners
    UIElements.connectButton.addEventListener('click', connectToStrava);
    UIElements.resetButton.addEventListener('click', resetProgress);
    UIElements.filterButtons.addEventListener('click', handleFilterClick);
    UIElements.activitySearchBox.addEventListener('input', filterActivities);
    UIElements.refreshActivitiesBtn.addEventListener('click', refreshActivities);
    UIElements.clientId.addEventListener('input', checkInputs);
    UIElements.clientSecret.addEventListener('input', checkInputs);
    window.addEventListener('resize', updateGridLayout);

    // Populate input fields from local storage (if available)
    UIElements.clientId.value = localStorage.getItem('stravaClientId') || '';
    UIElements.clientSecret.value = localStorage.getItem('stravaClientSecret') || '';
    checkInputs();

    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    const authError = urlParams.get('error');

    UIElements.initialLoadingScreen.classList.add('hidden');

    if (authError) {
        log(`Strava OAuth Error: ${authError}. Please try connecting again.`, 'error');
        alert(`Strava connection failed: ${authError}`);
        UIElements.loginScreenWrapper.classList.remove('hidden');
    } else if (localStorage.getItem(STRAVA_ACCESS_TOKEN_KEY)) {
        UIElements.mainLayoutContainer.classList.remove('hidden');
        await showMainApp();
    } else {
        UIElements.loginScreenWrapper.classList.remove('hidden');
    }
   
    updateGridLayout();
};

document.addEventListener('DOMContentLoaded', init);
