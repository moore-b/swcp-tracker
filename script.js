// Constants
const SWCP_GEOJSON_URL = 'routes.geojson';
const PROCESSED_ACTIVITIES_KEY = 'swcp_processed_activities';
const COMPLETED_POINTS_KEY = 'swcp_completed_points';
const ACTIVITY_STREAMS_CACHE_PREFIX = 'swcp_activity_stream_';
const CACHED_ACTIVITIES_KEY = 'swcp_cached_activities';
const CACHED_ACTIVITIES_TIMESTAMP_KEY = 'swcp_cached_activities_timestamp';
const CACHE_EXPIRY_MS = 60 * 60 * 1000;
const BACKGROUND_IMAGE_PATH = 'background.webp';
const STRAVA_ACCESS_TOKEN_KEY = 'stravaAccessToken';
const STRAVA_REFRESH_TOKEN_KEY = 'stravaRefreshToken';
const STRAVA_EXPIRES_AT_KEY = 'stravaExpiresAt';

const UIElements = {};
let mainMap, swcpGeoJSON, swcpTotalDistance = 0, completedSegmentsLayer, currentPercentage = 0, allFetchedActivities = [];
let analysisWorker = null;
let swcpDataPromise = null;

const log = (message, type = 'info') => {
    if (!UIElements.statusLog) return;
    const now = new Date().toLocaleTimeString();
    UIElements.statusLog.innerHTML += `<p><span class="text-gray-500">${now}:</span> <span class="${type === 'error' ? 'text-red-400' : (type === 'success' ? 'text-green-400' : 'text-gray-900')}">${message}</span></p>`;
    UIElements.statusLog.scrollTop = UIElements.statusLog.scrollHeight;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function makeStravaApiCall(url, options = {}, retries = 1) {
    let accessToken = localStorage.getItem(STRAVA_ACCESS_TOKEN_KEY);
    let expiresAt = localStorage.getItem(STRAVA_EXPIRES_AT_KEY);
    
    if (accessToken && expiresAt && (Date.now() / 1000 > parseInt(expiresAt) - 300)) {
        log('Access token expired. Refreshing...', 'warn');
        const newAccessToken = await refreshAccessToken();
        if (newAccessToken) {
            accessToken = JSON.stringify(newAccessToken);
        } else {
            log('Token refresh failed. Please log in again.', 'error');
            resetProgress(); return null;
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

    if (!refreshToken || !clientId || !clientSecret) return null;

    try {
        const response = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, refresh_token: JSON.parse(refreshToken), grant_type: 'refresh_token' }),
        });
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        localStorage.setItem(STRAVA_ACCESS_TOKEN_KEY, JSON.stringify(data.access_token));
        localStorage.setItem(STRAVA_REFRESH_TOKEN_KEY, JSON.stringify(data.refresh_token));
        localStorage.setItem(STRAVA_EXPIRES_AT_KEY, data.expires_at.toString());
        log('Token refreshed successfully.', 'success');
        return data.access_token;
    } catch (error) {
        log(`Token refresh error: ${error.message}`, 'error');
        return null;
    }
}
    
function updateGridLayout() {
    if (!UIElements.mainLayoutContainer) return;
    const isMobile = window.innerWidth <= 1024;
    if (isMobile) {
        UIElements.mainLayoutContainer.style.gridTemplateColumns = '1fr';
        UIElements.mainLayoutContainer.style.gridTemplateRows = 'auto auto auto auto auto';
        UIElements.headerSection.style.gridColumn = '1'; UIElements.headerSection.style.gridRow = '1';
        UIElements.progressSummarySection.style.gridColumn = '1'; UIElements.progressSummarySection.style.gridRow = '2';
        UIElements.mapSection.style.gridColumn = '1'; UIElements.mapSection.style.gridRow = '3';
        UIElements.activitiesSection.style.gridColumn = '1'; UIElements.activitiesSection.style.gridRow = '4';
        UIElements.statusLogSectionContainer.style.gridColumn = '1'; UIElements.statusLogSectionContainer.style.gridRow = '5';
        UIElements.activitiesSection.style.position = 'static';
        UIElements.activitiesSection.style.height = 'auto';
    } else {
        UIElements.mainLayoutContainer.style.gridTemplateColumns = '2fr 1fr';
        UIElements.mainLayoutContainer.style.gridTemplateRows = 'auto auto 1fr auto';
        UIElements.headerSection.style.gridColumn = '1'; UIElements.headerSection.style.gridRow = '1';
        UIElements.progressSummarySection.style.gridColumn = '1'; UIElements.progressSummarySection.style.gridRow = '2';
        UIElements.mapSection.style.gridColumn = '1'; UIElements.mapSection.style.gridRow = '3';
        UIElements.statusLogSectionContainer.style.gridColumn = '1'; UIElements.statusLogSectionContainer.style.gridRow = '4';
        UIElements.activitiesSection.style.gridColumn = '2';
        UIElements.activitiesSection.style.gridRow = '1 / span 4';
        UIElements.activitiesSection.style.position = 'sticky';
        UIElements.activitiesSection.style.height = 'calc(100vh - 2rem)';
    }
}

function checkInputs() { 
    if (UIElements.connectButton) {
        const isDisabled = !(UIElements.clientId.value.trim() && UIElements.clientSecret.value.trim());
        UIElements.connectButton.disabled = isDisabled;
    }
}
    
function connectToStrava() {
    const clientId = UIElements.clientId.value.trim();
    const clientSecret = UIElements.clientSecret.value.trim();
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
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        localStorage.setItem(STRAVA_ACCESS_TOKEN_KEY, JSON.stringify(data.access_token));
        localStorage.setItem(STRAVA_REFRESH_TOKEN_KEY, JSON.stringify(data.refresh_token));
        localStorage.setItem(STRAVA_EXPIRES_AT_KEY, data.expires_at.toString());
        localStorage.setItem('stravaAthlete', JSON.stringify(data.athlete));
        window.location.href = window.location.pathname;
    } catch (error) {
        log(`Authentication failed: ${error.message}`, 'error');
        resetProgress();
    }
}
    
async function showMainApp() {
    log('Loading main application...');
    const athlete = JSON.parse(localStorage.getItem('stravaAthlete') || '{}');
    if (athlete.firstname) UIElements.stravaUserInfo.innerHTML = `<p class="font-semibold">${athlete.firstname} ${athlete.lastname}</p>`;
    
    initializeMapAndData();
    await fetchAndRenderActivities();

    await loadProgressFromStorage();
    if (mainMap) mainMap.invalidateSize();
    log('Application loaded.', 'success');
}
    
async function fetchAndRenderActivities() {
    UIElements.activitiesLoadingSpinner.classList.remove('hidden');
    allFetchedActivities = await fetchAllActivities();
    UIElements.activitiesLoadingSpinner.classList.add('hidden');
    if (allFetchedActivities) {
        filterActivities();
    } else {
        log('Could not load activities.', 'error');
    }
}

function initializeMapAndData() {
    log('Initializing map...');
    
    const corner1 = L.latLng(49.8, -6.0);
    const corner2 = L.latLng(51.3, -1.7);
    const bounds = L.latLngBounds(corner1, corner2);

    mainMap = L.map('map', { maxBounds: bounds, minZoom: 8 });
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(mainMap);
    completedSegmentsLayer = L.layerGroup().addTo(mainMap);
    swcpDataPromise = loadSwcpData();
}

async function loadSwcpData() {
    log('Loading SWCP route data in background...');
    UIElements.mapLoadingOverlay.classList.remove('hidden');
    try {
        const response = await fetch(SWCP_GEOJSON_URL);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();
        
        const allCoordinates = data.features.reduce((coords, feature) => {
            if (feature.geometry.type === 'LineString') { return coords.concat(feature.geometry.coordinates); } 
            else if (feature.geometry.type === 'MultiLineString') { return coords.concat(...feature.geometry.coordinates); }
            return coords;
        }, []);
        swcpGeoJSON = turf.lineString(allCoordinates).geometry;
        swcpTotalDistance = turf.length(swcpGeoJSON, { units: 'kilometers' });

        if (analysisWorker) analysisWorker.postMessage({ type: 'init_swcp', swcpGeoJSONString: JSON.stringify(swcpGeoJSON), swcpTotalDistance });
        
        const leafletGeoJson = L.geoJSON(data, { style: { color: 'blue', weight: 3, opacity: 0.7 } }).addTo(mainMap);
        mainMap.fitBounds(leafletGeoJson.getBounds());
        UIElements.totalDistance.textContent = swcpTotalDistance.toFixed(2);
        log('SWCP route rendered on map.');
    } catch(e) { 
        log(`Failed to load map data: ${e.message}`, 'error'); 
    } finally {
        UIElements.mapLoadingOverlay.classList.add('hidden');
    }
}
    
async function loadProgressFromStorage() {
    await swcpDataPromise;
    const completedPoints = JSON.parse(localStorage.getItem(COMPLETED_POINTS_KEY) || '[]');
    if (completedPoints.length > 0) {
        log('Calculating initial progress from stored data...');
        analysisWorker.postMessage({ type: 'process_activity', activityId: 'initial_load', activityStream: [], existingPoints: completedPoints });
    }
}
    
function resetProgress() {
    if (confirm("This will reset ALL data, including your Strava connection. Are you sure?")) {
        localStorage.clear();
        window.location.reload();
    }
}

function filterActivities() {
    if (!UIElements.activitySearchBox || !UIElements.filterButtons) return;
    const searchTerm = UIElements.activitySearchBox.value.toLowerCase();
    const typeFilter = UIElements.filterButtons.querySelector('.active').dataset.filter;
    
    let filtered = allFetchedActivities || [];
    if (typeFilter !== 'all') { filtered = filtered.filter(act => act.type === typeFilter); }
    if (searchTerm) { filtered = filtered.filter(act => act.name.toLowerCase().includes(searchTerm)); }
    renderActivityList(filtered);
}

function handleFilterClick(e) {
    if (e.target.tagName !== 'BUTTON') return;
    UIElements.filterButtons.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');
    filterActivities();
}

async function refreshActivities() {
    localStorage.removeItem(CACHED_ACTIVITIES_KEY);
    localStorage.removeItem(CACHED_ACTIVITIES_TIMESTAMP_KEY);
    log('Cache cleared. Fetching new activities...');
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
        
        if (processedIds.has(String(activity.id))) {
            analyzeBtn.textContent = 'Analyzed';
            analyzeBtn.disabled = true;
        } else {
            analyzeBtn.onclick = () => analyzeSingleActivity(activity, analyzeBtn);
        }
        
        const addDescriptionBtn = card.querySelector('[data-update-btn]');
        addDescriptionBtn.dataset.activityId = activity.id;
        addDescriptionBtn.onclick = () => addDescriptionToStrava(activity, addDescriptionBtn);

        UIElements.activityListContainer.appendChild(card);
        if (activity.map.summary_polyline) {
            try {
                const latlngs = polyline.decode(activity.map.summary_polyline);
                if (latlngs.length > 0) {
                    const activityMap = L.map(mapEl.id, { scrollWheelZoom: false }).setView(latlngs[0], 13);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(activityMap);
                    L.polyline(latlngs, {color: '#FC5200'}).addTo(activityMap).fitBounds();
                }
            } catch (e) { /* ignore */ }
        }
    });
}
    
async function analyzeSingleActivity(activity, button) {
    button.disabled = true;
    button.innerHTML = `<span class="loader"></span>Analyzing (0%)...`;
    
    await swcpDataPromise;
    if (!swcpGeoJSON) {
        alert('Map data is still loading or failed to load. Please try again in a moment.');
        button.disabled = false; button.textContent = 'Analyze for SWCP'; return;
    }
    if (!analysisWorker) { log('Analysis worker is offline.', 'error'); button.textContent = 'Error: Worker offline'; return; }

    const stream = await getActivityStream(activity.id);
    if (stream === null) {
        button.textContent = 'API Error';
        setTimeout(() => { button.disabled = false; button.textContent = 'Analyze for SWCP'; }, 3000);
        return;
    }
    if (!stream.latlng || !stream.latlng.data || stream.latlng.data.length === 0) {
        alert(`Could not get GPS data for this activity. Please check its privacy and map visibility settings on Strava.`);
        button.textContent = 'No GPS Data';
        return;
    }
    const existingPoints = JSON.parse(localStorage.getItem(COMPLETED_POINTS_KEY) || '[]');
    log(`Sending data to worker for analysis...`);
    analysisWorker.postMessage({
        type: 'process_activity',
        activityId: activity.id,
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
    if (!completedSegmentsLayer || !UIElements.completedDistance) {
        console.error('UI elements for progress update are not ready.');
        return;
    }
    const { segments, totalDistance, percentage, newCompletedPoints } = payload;
    
    completedSegmentsLayer.clearLayers();
    segments.forEach(seg => {
        const leafletCoords = seg.map(c => [c[1], c[0]]);
        L.polyline(leafletCoords, { color: '#FC5200', weight: 5, opacity: 0.8 }).addTo(completedSegmentsLayer);
    });

    currentPercentage = percentage;
    UIElements.completedDistance.textContent = totalDistance.toFixed(2);
    UIElements.progressPercentage.textContent = `${percentage}%`;
    UIElements.progressBar.style.width = `${percentage}%`;
    localStorage.setItem(COMPLETED_POINTS_KEY, JSON.stringify(newCompletedPoints));
}
    
async function addDescriptionToStrava(activity, button) {
    button.disabled = true; button.innerHTML = `<span class="loader"></span>Adding...`;
    try {
        const responseGet = await makeStravaApiCall(`https://www.strava.com/api/v3/activities/${activity.id}`);
        if (!responseGet.ok) throw new Error(await responseGet.text());
        const fullActivity = await responseGet.json();
        const existingDescription = fullActivity.description || '';
        const newText = `I've now completed ${currentPercentage}% of the South West Coast Path! 🥾`;
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
    
    log('App initialized.');

    try {
        analysisWorker = new Worker('swcp_analysis_worker.js');
        log('Analysis worker initialized.', 'success');
        analysisWorker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (!payload || !payload.activityId) return;
            
            const { activityId, progress, error } = payload;
            const analyzeBtn = document.querySelector(`button[data-analyze-btn][data-activity-id='${activityId}']`);
            
            if (type === 'progress' && analyzeBtn) {
                analyzeBtn.innerHTML = `<span class="loader"></span>Analyzing (${progress}%)...`;
            } else if (type === 'result') {
                log(`Received processed data for ${activityId}. Updating UI.`, 'success');
                if (activityId !== 'initial_load') {
                    if(analyzeBtn) {
                        analyzeBtn.textContent = 'Analyzed';
                        analyzeBtn.disabled = true;
                    }
                    const processedIds = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));
                    processedIds.add(activityId);
                    localStorage.setItem(PROCESSED_ACTIVITIES_KEY, JSON.stringify(Array.from(processedIds)));
                }
                updateProgressUI(payload);
            } else if (type === 'error' && analyzeBtn) {
                log(`Worker error for ${activityId}: ${error}`, 'error');
                analyzeBtn.textContent = 'Analysis Failed';
            }
        };
        analysisWorker.onerror = (e) => log(`Critical worker error: ${e.message}`, 'error');
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