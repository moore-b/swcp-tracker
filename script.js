// Firebase Progress Service Integration
let firebaseProgressService = null;

// Constants
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
const DARK_MODE_KEY = 'swcp_dark_mode';

// === PHASE 1: PARALLEL LOADING FEATURE FLAGS ===
const OPTIMIZATION_FEATURES = {
    parallelLoading: false,     // EMERGENCY: Disabled until fixed
    enhancedLogging: false,     // EMERGENCY: Disabled until fixed  
    loadingStates: false,       // EMERGENCY: Disabled until fixed
    optimizedProgress: false,   // EMERGENCY: Disabled until fixed
    // Future phases (disabled for now):
    databaseProgress: false,    // Phase 2
    databaseActivities: false,  // Phase 3
    databaseMap: false,         // Phase 4
    precomputedAnalysis: false  // Phase 5
};

// --- CRITICAL FIX: Define UIElements as an empty object at the top ---
const UIElements = {};

// Global variables for map and data
// currentPercentage is critical here, ensure it's always up-to-date from updateProgressUI
let mainMap, swcpGeoJSON, swcpTotalDistance = 0, completedSegmentsLayer, currentPercentage = 0, allFetchedActivities = [];
let analysisWorker = null;
let swcpDataPromise = null; // Will store the promise for loading SWCP data
let isDarkMode = false;
let fabMenuOpen = false;
let mobileMenuOpen = false;

// Debounced search function for better performance
let searchTimeout;

/**
 * Logs messages to the status log UI element.
 * @param {string} message - The message to log.
 * @param {'info' | 'warn' | 'error' | 'success'} type - The type of message for styling.
 */
const log = (message, type = 'info') => {
    // This check ensures logs don't fail if UIElements.statusLog hasn't been assigned an element yet.
    if (!UIElements.statusLog) {
        // Fallback to console.log if the UI log element isn't ready
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

/**
 * Simple async delay function.
 * @param {number} ms - Milliseconds to wait.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Enhanced logging with performance timing for optimization tracking
 * @param {string} message - The message to log
 * @param {'info' | 'warn' | 'error' | 'success' | 'perf'} type - The type of message
 * @param {number} startTime - Optional start time for performance measurement
 */
const enhancedLog = (message, type = 'info', startTime = null) => {
    if (!OPTIMIZATION_FEATURES.enhancedLogging) {
        return log(message, type); // Fall back to regular log
    }
    
    let perfMessage = message;
    if (startTime && type === 'perf') {
        const duration = Date.now() - startTime;
        perfMessage = `${message} (${duration}ms)`;
        console.log(`⚡ PERFORMANCE: ${perfMessage}`);
    }
    
    log(perfMessage, type);
};

/**
 * Show loading state indicators across the UI
 */
function showLoadingState() {
    if (!OPTIMIZATION_FEATURES.loadingStates) return;
    
    const startTime = Date.now();
    
    // Show main loading overlay if available - use fallback DOM query
    const initialLoadingScreen = UIElements.initialLoadingScreen || document.getElementById('initial-loading-screen');
    if (initialLoadingScreen) {
        initialLoadingScreen.classList.remove('hidden');
    }
    
    // Show map loading overlay - use fallback DOM query
    const mapLoadingOverlay = UIElements.mapLoadingOverlay || document.getElementById('map-loading-overlay');
    if (mapLoadingOverlay) {
        mapLoadingOverlay.classList.remove('hidden');
    }
    
    // Show activities loading spinner - use fallback DOM query
    const activitiesLoadingSpinner = UIElements.activitiesLoadingSpinner || document.getElementById('activities-loading-spinner');
    if (activitiesLoadingSpinner) {
        activitiesLoadingSpinner.classList.remove('hidden');
    }
    
    enhancedLog('Loading state indicators activated', 'perf', startTime);
}

/**
 * Hide loading state indicators across the UI
 */
function hideLoadingState() {
    if (!OPTIMIZATION_FEATURES.loadingStates) return;
    
    const startTime = Date.now();
    
    // Hide main loading overlay - use fallback DOM query
    const initialLoadingScreen = UIElements.initialLoadingScreen || document.getElementById('initial-loading-screen');
    if (initialLoadingScreen) {
        initialLoadingScreen.classList.add('hidden');
    }
    
    // Hide map loading overlay - use fallback DOM query
    const mapLoadingOverlay = UIElements.mapLoadingOverlay || document.getElementById('map-loading-overlay');
    if (mapLoadingOverlay) {
        mapLoadingOverlay.classList.add('hidden');
    }
    
    // Hide activities loading spinner - use fallback DOM query
    const activitiesLoadingSpinner = UIElements.activitiesLoadingSpinner || document.getElementById('activities-loading-spinner');
    if (activitiesLoadingSpinner) {
        activitiesLoadingSpinner.classList.add('hidden');
    }
    
    enhancedLog('Loading state indicators hidden', 'perf', startTime);
}

/**
 * Optimized progress loading that doesn't block on SWCP data
 * This allows progress to start loading in parallel with other operations
 */
async function loadProgressFromStorageOptimized() {
    if (!OPTIMIZATION_FEATURES.optimizedProgress) {
        // Fall back to original function
        return loadProgressFromStorage();
    }
    
    const startTime = Date.now();
    enhancedLog('Starting optimized progress loading...', 'info');
    
    try {
        // Get completed points immediately without waiting for SWCP data
        const completedPoints = JSON.parse(localStorage.getItem(COMPLETED_POINTS_KEY) || '[]');
        
        if (completedPoints.length === 0) {
            // No points to process, show 0 immediately
            updateProgressUI({ 
                segments: [], 
                totalDistance: 0, 
                percentage: "0.00", 
                newCompletedPoints: [] 
            });
            enhancedLog('No existing progress found, set to 0%', 'info');
            enhancedLog('Optimized progress loading completed', 'perf', startTime);
            return;
        }
        
        // We have points but need SWCP data for processing
        enhancedLog(`Found ${completedPoints.length} stored progress points, waiting for SWCP data...`, 'info');
        
        // Wait for SWCP data to be ready (this runs in parallel with other operations)
        await swcpDataPromise;
        
        if (!analysisWorker) {
            enhancedLog('Analysis worker not ready, falling back to zero progress', 'warn');
            updateProgressUI({ 
                segments: [], 
                totalDistance: 0, 
                percentage: "0.00", 
                newCompletedPoints: [] 
            });
            return;
        }
        
        // Process the stored points
        enhancedLog('SWCP data ready, processing stored progress points...', 'info');
        analysisWorker.postMessage({ 
            type: 'process_activity', 
            activityId: 'initial_load', 
            activityStream: null, 
            existingPoints: completedPoints 
        });
        
        enhancedLog('Optimized progress loading initiated', 'perf', startTime);
        
    } catch (error) {
        enhancedLog(`Optimized progress loading failed: ${error.message}`, 'error');
        // Fall back to original method
        return loadProgressFromStorage();
    }
}

/**
 * Makes an authenticated call to the Strava API, with token refresh and retry logic.
 * @param {string} url - The API endpoint URL.
 * @param {RequestInit} options = {} - Fetch options.
 * @param {number} retries = 1 - Number of retries for 401 errors (for token refresh).
 * @returns {Promise<Response|null>} The fetch response or null on critical failure.
 */
async function makeStravaApiCall(url, options = {}, retries = 1) {
    // Get tokens fresh each time to ensure user-specific data
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

    // Robustly extract token string regardless of storage format
    let tokenStr = '';
    if (accessToken) {
        try { tokenStr = JSON.parse(accessToken); }
        catch (e) { tokenStr = accessToken; }
    }
    options.headers = { ...options.headers, 'Authorization': `Bearer ${tokenStr}` };

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
    
    // Try global credentials first (from Firebase), then fall back to localStorage
    const clientId = window.STRAVA_CLIENT_ID || localStorage.getItem('stravaClientId');
    const clientSecret = window.STRAVA_CLIENT_SECRET || localStorage.getItem('stravaClientSecret');

    if (!refreshToken) {
        log('No refresh token found. Please connect your Strava account first.', 'error');
        return null;
    }
    
    if (!clientId || !clientSecret) {
        log('Strava API credentials not found. Please set up credentials first by opening setup-strava-credentials.html', 'error');
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

/**
 * Fetches the athlete profile from Strava and caches it in localStorage.
 * Uses makeStravaApiCall so it benefits from token refresh logic.
 * @returns {Promise<object|null>} Parsed athlete object or null on failure.
 */
async function refreshAthleteInfo() {
    try {
        const response = await makeStravaApiCall('https://www.strava.com/api/v3/athlete');
        if (!response || !response.ok) {
            console.warn('Failed to fetch athlete profile', response?.status);
            return null;
        }
        const athlete = await response.json();
        // Cache using both legacy and current keys for compatibility
        localStorage.setItem('stravaAthlete', JSON.stringify(athlete));
        localStorage.setItem('strava_athlete', JSON.stringify(athlete));
        return athlete;
    } catch (err) {
        console.warn('Error refreshing athlete info:', err);
        return null;
    }
}

/**
 * Toggles dark mode and saves preference to localStorage
 */
function toggleDarkMode() {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('dark-mode', isDarkMode);
    localStorage.setItem(DARK_MODE_KEY, isDarkMode.toString());
    // Persist preference to Firebase profile if available
    try {
        if (window.authController && window.authController.userManager && typeof window.authController.userManager.updatePreferences === 'function') {
            window.authController.userManager.updatePreferences({ darkMode: isDarkMode });
        }
    } catch (e) {
        console.warn('Could not save dark mode preference to Firebase:', e);
    }
    updateDarkModeToggle();
    
    // Remove focus from the button to prevent hover effect from sticking
    if (UIElements.darkModeToggle) {
        UIElements.darkModeToggle.blur();
    }
}

function updateDarkModeToggle() {
    if (UIElements.darkModeToggle) {
        // Remove existing SVG
        const oldSvg = UIElements.darkModeToggle.querySelector('svg');
        if (oldSvg) oldSvg.remove();
        let svgHtml = '';
        if (isDarkMode) {
            // Moon icon (Dark Mode)
            svgHtml = `
<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M13.3986 7.64605C13.495 7.37724 13.88 7.37724 13.9764 7.64605L14.2401 8.38111C14.271 8.46715 14.3395 8.53484 14.4266 8.56533L15.1709 8.82579C15.443 8.92103 15.443 9.30119 15.1709 9.39644L14.4266 9.65689C14.3395 9.68738 14.271 9.75507 14.2401 9.84112L13.9764 10.5762C13.88 10.845 13.495 10.845 13.3986 10.5762L13.1349 9.84112C13.104 9.75507 13.0355 9.68738 12.9484 9.65689L12.2041 9.39644C11.932 9.30119 11.932 8.92103 12.2041 8.82579L12.9484 8.56533C13.0355 8.53484 13.104 8.46715 13.1349 8.38111L13.3986 7.64605Z" fill="white"/>
<path d="M16.3074 10.9122C16.3717 10.733 16.6283 10.733 16.6926 10.9122L16.8684 11.4022C16.889 11.4596 16.9347 11.5047 16.9928 11.525L17.4889 11.6987C17.6704 11.7622 17.6704 12.0156 17.4889 12.0791L16.9928 12.2527C16.9347 12.2731 16.889 12.3182 16.8684 12.3756L16.6926 12.8656C16.6283 13.0448 16.3717 13.0448 16.3074 12.8656L16.1316 12.3756C16.111 12.3182 16.0653 12.2731 16.0072 12.2527L15.5111 12.0791C15.3296 12.0156 15.3296 11.7622 15.5111 11.6987L16.0072 11.525C16.0653 11.5047 16.111 11.4596 16.1316 11.4022L16.3074 10.9122Z" fill="white"/>
<path d="M17.7693 3.29184C17.9089 2.90272 18.4661 2.90272 18.6057 3.29184L19.0842 4.62551C19.1288 4.75006 19.2281 4.84805 19.3542 4.89219L20.7045 5.36475C21.0985 5.50263 21.0985 6.05293 20.7045 6.19081L19.3542 6.66337C19.2281 6.7075 19.1288 6.80549 19.0842 6.93005L18.6057 8.26372C18.4661 8.65284 17.9089 8.65284 17.7693 8.26372L17.2908 6.93005C17.2462 6.80549 17.1469 6.7075 17.0208 6.66337L15.6705 6.19081C15.2765 6.05293 15.2765 5.50263 15.6705 5.36475L17.0208 4.89219C17.1469 4.84805 17.2462 4.75006 17.2908 4.62551L17.7693 3.29184Z" fill="white"/>
<path d="M3 13.4597C3 17.6241 6.4742 21 10.7598 21C14.0591 21 16.8774 18.9993 18 16.1783C17.1109 16.5841 16.1181 16.8109 15.0709 16.8109C11.2614 16.8109 8.17323 13.8101 8.17323 10.1084C8.17323 8.56025 8.71338 7.13471 9.62054 6C5.87502 6.5355 3 9.67132 3 13.4597Z" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
        } else {
            // Sun icon (Light Mode)
            svgHtml = `
<svg width="28" height="28" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M15.5 7.5H12.949a4.94 4.94 0 0 0-1.1-2.647l1.8-1.8a.5.5 0 1 0-.707-.707l-1.8 1.8A4.947 4.947 0 0 0 8.5 3.051V.5a.5.5 0 0 0-1 0V3.051a4.947 4.947 0 0 0-2.646 1.095l-1.8-1.8a.5.5 0 1 0-.707.707l1.8 1.8a4.94 4.94 0 0 0-1.1 2.647H.5a.5.5 0 0 0 0 1h2.551a4.94 4.94 0 0 0 1.1 2.647l-1.8 1.8a.5.5 0 1 0 .707.707l1.8-1.8a4.947 4.947 0 0 0 2.646 1.1V15.5a.5.5 0 0 0 1 0V12.949a4.947 4.947 0 0 0 2.646-1.1l1.8 1.8a.5.5 0 1 0 .707-.707l-1.8-1.8a4.94 4.94 0 0 0 1.1-2.647H15.5a.5.5 0 0 0 0-1ZM8 12a4 4 0 1 1 4-4 4 4 0 0 1-4 4Zm6-6.5a.5.5 0 1 1 .5.5.5.5 0 0 1-.5-.5Zm1 5a.5.5 0 1 1-.5-.5.5.5 0 0 1 .5.5Zm-14-5a.5.5 0 1 1 .5.5.5.5 0 0 1-.5-.5Zm1 5a.5.5 0 1 1-.5-.5.5.5 0 0 1 .5.5Zm9 4a.5.5 0 1 1-.5-.5.5.5 0 0 1 .5.5Zm-5 0a.5.5 0 1 1-.5-.5.5.5 0 0 1 .5.5Zm4-13a.5.5 0 1 1 .5.5.5.5 0 0 1-.5-.5Zm-5 0a.5.5 0 1 1 .5.5.5.5 0 0 1-.5-.5Z" fill="white"/>
</svg>
`;
        }
        UIElements.darkModeToggle.insertAdjacentHTML('afterbegin', svgHtml);
    }
}

/**
 * Toggles the floating action button menu
 */
function toggleFabMenu() {
    fabMenuOpen = !fabMenuOpen;
    const fabMenu = document.getElementById('fab-menu');
    if (fabMenu) {
        fabMenu.classList.toggle('show', fabMenuOpen);
        fabMenu.classList.toggle('hidden', !fabMenuOpen);
    }
}

/**
 * Toggles the mobile filter menu
 */
function toggleMobileMenu() {
    mobileMenuOpen = !mobileMenuOpen;
    const mobileMenu = document.getElementById('mobile-filter-menu');
    if (mobileMenu) {
        mobileMenu.classList.toggle('show', mobileMenuOpen);
        mobileMenu.classList.toggle('hidden', !mobileMenuOpen);
    }
}

/**
 * Shows the bottom sheet with activity details on mobile
 */
function showBottomSheet(activityCard) {
    const bottomSheet = document.getElementById('bottom-sheet');
    const content = document.getElementById('bottom-sheet-content');
    
    if (bottomSheet && content) {
        content.innerHTML = activityCard.outerHTML;
        bottomSheet.classList.remove('hidden');
        setTimeout(() => {
            bottomSheet.classList.add('show');
        }, 10);
    }
}

/**
 * Hides the bottom sheet
 */
function hideBottomSheet() {
    const bottomSheet = document.getElementById('bottom-sheet');
    if (bottomSheet) {
        bottomSheet.classList.remove('show');
        setTimeout(() => {
            bottomSheet.classList.add('hidden');
        }, 300);
    }
}

/**
 * Toggles map fullscreen mode
 */
function toggleMapFullscreen() {
    const mapSection = document.getElementById('map-section');
    if (mapSection) {
        mapSection.classList.toggle('fixed', !mapSection.classList.contains('fixed'));
        mapSection.classList.toggle('inset-0', !mapSection.classList.contains('inset-0'));
        mapSection.classList.toggle('z-50', !mapSection.classList.contains('z-50'));
        
        if (mapSection.classList.contains('fixed')) {
            mapSection.style.borderRadius = '0';
            mapSection.style.padding = '1rem';
        } else {
            mapSection.style.borderRadius = '';
            mapSection.style.padding = '';
        }
        
        // Invalidate map size to ensure proper rendering
        if (mainMap) {
            setTimeout(() => mainMap.invalidateSize(), 100);
        }
    }
}

/**
 * Shows skeleton loading state
 */
function showSkeletonLoading(container, count = 3) {
    if (!container) return;
    
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-white/20';
        skeleton.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div class="flex-1">
                    <div class="skeleton h-6 w-3/4 mb-2 rounded"></div>
                    <div class="skeleton h-4 w-1/2 rounded"></div>
                </div>
                <div class="skeleton h-6 w-16 rounded-full"></div>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div class="skeleton h-32 rounded-xl"></div>
                <div class="space-y-4">
                    <div class="skeleton h-24 rounded-xl"></div>
                    <div class="space-y-3">
                        <div class="skeleton h-10 rounded-lg"></div>
                        <div class="skeleton h-10 rounded-lg"></div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(skeleton);
    }
}

/**
 * Shows enhanced loading state with progress
 */
function showEnhancedLoading(element, message = 'Loading...', showProgress = false) {
    if (!element) return;
    
    const loadingHTML = `
        <div class="text-center p-8">
            <div class="loader-large mb-4"></div>
            <h3 class="text-lg font-semibold text-gray-700 mb-2">${message}</h3>
            ${showProgress ? '<div class="w-full bg-gray-200 rounded-full h-2 mt-4"><div class="bg-blue-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div></div>' : ''}
        </div>
    `;
    
    element.innerHTML = loadingHTML;
    element.classList.remove('hidden');
}

/**
 * Updates the CSS grid layout based on screen width. */
function updateGridLayout() {
    // Now UIElements should be defined, but its properties might be null if init hasn't finished.
    // So defensive checks on individual properties are still good.
    if (!UIElements.mainLayoutContainer) {
        console.warn('updateGridLayout: UIElements.mainLayoutContainer is not defined yet.');
        return;
    }

    const isMobile = window.innerWidth <= 1024; // Tailwind's 'lg' breakpoint

    // Use a dataset attribute to prevent unnecessary DOM manipulations if layout hasn't changed
    if (isMobile) {
        if (UIElements.mainLayoutContainer.dataset.layout !== 'mobile') {
            UIElements.mainLayoutContainer.style.gridTemplateColumns = '1fr';
            UIElements.mainLayoutContainer.style.gridTemplateRows = 'auto auto auto auto auto';
            if (UIElements.headerSection) UIElements.headerSection.style.gridColumn = '1'; UIElements.headerSection.style.gridRow = '1';
            if (UIElements.progressSummarySection) UIElements.progressSummarySection.style.gridColumn = '1'; UIElements.progressSummarySection.style.gridRow = '2';
            if (UIElements.latestActivitySection) UIElements.latestActivitySection.style.gridColumn = '1'; UIElements.latestActivitySection.style.gridRow = '3';
            if (UIElements.mapSection) UIElements.mapSection.style.gridColumn = '1'; UIElements.mapSection.style.gridRow = '4';
            if (UIElements.activitiesSection) UIElements.activitiesSection.style.gridColumn = '1'; UIElements.activitiesSection.style.gridRow = '5';
            if (UIElements.statusLogSectionContainer) UIElements.statusLogSectionContainer.style.gridColumn = '1'; UIElements.statusLogSectionContainer.style.gridRow = '6';
            if (UIElements.activitiesSection) {
                UIElements.activitiesSection.style.position = 'static';
                UIElements.activitiesSection.style.height = 'auto';
                UIElements.activitiesSection.style.top = 'auto'; // Remove sticky top on mobile
            }
            UIElements.mainLayoutContainer.dataset.layout = 'mobile';
        }
    } else {
        if (UIElements.mainLayoutContainer && UIElements.mainLayoutContainer.dataset.layout !== 'desktop') {
            UIElements.mainLayoutContainer.style.gridTemplateColumns = '2fr 1fr';
            UIElements.mainLayoutContainer.style.gridTemplateRows = 'auto auto 1fr auto';
            if (UIElements.headerSection) {
                UIElements.headerSection.style.gridColumn = '1'; 
                UIElements.headerSection.style.gridRow = '1';
            }
            if (UIElements.progressSummarySection) {
                UIElements.progressSummarySection.style.gridColumn = '1'; 
                UIElements.progressSummarySection.style.gridRow = '2';
            }
            if (UIElements.latestActivitySection) {
                UIElements.latestActivitySection.style.gridColumn = '1';
                UIElements.latestActivitySection.style.gridRow = '3';
            }
            if (UIElements.mapSection) {
                UIElements.mapSection.style.gridColumn = '1'; 
                UIElements.mapSection.style.gridRow = '4';
            }
            if (UIElements.statusLogSectionContainer) {
                UIElements.statusLogSectionContainer.style.gridColumn = '1'; 
                UIElements.statusLogSectionContainer.style.gridRow = '5';
            }
            if (UIElements.activitiesSection) {
                UIElements.activitiesSection.style.gridColumn = '2';
                UIElements.activitiesSection.style.gridRow = '1 / span 4';
                UIElements.activitiesSection.style.position = 'sticky';
                UIElements.activitiesSection.style.top = '1.5rem'; // Ensure sticky top is set
            }
            if (UIElements.mainLayoutContainer) {
                UIElements.mainLayoutContainer.dataset.layout = 'desktop';
            }
        }
    }
    // Invalidate map size after layout change to ensure tiles load correctly
    if (mainMap) mainMap.invalidateSize();
}

/** Checks if client ID and secret inputs are filled and enables/disables the connect button. */
function checkInputs() {
    const clientId = UIElements.clientId.value.trim();
    const clientSecret = UIElements.clientSecret.value.trim();
    const connectButton = UIElements.connectButton;
    
    if (clientId && clientSecret) {
        connectButton.disabled = false;
        connectButton.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
        connectButton.disabled = true;
        connectButton.classList.add('opacity-50', 'cursor-not-allowed');
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
    // Official Strava OAuth URL as required by brand guidelines
    window.location.href = `https://www.strava.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=read,activity:read_all,activity:write,profile:read_all`;
}

/**
 * Exchanges the Strava authorization code for access and refresh tokens.
 * @param {string} code - The authorization code from Strava.
 */
async function getAccessToken(code) {
    log('Exchanging authorization code for token...');
    
    // Try global credentials first (from Firebase), then fall back to localStorage
    const clientId = window.STRAVA_CLIENT_ID || localStorage.getItem('stravaClientId');
    const clientSecret = window.STRAVA_CLIENT_SECRET || localStorage.getItem('stravaClientSecret');
    
    if (!clientId || !clientSecret) {
        throw new Error('Strava API credentials not found. Please set up credentials first.');
    }
    
    try {
        const response = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
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
    const appStartTime = Date.now();
    console.log('📱 script.js showMainApp() started');
    enhancedLog('Loading main application...', 'info');
    
    try {
        console.log('🔄 Updating athlete info...');
        const athlete = JSON.parse(localStorage.getItem('stravaAthlete') || '{}');
        // Update Strava account name in header
        const accountNameEl = document.getElementById('strava-account-name');
        if (accountNameEl) {
            if (athlete.firstname) {
                accountNameEl.innerHTML = `<svg class="inline-block align-middle" width="1.5em" height="1.5em" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M10.5 3.49804C10.5 5.15396 9.157 6.49609 7.5 6.49609C5.843 6.49609 4.5 5.15396 4.5 3.49804C4.5 1.84212 5.843 0.5 7.5 0.5C9.157 0.5 10.5 1.84212 10.5 3.49804Z" stroke="white" stroke-linecap="square"/>
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M12.5 14.4909H2.5C2.5 13.7808 2.5 13.1053 2.5 12.4936C2.5 10.8368 3.84315 9.49414 5.5 9.49414H9.5C11.1569 9.49414 12.5 10.8368 12.5 12.4936C12.5 13.1053 12.5 13.7808 12.5 14.4909Z" stroke="white" stroke-linecap="square"/>
                </svg> ${athlete.firstname} ${athlete.lastname}`;
            } else {
                accountNameEl.innerHTML = `<svg class="inline-block align-middle" width="1.5em" height="1.5em" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M10.5 3.49804C10.5 5.15396 9.157 6.49609 7.5 6.49609C5.843 6.49609 4.5 5.15396 4.5 3.49804C4.5 1.84212 5.843 0.5 7.5 0.5C9.157 0.5 10.5 1.84212 10.5 3.49804Z" stroke="white" stroke-linecap="square"/>
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M12.5 14.4909H2.5C2.5 13.7808 2.5 13.1053 2.5 12.4936C2.5 10.8368 3.84315 9.49414 5.5 9.49414H9.5C11.1569 9.49414 12.5 10.8368 12.5 12.4936C12.5 13.1053 12.5 13.7808 12.5 14.4909Z" stroke="white" stroke-linecap="square"/>
                </svg> Strava User`;
            }
        }
        console.log('✅ Athlete info updated');
       
        // ========================================
        // 🚀 PROGRESSIVE LOADING: DASHBOARD FIRST
        // ========================================
        
        console.log('🚀 Starting progressive loading: Dashboard first...');
        
        // PHASE 1: Show dashboard skeleton immediately (0ms)
        showDashboardSkeleton();
        
        // PHASE 2: Initialize map first (required for data display)
        console.log('🗺️ Phase 2a: Initializing map...');
        initializeMapAndData();
        
        // PHASE 2b: Load dashboard data (now map is ready)
        console.log('📊 Phase 2b: Loading dashboard data...');
        await loadDashboardFirst();
        
        // PHASE 3: Start background loading (non-blocking)
        console.log('🔄 Phase 3: Starting background loading...');
        startBackgroundLoading();
        
                console.log('✅ Progressive loading initiated');
        
        // The progressive loading handles all the heavy lifting in the background
        // Just wait a moment for the dashboard to settle, then finalize the UI
        setTimeout(() => {
        if (mainMap) {
            console.log('🗺️ Invalidating map size...');
            mainMap.invalidateSize(); // Ensure map tiles load correctly
            console.log('✅ Map size invalidated');
        }
        }, 1000);
        
        console.log('🎯 Progressive loading application loaded successfully');
        
        console.log('✅ script.js showMainApp() completed successfully');
        
    } catch (error) {
        console.error('❌ Error in progressive loading showMainApp():', error);
        log(`Error loading main application: ${error.message}`, 'error');
        
        // Try to show basic UI even if loading fails
        showDashboardSkeleton();
        
        throw error; // Re-throw so auth-controller can catch it
    }
}
   
/** Fetches activities and renders them in the UI. */
async function fetchAndRenderActivities(forceRefresh = false) {
    
    // EMERGENCY: Clear any stuck skeleton loading immediately
    const activitiesSection = document.getElementById('activities-section');
    if (activitiesSection) {
        console.log('🧹 Clearing any existing skeleton loading...');
        const skeletons = activitiesSection.querySelectorAll('.skeleton-loader');
        skeletons.forEach(skeleton => skeleton.remove());
    }
    
    const renderStartTime = Date.now();
    if (OPTIMIZATION_FEATURES.enhancedLogging) {
        enhancedLog('Starting to fetch and render activities...', 'info');
    }
    
    // Check if user has Strava tokens - if not, show empty state
    const accessToken = localStorage.getItem(STRAVA_ACCESS_TOKEN_KEY);
    if (!accessToken) {
        console.log('🚫 No Strava access token found - user skipped Strava connection');
        log('No Strava connection found. Connect to Strava to fetch your activities.', 'info');
        allFetchedActivities = [];
        renderActivityList([]);
        return [];
    }
    
    console.log('✅ Strava access token found, proceeding with fetch...');
    
    try {
        // EMERGENCY: Simple status update instead of skeleton loading
        log('Fetching your Strava activities...', 'info');
        
        // Fetch all activities from API or cache
        const allActivities = await fetchAllActivities(forceRefresh);
        
        // Filter to only hiking/walking activities for SWCP tracking
        const relevantActivities = allActivities.filter(act => ['Hike', 'Walk'].includes(act.type));
        
        if (relevantActivities.length === 0) {
            // Only show Hike/Walk activities - no fallback to other types
            allFetchedActivities = [];
            renderActivityList([]);
            log('No hiking/walking activities found. Start logging some hikes on Strava!', 'info');
            
            // Calculate stats from empty activities
            setTimeout(() => calculateDeferredStats(), 50);
        } else {
            // Store globally for search/filter functionality
            allFetchedActivities = relevantActivities;
            renderActivityList(relevantActivities);
            log(`Successfully loaded ${relevantActivities.length} activities.`, 'success');
            
            // Calculate stats from newly loaded activities
            setTimeout(() => calculateDeferredStats(), 50);
        }
        
        if (OPTIMIZATION_FEATURES.enhancedLogging) {
            enhancedLog(`Activities fetch and render completed successfully`, 'perf', renderStartTime);
        }
        
        return relevantActivities;
        
    } catch (error) {
        console.error('❌ Error in fetchAndRenderActivities:', error);
        if (OPTIMIZATION_FEATURES.enhancedLogging) {
            enhancedLog(`Activity fetch and render failed: ${error.message}`, 'error');
        }
        
        // Show error state to user
        log(`Failed to load activities: ${error.message}`, 'error');
        allFetchedActivities = [];
        renderActivityList([]);
        return [];
    }
}

/** Initializes the Leaflet map and loads SWCP data. */
function initializeMapAndData() {
    log('Initializing map...');
   
    // Set very tight bounds to focus heavily on SWCP land areas and minimize ocean space
    const corner1 = L.latLng(50.1, -5.2); // South-west (very tight around Land's End)
    const corner2 = L.latLng(51.0, -2.3); // North-east (very tight around Minehead)
    const bounds = L.latLngBounds(corner1, corner2);

    // Initialize map with maxBounds and minZoom to keep focus on SWCP
    if (!mainMap && UIElements.mainMap) { // Prevent re-initialization if already present, ensure div exists
        mainMap = L.map(UIElements.mainMap.id, { 
            maxBounds: bounds, 
            minZoom: 8,
            maxZoom: 14
        });
        
        // Apply subtle vintage CSS filter to the map container
        UIElements.mainMap.style.filter = 'sepia(0.1) saturate(0.9) brightness(0.95)';
    } else if (!UIElements.mainMap) {
        log('Error: Main map container (id="map") not found. Cannot initialize map.', 'error');
        return;
    }
   
    if (mainMap) { // Only proceed if map was successfully initialized
        // Use ESRI World Topo for professional topographic mapping with vintage styling
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { 
            attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
            maxZoom: 14
        }).addTo(mainMap);
       
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
                style: { 
                    color: '#2563eb', 
                    weight: 3, 
                    opacity: 0.7,
                    fillOpacity: 0.1,
                    lineCap: 'round',
                    lineJoin: 'round'
                }
            }).addTo(mainMap);
            
            // Add subtle glow effect to the full route
            leafletGeoJson.on('add', function() {
                const paths = this.getLayers().map(layer => layer.getElement());
                paths.forEach(path => {
                    if (path) {
                        path.classList.add('map-glow-3d-combined-blue');
                    }
                });
            });
            mainMap.fitBounds(leafletGeoJson.getBounds());
        } else {
            log('Main map not initialized, cannot render SWCP route. This is an unexpected state.', 'error');
        }
       
        if (UIElements.totalDistance) UIElements.totalDistance.textContent = `${swcpTotalDistance.toFixed(2)} km`;
        log('SWCP route rendered on map.', 'success');
    } catch(e) {
        log(`Failed to load SWCP map data: ${e.message}. Please check your 'routes.geojson' file and its deployment.`, 'error');
        alert(`Failed to load SWCP map data: ${e.message}.`);
    } finally {
        if (UIElements.mapLoadingOverlay) UIElements.mapLoadingOverlay.classList.add('hidden');
    }
}
   
/** Simple Firebase loading - load everything from Firebase and display it */
async function loadProgressFromStorage() {
    await swcpDataPromise; // Ensure SWCP data is loaded before processing points
    
    console.log('☁️ Loading everything from Firebase...');
    
    if (!firebaseProgressService?.isEnabled) {
        console.log('❌ Firebase not available, falling back to localStorage only');
        return loadFromLocalStorageOnly();
    }
    
    try {
        // Load all data from Firebase (no cache complexity)
        const firebaseResult = await firebaseProgressService.loadFromFirebase();
        
        if (firebaseResult.success && firebaseResult.pointCount > 0) {
            console.log(`✅ Firebase loaded: ${firebaseResult.pointCount} points, ${firebaseResult.percentage}%, ${firebaseResult.totalDistance}km`);
            
            // Display everything from Firebase
            updateProgressUI({
                segments: firebaseResult.segments || [],
                totalDistance: firebaseResult.totalDistance || 0,
                percentage: firebaseResult.percentage?.toFixed(2) || "0.00",
                newCompletedPoints: firebaseResult.completedPoints || []
            });
            
            // Render map from Firebase data
            renderMapSegmentsFromPoints(firebaseResult.completedPoints || []);
            
            // Load activities from Firebase too
            const storedActivities = JSON.parse(localStorage.getItem('swcp_processed_activities') || '[]');
            if (storedActivities.length > 0) {
                console.log(`📊 Found ${storedActivities.length} processed activities`);
                
                // Calculate stats from activities using the correct key pattern
                let totalElevation = 0;
                let totalTime = 0;
                let foundActivities = 0;
                
                storedActivities.forEach(activityId => {
                    // FIXED: Use the correct activity stats key pattern
                    const activityStatsKey = `swcp_activity_stats_${activityId}`;
                    const cachedActivityStats = JSON.parse(localStorage.getItem(activityStatsKey) || 'null');
                    
                    if (cachedActivityStats) {
                        if (cachedActivityStats.elevationGain) {
                            totalElevation += cachedActivityStats.elevationGain;
                        }
                        if (cachedActivityStats.movingTime) {
                            totalTime += cachedActivityStats.movingTime;
                        }
                        foundActivities++;
                        console.log(`📈 Loaded stats for activity ${cachedActivityStats.name}: ${cachedActivityStats.elevationGain}m, ${Math.floor(cachedActivityStats.movingTime/60)}min`);
                    } else {
                        console.log(`⚠️ No stats found for activity ${activityId}`);
                    }
                });
                
                // Update elevation and time displays
                const elevationEl = document.getElementById('elevation-gained');
                const timeEl = document.getElementById('time-taken');
                
                if (elevationEl) {
                    elevationEl.textContent = `${Math.round(totalElevation)} m`;
                }
                
                if (timeEl) {
                    const hours = Math.floor(totalTime / 3600);
                    const minutes = Math.floor((totalTime % 3600) / 60);
                    timeEl.textContent = `${hours}h ${minutes}m`;
                }
                
                log(`✅ Stats: ${foundActivities}/${storedActivities.length} activities with stats, ${Math.round(totalElevation)}m elevation, ${Math.floor(totalTime/3600)}h${Math.floor((totalTime%3600)/60)}m`, 'success');
            } else {
                // No activities - set stats to zero
                const elevationEl = document.getElementById('elevation-gained');
                const timeEl = document.getElementById('time-taken');
                if (elevationEl) elevationEl.textContent = '0 m';
                if (timeEl) timeEl.textContent = '0h 0m';
                console.log('📊 No analyzed activities - stats set to zero');
            }
            
            log(`✅ Loaded ${firebaseResult.pointCount} waypoints from Firebase`, 'success');
            
        } else {
            console.log('⚠️ No Firebase data found, falling back to localStorage');
            return loadFromLocalStorageOnly();
        }
        
    } catch (error) {
        console.error('❌ Firebase loading failed:', error);
        return loadFromLocalStorageOnly();
    }
}

/** Fallback: Load from localStorage only */
function loadFromLocalStorageOnly() {
    console.log('📱 Loading from localStorage only...');
    const completedPoints = JSON.parse(localStorage.getItem(COMPLETED_POINTS_KEY) || '[]');
    
    if (completedPoints.length > 0) {
        log('📊 Calculating progress from localStorage...');
        analysisWorker.postMessage({ 
            type: 'process_activity', 
            activityId: 'initial_load', 
            activityStream: null, 
            existingPoints: completedPoints 
        });
    } else {
        updateProgressUI({ segments: [], totalDistance: 0, percentage: "0.00", newCompletedPoints: [] });
        log('No existing progress found. Overall progress set to 0.', 'info');
    
        setTimeout(() => {
            const elevationEl = document.getElementById('elevation-gained');
            const timeEl = document.getElementById('time-taken');
            if (elevationEl && !elevationEl.textContent) elevationEl.textContent = '0 m';
            if (timeEl && !timeEl.textContent) timeEl.textContent = '0h 0m';
        }, 100);
    }
}
   
async function emergencyDataRecovery() {
    console.log('🚨 Emergency Data Recovery Started');
    
    // Check localStorage status
    const localPoints = localStorage.getItem('swcp_completed_points');
    const localActivities = localStorage.getItem('swcp_processed_activities');
    console.log('Local points:', localPoints ? JSON.parse(localPoints).length : 'NONE');
    console.log('Local activities:', localActivities ? JSON.parse(localActivities).length : 'NONE');
    
    // Try to recover from Firebase
    if (firebaseProgressService) {
        try {
            console.log('🔄 Attempting Firebase recovery...');
            await firebaseProgressService.loadProgressFromFirebase();
            
            // Check if recovery worked
            const recoveredPoints = localStorage.getItem('swcp_completed_points');
            const recoveredActivities = localStorage.getItem('swcp_processed_activities');
            
            if (recoveredPoints && JSON.parse(recoveredPoints).length > 0) {
                console.log('✅ Data recovered from Firebase!');
                log('✅ Progress data recovered from Firebase backup!', 'success');
                window.location.reload(); // Reload to apply recovered data
            } else {
                console.log('❌ No data found in Firebase backup');
                log('❌ No backup data found in Firebase', 'error');
            }
        } catch (error) {
            console.error('❌ Firebase recovery failed:', error);
            log('❌ Firebase recovery failed: ' + error.message, 'error');
        }
    } else {
        console.log('❌ Firebase service not available');
        log('❌ Firebase service not available for recovery', 'error');
    }
}

// Add to window for easy access in console
window.emergencyDataRecovery = emergencyDataRecovery;

function checkDataIntegrity() {
    const points = JSON.parse(localStorage.getItem('swcp_completed_points') || '[]');
    const activities = JSON.parse(localStorage.getItem('swcp_processed_activities') || '[]');
    const cached = JSON.parse(localStorage.getItem('swcp_cached_results') || 'null');
    
    console.log('📊 Data Integrity Check:');
    console.log(`  ✅ Completed Points: ${points.length}`);
    console.log(`  ✅ Processed Activities: ${activities.length}`);
    console.log(`  ✅ Cached Results: ${cached ? 'Available' : 'None'}`);
    
    if (firebaseProgressService) {
        const fbStatus = firebaseProgressService.getStatus();
        console.log(`  🔥 Firebase: ${fbStatus.isEnabled ? 'Enabled' : 'Disabled'}`);
        console.log(`  🔥 Last Sync: ${fbStatus.lastSyncTime || 'Never'}`);
    }
    
    return {
        completedPoints: points.length,
        processedActivities: activities.length,
        hasCachedResults: !!cached,
        firebaseEnabled: firebaseProgressService?.isEnabled || false
    };
}

// Add to window for easy access
window.checkDataIntegrity = checkDataIntegrity;

/**
 * Ensure elevation and time fields are always populated
 * Call this as a fallback to prevent empty fields
 */
function ensureStatsPopulated() {
    try {
        const elevationEl = document.getElementById('elevation-gained');
        const timeEl = document.getElementById('time-taken');
        
        // Only set to 0 if field is completely empty
        if (elevationEl && (!elevationEl.textContent || elevationEl.textContent.trim() === '')) {
            elevationEl.textContent = '0 m';
            console.log('📊 Set empty elevation field to 0');
        }
        
        if (timeEl && (!timeEl.textContent || timeEl.textContent.trim() === '')) {
            timeEl.textContent = '0h 0m';
            console.log('📊 Set empty time field to 0');
        }
    } catch (error) {
        console.error('❌ Error ensuring stats populated:', error);
    }
}

// Add to window for debugging
window.ensureStatsPopulated = ensureStatsPopulated;

/**
 * Debug function to check activity data and manually recalculate stats
 */
function debugActivityStats() {
    console.log('🔍 ACTIVITY STATS DEBUG:');
    console.log('Activities loaded:', allFetchedActivities?.length || 0);
    
    if (allFetchedActivities && allFetchedActivities.length > 0) {
        const processedIds = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));
        
        console.log('Processed activities:', processedIds.size);
        console.log('⚠️  IMPORTANT: Stats only count ANALYZED activities (not all loaded activities)');
        console.log('');
        console.log('Activity breakdown:');
        
        let totalElevation = 0;
        let totalTime = 0;
        let processedElevation = 0;
        let processedTime = 0;
        
        allFetchedActivities.forEach((act, i) => {
            const isProcessed = processedIds.has(String(act.id));
            const elevation = act.total_elevation_gain || 0;
            const time = act.moving_time || 0;
            
            console.log(`  ${i+1}. ${act.name}`);
            console.log(`     ID: ${act.id} (${isProcessed ? '✅ ANALYZED' : '❌ not analyzed'})`);
            console.log(`     Elevation: ${elevation}m`);
            console.log(`     Time: ${Math.floor(time / 3600)}h ${Math.floor((time % 3600) / 60)}m`);
            
            totalElevation += elevation;
            totalTime += time;
            
            if (isProcessed) {
                processedElevation += elevation;
                processedTime += time;
            }
        });
        
        console.log('');
        console.log('📊 TOTALS:');
        console.log(`  All loaded activities: ${Math.round(totalElevation)}m, ${Math.floor(totalTime / 3600)}h ${Math.floor((totalTime % 3600) / 60)}m`);
        console.log(`  Only analyzed activities: ${Math.round(processedElevation)}m, ${Math.floor(processedTime / 3600)}h ${Math.floor((processedTime % 3600) / 60)}m`);
        console.log(`  Dashboard will show: ${Math.round(processedElevation)}m, ${Math.floor(processedTime / 3600)}h ${Math.floor((processedTime % 3600) / 60)}m`);
        
        // Manual recalculation
        console.log('');
        console.log('🔄 Manually recalculating stats...');
        calculateDeferredStats();
    } else {
        console.log('❌ No activities loaded');
    }
    
    // Show current UI values
    const elevationEl = document.getElementById('elevation-gained');
    const timeEl = document.getElementById('time-taken');
    console.log('');
    console.log('Current dashboard UI values:');
    console.log('  Elevation:', elevationEl?.textContent || 'not found');
    console.log('  Time:', timeEl?.textContent || 'not found');
}

// Add to window for debugging
window.debugActivityStats = debugActivityStats;

/**
 * Manual function to force recalculation of elevation/time stats
 * Use this if stats aren't updating properly
 */
function forceRecalculateStats() {
    console.log('🔄 Force recalculating elevation/time stats...');
    calculateDeferredStats();
    log('📊 Stats manually recalculated', 'info');
}

// Add to window for debugging
window.forceRecalculateStats = forceRecalculateStats;

/**
 * Show all available debug functions
 */
function showDebugHelp() {
    console.log(`
🔧 SWCP TRACKER DEBUG FUNCTIONS:

📊 Activity & Stats Debug:
  • debugActivityStats()      - Check activity data and recalculate stats
  • forceRecalculateStats()   - Force recalculation of elevation/time
  • ensureStatsPopulated()    - Ensure stats fields are not empty

⚡ Performance & Loading Debug:
  • testFirebaseFirst()       - Test new Firebase-first architecture  
  • testLoadingPerformance()  - Test optimized instant loading speed
  • testInstantLoading()      - Test instant loading system
  • testInstantLoadingSafe()  - Test Firebase instant loading

🗂️ Data Integrity:
  • checkDataIntegrity()      - Check all stored data state
  • emergencyDataRecovery()   - Attempt to recover corrupted data

💾 Firebase Debug:
  • firebaseProgressService.debug() - Firebase service debug info

🎯 Current Status:
  • Activities loaded: ${allFetchedActivities?.length || 0}
  • UI Elements ready: ${!!UIElements?.activityListContainer}
  • Firebase enabled: ${firebaseProgressService?.isEnabled || false}
  • Architecture: ${firebaseProgressService?.isEnabled ? 'Firebase-first with cache' : 'localStorage only'}
    `);
}

// Add to window for debugging
window.showDebugHelp = showDebugHelp;

/**
 * Test the new optimized instant loading performance
 */
async function testLoadingPerformance() {
    console.log('⚡ LOADING PERFORMANCE TEST');
    console.log('================================');
    
    // Test 1: Check current data state
    const points = JSON.parse(localStorage.getItem('swcp_completed_points') || '[]');
    const activities = JSON.parse(localStorage.getItem('swcp_processed_activities') || '[]');
    const cached = JSON.parse(localStorage.getItem('swcp_cached_results') || 'null');
    
    console.log(`📊 Current Data State:`);
    console.log(`  • Completed Points: ${points.length}`);
    console.log(`  • Processed Activities: ${activities.length}`);
    console.log(`  • Cached Results: ${cached ? 'Available' : 'None'}`);
    
    if (points.length === 0) {
        console.log('❌ No progress data to test loading performance');
        console.log('💡 Analyze some activities first, then run this test');
        return;
    }
    
    // Test 2: Time the optimized instant loading
    console.log('');
    console.log('⚡ Testing Optimized Instant Loading...');
    const startTime = performance.now();
    
    try {
        const result = await firebaseProgressService.showInstantProgressOptimized();
        const endTime = performance.now();
        const loadTime = (endTime - startTime).toFixed(1);
        
        console.log(`✅ Optimized Loading Results:`);
        console.log(`  • Success: ${result.success}`);
        console.log(`  • Load Time: ${loadTime}ms`);
        console.log(`  • Data Source: ${result.source || 'N/A'}`);
        console.log(`  • Points Loaded: ${result.pointCount || 0}`);
        
        if (loadTime < 50) {
            console.log('🚀 EXCELLENT: Ultra-fast loading (<50ms)');
        } else if (loadTime < 100) {
            console.log('✅ GOOD: Fast loading (<100ms)');
        } else if (loadTime < 200) {
            console.log('⚠️ MODERATE: Acceptable loading (<200ms)');
        } else {
            console.log('🐌 SLOW: Loading taking >200ms - check data size');
        }
        
    } catch (error) {
        const endTime = performance.now();
        const loadTime = (endTime - startTime).toFixed(1);
        console.log(`❌ Loading failed after ${loadTime}ms:`, error.message);
    }
    
    // Test 3: Compare localStorage read counts
    console.log('');
    console.log('📊 Performance Comparison:');
    console.log('  OLD METHOD: 3+ localStorage reads');
    console.log('    1. Check completed points');
    console.log('    2. Validate cached results');  
    console.log('    3. Load stored activities');
    console.log('    4. Background verification reads');
    console.log('');
    console.log('  NEW METHOD: 1 localStorage read');
    console.log('    1. Load everything at once');
    console.log('    ✅ 3x fewer storage operations');
    console.log('    ✅ Faster display updates');
    console.log('    ✅ Reduced blocking time');
}

// Add to window for debugging
window.testLoadingPerformance = testLoadingPerformance;

/**
 * Test the new Firebase-first architecture
 */
async function testFirebaseFirst() {
    console.log('🔥 FIREBASE-FIRST ARCHITECTURE TEST');
    console.log('====================================');
    
    if (!firebaseProgressService?.isEnabled) {
        console.log('❌ Firebase not enabled - can\'t test Firebase-first architecture');
        return;
    }
    
    try {
        // Test 1: Cache loading
        console.log('📱 Step 1: Testing cache loading...');
        const cacheResult = await firebaseProgressService.showFromCache();
        console.log(`Cache result: ${cacheResult.success ? 'SUCCESS' : 'FAILED'}`);
        console.log(`Cache source: ${cacheResult.source || 'N/A'}`);
        console.log(`Cache points: ${cacheResult.pointCount || 0}`);
        
        // Test 2: Firebase loading
        console.log('');
        console.log('☁️ Step 2: Testing Firebase loading...');
        const firebaseResult = await firebaseProgressService.loadFromFirebase();
        console.log(`Firebase result: ${firebaseResult.success ? 'SUCCESS' : 'FAILED'}`);
        if (firebaseResult.success) {
            console.log(`Firebase points: ${firebaseResult.pointCount}`);
            console.log(`Firebase percentage: ${firebaseResult.percentage}%`);
            console.log(`Firebase last updated: ${firebaseResult.lastUpdated}`);
        } else {
            console.log(`Firebase error: ${firebaseResult.reason}`);
        }
        
        // Test 3: Architecture summary
        console.log('');
        console.log('📊 ARCHITECTURE SUMMARY:');
        console.log('  ✅ Firebase is the source of truth');
        console.log('  ✅ localStorage is just a performance cache');
        console.log('  ✅ Loading tries cache first, then Firebase');
        console.log('  ✅ Saves always go to Firebase + cache update');
        console.log('  ✅ No complex sync logic needed');
        
        console.log('');
        console.log('🚀 Result: Much simpler than the old hybrid approach!');
        
    } catch (error) {
        console.error('❌ Firebase-first test failed:', error);
    }
}

// Add to window for debugging
window.testFirebaseFirst = testFirebaseFirst;
window.testProgressiveLoading = () => {
    console.log('🧪 Testing progressive loading phases...');
    showDashboardSkeleton();
    setTimeout(() => loadDashboardFirst(), 100);
    setTimeout(() => startBackgroundLoading(), 500);
};
window.showDashboardSkeleton = showDashboardSkeleton;
window.loadDashboardFirst = loadDashboardFirst;
window.startBackgroundLoading = startBackgroundLoading;

/**
 * PHASE 1: Show dashboard skeleton immediately for perceived speed
 */
function showDashboardSkeleton() {
    try {
        console.log('💀 Showing dashboard skeleton...');
        
        // Show basic dashboard structure with loading states
        const progressSection = document.getElementById('progress-summary-section');
        if (progressSection) {
            progressSection.classList.remove('hidden');
            
            // Set loading placeholders
            const percentageEl = document.getElementById('progress-percentage');
            const completedEl = document.getElementById('completed-distance');
            const remainingEl = document.getElementById('remaining-distance');
            const elevationEl = document.getElementById('elevation-gained');
            const timeEl = document.getElementById('time-taken');
            
            if (percentageEl) percentageEl.textContent = '...';
            if (completedEl) completedEl.textContent = '...';
            if (remainingEl) remainingEl.textContent = '...';
            if (elevationEl) elevationEl.textContent = '...';
            if (timeEl) timeEl.textContent = '...';
            
            console.log('✅ Dashboard skeleton displayed');
        }
        
        // Show main layout immediately
        const mainLayout = document.getElementById('main-layout-container');
        if (mainLayout) {
            mainLayout.classList.remove('hidden');
        }
        
        // Hide any blocking loading screens
        const loadingScreen = document.getElementById('initial-loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.add('hidden');
        }
        
    } catch (error) {
        console.error('❌ Error showing dashboard skeleton:', error);
    }
}

/**
 * PHASE 2: Load dashboard data with maximum priority
 */
async function loadDashboardFirst() {
    try {
        const startTime = performance.now();
        console.log('📊 Loading dashboard data with priority...');
        
        // Ensure SWCP data is available (needed for percentage calculation)
        if (!swcpGeoJSON) {
            console.log('📍 Loading SWCP route data for calculations...');
            await loadSwcpData();
        }
        
        // Load progress data using unified system
        console.log('⚡ Loading progress with unified system...');
        await loadUnifiedProgress(true);
        
        // Stats are now calculated and displayed by unified system
        console.log('✅ Progress loaded and displayed');
        
        const loadTime = performance.now() - startTime;
        console.log(`✅ Dashboard loaded in ${loadTime.toFixed(1)}ms`);
        
        // Show success message
        log(`📊 Dashboard loaded in ${(loadTime/1000).toFixed(1)}s`, 'success');
        
        // If unified progress was not found, fall back to instant-cache or zero values
        const completedPlaceholder = UIElements.completedDistance?.textContent === '...';
        if (!currentPercentage && completedPlaceholder) {
            console.log('⚠️ No unified progress data found – attempting instant-cache fallback');
            let usedCache = false;
            if (firebaseProgressService && typeof firebaseProgressService.showInstantProgress === 'function') {
                try {
                    usedCache = await firebaseProgressService.showInstantProgress();
                } catch (err) {
                    console.warn('Instant-cache fallback failed:', err);
                }
            }
            if (!usedCache) {
                console.log('ℹ️ Falling back to zeroed stats');
                if (UIElements.completedDistance) UIElements.completedDistance.textContent = '0 km';
                if (UIElements.progressPercentage) UIElements.progressPercentage.textContent = '0%';
                if (UIElements.totalDistance && UIElements.remainingDistance) {
                    const total = parseFloat(UIElements.totalDistance.textContent) || 0;
                    UIElements.remainingDistance.textContent = `${total.toFixed(2)} km`;
                }
            }
        }
    } catch (error) {
        console.error('❌ Error loading dashboard:', error);
        log('❌ Dashboard loading failed: ' + error.message, 'error');
        
        // Fallback: show zeros
        ensureStatsPopulated();
    }
}

/**
 * PHASE 3: Load secondary elements in background (non-blocking)
 */
async function startBackgroundLoading() {
    try {
        console.log('🔄 Starting background loading (non-blocking)...');
        
        // Show loading states for secondary elements
        showSecondaryLoadingStates();
        
        // Map already initialized in Phase 2a
        console.log('✅ Map already initialized, skipping background init');
        
        // Start activities loading (low priority)
        console.log('📱 Loading activities in background...');
        setTimeout(() => {
            fetchAndRenderActivities().then(() => {
                console.log('✅ Activities loaded');
                hideSecondaryLoadingStates();
            }).catch(error => {
                console.error('❌ Activities loading failed:', error);
                hideSecondaryLoadingStates();
            });
        }, 500);
        
    } catch (error) {
        console.error('❌ Error in background loading:', error);
    }
}

/**
 * Show loading states for secondary elements
 */
function showSecondaryLoadingStates() {
    try {
        // Show map loading overlay
        const mapOverlay = document.getElementById('map-loading-overlay');
        if (mapOverlay) {
            mapOverlay.classList.remove('hidden');
        }
        
        // Show activities loading spinner
        const activitiesSpinner = document.getElementById('activities-loading-spinner');
        if (activitiesSpinner) {
            activitiesSpinner.classList.remove('hidden');
        }
        
        // Show skeleton in activity list
        const activityContainer = document.getElementById('activity-list-container');
        if (activityContainer) {
            showSkeletonLoading(activityContainer, 3);
        }
        
        console.log('⏳ Secondary loading states shown');
        
    } catch (error) {
        console.error('❌ Error showing secondary loading states:', error);
    }
}

/**
 * Hide loading states for secondary elements
 */
function hideSecondaryLoadingStates() {
    try {
        // Hide map loading overlay
        const mapOverlay = document.getElementById('map-loading-overlay');
        if (mapOverlay) {
            mapOverlay.classList.add('hidden');
        }
        
        // Hide activities loading spinner
        const activitiesSpinner = document.getElementById('activities-loading-spinner');
        if (activitiesSpinner) {
            activitiesSpinner.classList.add('hidden');
        }
        
        console.log('✅ Secondary loading states hidden');
        
    } catch (error) {
        console.error('❌ Error hiding secondary loading states:', error);
    }
}

/**
 * Show skeleton loading animation in container
 */
// Test instant loading functionality
window.testInstantLoading = async () => {
    console.log('⚡ Testing Instant Loading System...');
    
    // Check current state
    const points = JSON.parse(localStorage.getItem('swcp_completed_points') || '[]');
    const activities = JSON.parse(localStorage.getItem('swcp_processed_activities') || '[]');
    
    console.log(`📊 Current state: ${points.length} points, ${activities.length} activities`);
    
    if (points.length === 0) {
        console.log('❌ No progress data to test with. Process some activities first.');
        return false;
    }
    
    // Test the full instant loading flow
    try {
        console.log('🔄 Simulating page load with instant loading...');
        
        // Test Firebase instant loading
        if (firebaseProgressService) {
            const instantResult = await firebaseProgressService.showInstantProgress();
            console.log(`⚡ Firebase instant loading: ${instantResult ? 'SUCCESS' : 'FAILED'}`);
            
            if (instantResult) {
                // Test fast map rendering
                console.log('🗺️ Testing fast map rendering...');
                renderMapSegmentsFromPoints(points);
                console.log('✅ Fast map rendering completed');
                
                return true;
            }
        }
        
        console.log('❌ Instant loading test failed');
        return false;
        
    } catch (error) {
        console.error('❌ Instant loading test error:', error);
        return false;
    }
};

/**
 * Fast map rendering directly from stored completed points
 * Bypasses worker analysis for instant visual feedback
 */
function renderMapSegmentsFromPoints(completedPoints) {
    try {
        if (!completedPoints || completedPoints.length === 0) {
            console.log('📍 No completed points to render');
            return;
        }
        
        console.log(`🗺️ Fast-rendering ${completedPoints.length} completed points on map...`);
        
        // Clear existing segments
        if (completedSegmentsLayer) {
            completedSegmentsLayer.clearLayers();
        }
        
        // Group consecutive points into segments for better visual rendering
        const segments = groupPointsIntoSegments(completedPoints);
        console.log(`🎯 Created ${segments.length} segments from ${completedPoints.length} points`);
        
        // Render each segment on the map
        segments.forEach((segment, index) => {
            if (segment.length < 2) return; // Skip single points
            
            // Convert to Leaflet format [lat, lng] (note: stored as [lng, lat])
            const leafletCoords = segment.map(point => [point[1], point[0]]);
            
            // Create shadow/glow layer underneath
            const shadowLine = L.polyline(leafletCoords, { 
                color: '#fd8640', 
                weight: 6, 
                opacity: 0.3,
                lineCap: 'round',
                lineJoin: 'round'
            });
            
            // Main line with glow effect
            const mainLine = L.polyline(leafletCoords, { 
                color: '#fd8640', 
                weight: 3, 
                opacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round'
            });
            
            // Add to map
            if (completedSegmentsLayer) {
                shadowLine.addTo(completedSegmentsLayer);
                mainLine.addTo(completedSegmentsLayer);
                
                // Add glow effect
                mainLine.on('add', function() {
                    const path = this.getElement();
                    if (path) {
                        path.classList.add('map-glow-3d-combined');
                    }
                });
            }
        });
        
        log(`✅ Fast-rendered ${segments.length} completed segments on map`, 'success');
        
    } catch (error) {
        console.error('❌ Error in fast map rendering:', error);
        log('❌ Fast map rendering failed: ' + error.message, 'error');
    }
}

/**
 * Group individual GPS points into logical segments
 * Points that are close together get grouped into single line segments
 */
function groupPointsIntoSegments(points, maxGapKm = 0.5) {
    if (!points || points.length === 0) return [];
    
    const segments = [];
    let currentSegment = [points[0]];
    
    for (let i = 1; i < points.length; i++) {
        const prevPoint = points[i-1];
        const currentPoint = points[i];
        
        // Calculate distance between consecutive points (rough)
        const distance = calculateDistance(prevPoint, currentPoint);
        
        if (distance <= maxGapKm) {
            // Points are close - add to current segment
            currentSegment.push(currentPoint);
        } else {
            // Gap too large - start new segment
            if (currentSegment.length > 1) {
                segments.push(currentSegment);
            }
            currentSegment = [currentPoint];
        }
    }
    
    // Add final segment
    if (currentSegment.length > 1) {
        segments.push(currentSegment);
    }
    
    return segments;
}

/**
 * Calculate rough distance between two GPS points in kilometers
 */
function calculateDistance(point1, point2) {
    const R = 6371; // Earth's radius in km
    const dLat = (point2[1] - point1[1]) * Math.PI / 180;
    const dLng = (point2[0] - point1[0]) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(point1[1] * Math.PI / 180) * Math.cos(point2[1] * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Removed reconstruction function - not needed since user can reprocess activities normally

async function resetProgress() {
    if (confirm("⚠️ FRESH START: This will delete all progress data and let you start fresh. Your Strava connection will remain. Are you sure?")) {
        try {
            log('🗑️ Starting complete data deletion...', 'warn');
            
            // Step 1: Reset analyzed status for all activities in memory
            if (allFetchedActivities && allFetchedActivities.length > 0) {
                log('🔄 Resetting activity analysis status in memory...', 'warn');
                allFetchedActivities.forEach(activity => {
                    activity.analyzed = false;
                });
            }
            
            // Step 2: Reset Firebase activities analysis status using existing methods
            if (firebaseProgressService && firebaseProgressService.isEnabled) {
                log('🔥 Resetting Firebase activities analysis status...', 'warn');
                try {
                    // Load activities from Firebase
                    const firebaseActivities = await firebaseProgressService.loadActivitiesFromFirebase();
                    
                    if (firebaseActivities && firebaseActivities.length > 0) {
                        // Reset analyzed status for all activities
                        const resetActivities = firebaseActivities.map(activity => ({
                            ...activity,
                            analyzed: false
                        }));
                        
                        // Save back to Firebase using existing method
                        await firebaseProgressService.saveActivitiesToFirebase(resetActivities);
                        log('✅ Firebase activities analysis status reset', 'success');
                    }
                } catch (error) {
                    log('⚠️ Firebase activities reset failed: ' + error.message, 'error');
                }
                
                // Step 3: Delete Firebase progress data
                log('🔥 Deleting Firebase backup data...', 'warn');
                const firebaseResult = await firebaseProgressService.deleteAllFirebaseData();
                if (firebaseResult.success) {
                    log('✅ Firebase data deleted successfully', 'success');
                } else {
                    log('⚠️ Firebase deletion failed: ' + firebaseResult.error, 'error');
                    // Continue with local deletion even if Firebase fails
                }
            }
            
            // Step 4: Clear progress-related local storage (keep Strava tokens)
            log('💾 Clearing local progress data...', 'warn');
            const keysToRemoveSuffixes = [
                'swcp_completed_points',
                'swcp_processed_activities',
                'swcp_unified_progress',
                'swcp_cached_activities',
                'swcp_cached_activities_ts',
                'swcp_cached_results'
            ];
            Object.keys(localStorage).forEach(k => {
                if (keysToRemoveSuffixes.some(suffix => k.endsWith(suffix))) {
                    localStorage.removeItem(k);
                }
            });
            
            // Reset UI immediately without waiting for reload
            if (UIElements.progressPercentage) UIElements.progressPercentage.textContent = '0.00%';
            if (UIElements.completedDistance) UIElements.completedDistance.textContent = '0 km';
            if (UIElements.remainingDistance) UIElements.remainingDistance.textContent = `${swcpTotalDistance.toFixed(2)} km`;
            if (UIElements.elevationGained) UIElements.elevationGained.textContent = '0 m';
            if (UIElements.timeTaken) UIElements.timeTaken.textContent = '0h 0m';
            if (completedSegmentsLayer) completedSegmentsLayer.clearLayers();
            if (UIElements.latestActivityContainer) {
                UIElements.latestActivityContainer.innerHTML = '<p class="text-gray-500 text-center">No activities analysed yet.</p>';
            }
            
            // Step 5: Show completion message and reload
            log('🎯 Complete reset successful. Redirecting to login...', 'success');
            
            // Brief delay to show success message
            setTimeout(() => {
                window.location.reload();
            }, 2000);
            
        } catch (error) {
            console.error('❌ Error during reset:', error);
            log('❌ Reset failed: ' + error.message, 'error');
            
            // Fallback: still clear localStorage even if Firebase deletion failed
            localStorage.clear();
            window.location.reload();
        }
    }
}

// Debounced search function for better performance
function debouncedSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        if (allFetchedActivities && allFetchedActivities.length > 0) {
            const filtered = filterActivities();
            renderActivityList(filtered);
        }
    }, 300);
}

function filterActivities(activities = null) {
    // Early return if UIElements not initialized yet
    if (!UIElements || !UIElements.activitySearchBox) {
        return activities || allFetchedActivities || [];
    }
    
    // Check if we have at least one search box and one set of filter buttons
    const hasSearchBox = UIElements.activitySearchBox || UIElements.activitySearchBoxMobile;
    const hasFilterButtons = UIElements.filterButtons || UIElements.filterButtonsMobile;
    if (!hasSearchBox || !hasFilterButtons) return activities || allFetchedActivities || [];

    // Get search term from both desktop and mobile search boxes
    let searchTerm = '';
    if (UIElements.activitySearchBox && UIElements.activitySearchBox.value.trim()) {
        searchTerm = UIElements.activitySearchBox.value.toLowerCase();
    } else if (UIElements.activitySearchBoxMobile && UIElements.activitySearchBoxMobile.value.trim()) {
        searchTerm = UIElements.activitySearchBoxMobile.value.toLowerCase();
    }

    // Get active filter from either desktop or mobile filter buttons
    let activeFilterBtn = null;
    if (UIElements.filterButtons) {
        activeFilterBtn = UIElements.filterButtons.querySelector('.filter-btn.active');
    }
    if (!activeFilterBtn && UIElements.filterButtonsMobile) {
        activeFilterBtn = UIElements.filterButtonsMobile.querySelector('.filter-btn.active');
    }
    
    const typeFilter = activeFilterBtn ? activeFilterBtn.dataset.filter : 'all';
    
    // Use provided activities or fall back to allFetchedActivities
    let filtered = activities || allFetchedActivities || [];
    
    if (typeFilter !== 'all') {
        filtered = filtered.filter(act => act.type === typeFilter);
    }
    if (searchTerm) {
        filtered = filtered.filter(act => act.name.toLowerCase().includes(searchTerm));
    }
    
    return filtered;
}

function handleFilterClick(e) {
    if (!e.target.classList.contains('filter-btn')) return;
    
    const clickedFilter = e.target.getAttribute('data-filter');
    
    // Update both desktop and mobile filter buttons
    if (UIElements.filterButtons) {
        UIElements.filterButtons.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-filter') === clickedFilter) {
                btn.classList.add('active');
            }
        });
    }
    
    if (UIElements.filterButtonsMobile) {
        UIElements.filterButtonsMobile.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-filter') === clickedFilter) {
                btn.classList.add('active');
            }
        });
    }
    
    // If we have activities loaded, filter them immediately
    if (allFetchedActivities && allFetchedActivities.length > 0) {
        const filtered = filterActivities();
        renderActivityList(filtered);
    } else {
        // Otherwise, fetch activities first
        fetchAndRenderActivities();
    }
}

async function refreshActivities() {
    // Store original button HTML and update to loading state
    const refreshBtn = UIElements.refreshActivitiesBtn;
    const fabRefreshBtn = UIElements.fabRefresh;
    const originalRefreshHTML = refreshBtn ? refreshBtn.innerHTML : '';
    const originalFabHTML = fabRefreshBtn ? fabRefreshBtn.innerHTML : '';
    
    // Update button states to loading
    if (refreshBtn) {
        refreshBtn.innerHTML = 'Looking for new activities';
        refreshBtn.disabled = true;
    }
    if (fabRefreshBtn) {
        fabRefreshBtn.innerHTML = 'Looking for new activities';
        fabRefreshBtn.disabled = true;
    }
    
    log('Checking for new activities...', 'info');
    
    try {
        // Get existing activities and their IDs
        const existingActivities = allFetchedActivities || [];
        const existingIds = new Set(existingActivities.map(a => String(a.id)));
        
        // Fetch recent activities from Strava
        const recentActivities = await fetchRecentActivities();
        
        // Filter to only Hike/Walk activities
        const recentHikeWalk = recentActivities.filter(act => ['Hike', 'Walk'].includes(act.type));
        
        // Find truly new Hike/Walk activities
        const newActivities = recentHikeWalk.filter(a => !existingIds.has(String(a.id)));
        
        if (newActivities.length > 0) {
            // Add new activities to existing list (at the beginning for newest first)
            allFetchedActivities = [...newActivities, ...existingActivities];
            
            // Update Firebase with new activities if available
            if (window.firebaseProgressService && window.firebaseProgressService.isEnabled) {
                try {
                    // Get current analyzed activity IDs to preserve analysis status
                    const unifiedData = JSON.parse(localStorage.getItem('swcp_unified_progress') || '{}');
                    const analyzedIds = new Set(unifiedData.analyzedActivityIds || []);
                    
                    // Mark new activities with correct analysis status
                    const activitiesWithStatus = allFetchedActivities.map(activity => ({
                        ...activity,
                        analyzed: analyzedIds.has(String(activity.id))
                    }));
                    
                    await window.firebaseProgressService.saveActivitiesToFirebase(activitiesWithStatus);
                } catch (error) {
                    console.error('Failed to update Firebase with new activities:', error);
                }
            }
            
            // Update cache
            localStorage.setItem(CACHED_ACTIVITIES_KEY, JSON.stringify(allFetchedActivities));
            localStorage.setItem(CACHED_ACTIVITIES_TIMESTAMP_KEY, Date.now().toString());
            
            // Re-render activity list
            renderActivityList(allFetchedActivities);
            
            // Update button states for success with new activities
            if (refreshBtn) refreshBtn.innerHTML = `Found ${newActivities.length} new activities`;
            if (fabRefreshBtn) fabRefreshBtn.innerHTML = `Found ${newActivities.length} new activities`;
            
            log(`Found ${newActivities.length} new activities`, 'success');
        } else {
            // Update button states for no new activities
            if (refreshBtn) refreshBtn.innerHTML = 'No new activities found';
            if (fabRefreshBtn) fabRefreshBtn.innerHTML = 'No new activities found';
            
            log('No new activities found', 'info');
        }
        
        // Reset button states after 3 seconds
        setTimeout(() => {
            if (refreshBtn) {
                refreshBtn.innerHTML = originalRefreshHTML;
                refreshBtn.disabled = false;
            }
            if (fabRefreshBtn) {
                fabRefreshBtn.innerHTML = originalFabHTML;
                fabRefreshBtn.disabled = false;
            }
        }, 3000);
        
        // Ensure stats are calculated after refresh
        setTimeout(() => calculateDeferredStats(), 100);
        
    } catch (error) {
        console.error('❌ Error refreshing activities:', error);
        log(`Failed to check for new activities: ${error.message}`, 'error');
        
        // Reset button states on error
        if (refreshBtn) {
            refreshBtn.innerHTML = originalRefreshHTML;
            refreshBtn.disabled = false;
        }
        if (fabRefreshBtn) {
            fabRefreshBtn.innerHTML = originalFabHTML;
            fabRefreshBtn.disabled = false;
        }
    }
}

// Function to generate consistent pine green gradient for all activity cards
function getActivityGradient(activityId) {
    // Use the new pine green gradient for all activity cards
    return 'linear-gradient(135deg, #5a8a5e 0%, #4a7a4e 100%)';
}

function renderActivityList(activities) {
    
    const activityCountEl = document.getElementById('activity-count');
    if (!activityCountEl) {
        console.warn('❌ No element with id="activity-count" found in the DOM. Skipping renderActivityList.');
        return;
    }
    
    // Use fallback DOM query if UIElements not ready
    const activityListContainer = UIElements.activityListContainer || document.getElementById('activity-list-container');
    const activityCardTemplate = UIElements.activityCardTemplate || document.getElementById('activity-card-template');
    
    console.log('🔍 DOM elements check:', {
        activityCountEl: !!activityCountEl,
        activityListContainer: !!activityListContainer,
        activityCardTemplate: !!activityCardTemplate,
        UIElementsReady: !!UIElements.activityListContainer
    });
    
    if (!activityListContainer) {
        console.warn('❌ No activity list container found. Skipping renderActivityList.');
        return;
    }
    
    if (!activityCardTemplate) {
        console.warn('❌ No activity card template found. Skipping renderActivityList.');
        return;
    }
    
    // EMERGENCY: Clear any skeleton loading that might be stuck
    const skeletons = activityListContainer.querySelectorAll('.skeleton-loader');
    if (skeletons.length > 0) {
        console.log(`🧹 Clearing ${skeletons.length} stuck skeleton loaders...`);
        skeletons.forEach(skeleton => skeleton.remove());
    }
    
    activityListContainer.innerHTML = ''; // Clear previous list
    activityCountEl.textContent = `(${activities.length} found)`;
    
    // We'll check the analyzed status directly from each activity object
   
    // Ensure newest activities appear first
    if (Array.isArray(activities)) {
        activities = [...activities].sort((a, b) => {
            const dateA = new Date(a.start_date || a.startDate || 0);
            const dateB = new Date(b.start_date || b.startDate || 0);
            return dateB - dateA; // descending
        });
    }
    
    activities.forEach((activity, index) => {
        
        const card = activityCardTemplate.content.cloneNode(true);
        const cardDiv = card.querySelector('div');
        
        // Add activity-card class for enhanced styling
        cardDiv.classList.add('activity-card');
        
        // Apply gradient background to header
        const gradientHeader = card.querySelector('#gradient-header');
        if (gradientHeader) {
            gradientHeader.style.background = getActivityGradient(activity.id);
        }
        
        // Populate activity data
        cardDiv.querySelector('[data-name]').textContent = activity.name;
        // Format date as DD/MM/YY
        let dateDisplay = 'N/A';
        if (activity.start_date) {
            const dateObj = new Date(activity.start_date);
            if (!isNaN(dateObj)) {
                const day = String(dateObj.getDate()).padStart(2, '0');
                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                const year = String(dateObj.getFullYear()).slice(-2);
                dateDisplay = `${day}/${month}/${year}`;
            }
        }
        cardDiv.querySelector('[data-date]').textContent = dateDisplay;
        cardDiv.querySelector('[data-type]').textContent = activity.type || '—';
        
        // Data display
        const distance = activity.distance ? (activity.distance / 1000).toFixed(2) : '0.00';
        const timeDisplay = activity.moving_time ? new Date(activity.moving_time * 1000).toISOString().substr(11, 8) : '00:00:00';
        const elevation = activity.total_elevation_gain ? activity.total_elevation_gain.toFixed(0) : '0';
        cardDiv.querySelector('[data-distance-display]').textContent = `${distance} km`;
        cardDiv.querySelector('[data-time-display]').textContent = timeDisplay;
        cardDiv.querySelector('[data-elevation-display]').textContent = `${elevation}m`;
       
        const mapEl = card.querySelector('[data-map-id]');
        mapEl.id = `map-${activity.id}`;
       
        const analyzeBtn = card.querySelector('[data-analyze-btn]');
        analyzeBtn.dataset.activityId = activity.id;
        analyzeBtn.classList.remove('btn-primary', 'btn-secondary', 'bg-gray-300', 'text-gray-700');
        
        // Check analyzed status – if the activity object says "true" keep it,
        // otherwise look it up in the unified-progress payload (covers page reloads).
        let isAnalyzed = !!activity.analyzed; // normalise to boolean
        if (!isAnalyzed) {
            try {
                const unifiedData   = JSON.parse(localStorage.getItem('swcp_unified_progress') || '{}');
                const analyzedIds   = new Set((unifiedData.analyzedActivityIds || []).map(id => String(id)));
                isAnalyzed          = analyzedIds.has(String(activity.id));
            } catch (error) {
                isAnalyzed = false; // safety fallback
            }
        }
        
        if (isAnalyzed) {
            analyzeBtn.textContent = 'Reanalyze';
            analyzeBtn.classList.add('btn-secondary');
            analyzeBtn.disabled = false;
        } else {
            analyzeBtn.textContent = 'Analyze';
            analyzeBtn.classList.add('btn-analyze');
            analyzeBtn.disabled = false;
        }
        analyzeBtn.onclick = () => analyzeSingleActivity(activity, analyzeBtn);
        const addDescriptionBtn = card.querySelector('[data-update-btn]');
        addDescriptionBtn.dataset.activityId = activity.id;
        addDescriptionBtn.onclick = () => addDescriptionToStrava(activity, addDescriptionBtn);
        
        // Set up the required "View on Strava" link
        const stravaLink = card.querySelector('[data-strava-link]');
        stravaLink.href = `https://www.strava.com/activities/${activity.id}`;
        stravaLink.dataset.activityId = activity.id;
        
        const isMobile = window.innerWidth <= 1024;
        if (isMobile) {
            cardDiv.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                showBottomSheet(cardDiv);
            });
            cardDiv.style.cursor = 'pointer';
            cardDiv.title = 'Tap to view details';
        }
        
        activityListContainer.appendChild(card);
        
        if (activity.map && activity.map.summary_polyline) {
            try {
                const latlngs = polyline.decode(activity.map.summary_polyline);
                if (latlngs.length > 0) {
                    const activityMap = L.map(mapEl.id, {
                        scrollWheelZoom: false,
                        attributionControl: false,
                        zoomControl: false,
                        dragging: false,
                        touchZoom: false,
                        doubleClickZoom: false,
                        boxZoom: false,
                        keyboard: false
                    });
                    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
                        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'
                    }).addTo(activityMap);
                    L.polyline(latlngs, {color: '#fd8640', weight: 3}).addTo(activityMap);
                    mapEl.style.filter = 'sepia(0.1) saturate(0.9) brightness(0.95)';
                    const bounds = L.latLngBounds(latlngs);
                    activityMap.fitBounds(bounds, { padding: [10, 10] });
                    setTimeout(() => {
                        activityMap.invalidateSize();
                    }, 100);
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

        // NEW: Un-process button logic
        const unprocessBtn = cardDiv.querySelector('[data-unprocess-btn]');
        if (unprocessBtn) {
            // Ensure button has correct activity id for later queries
            unprocessBtn.dataset.activityId = activity.id;
            const processedSet = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));
            const isProcessed = processedSet.has(String(activity.id));
            if (isAnalyzed || isProcessed) {
                unprocessBtn.classList.remove('hidden');
                unprocessBtn.style.display = '';
                unprocessBtn.onclick = () => unprocessActivity(activity, unprocessBtn);
            } else {
                unprocessBtn.classList.add('hidden');
                unprocessBtn.style.display = 'none';
            }
        }
    });
    
    // Use fallback DOM query for fab container too
    const fabContainer = UIElements.fabContainer || document.getElementById('fab-container');
    if (window.innerWidth <= 1024 && fabContainer) {
        fabContainer.classList.remove('hidden');
    }

    // After finishing rendering all cards, refresh latest activity tile
    renderLatestProcessedActivity();
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
   
    // The main analysisWorker.onmessage handler (defined in init) will now manage button updates.
    // We only need to ensure the worker knows which activity's button to update.
    const currentActivityId = String(activity.id); // Capture for `postMessage`

    // Prepare worker payload with optimizations
    let workerPayload = {
        type: 'process_activity',
        activityId: currentActivityId,
        activityStream: stream.latlng.data,
        existingPoints: existingPoints
    };
    
    // Apply speed optimizations to worker payload
    workerPayload = applyWorkerOptimizations(workerPayload);
    
    analysisWorker.postMessage(workerPayload);
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
   
/** Fetch activities from last 30 days only (for refresh) */
async function fetchRecentActivities() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const afterTimestamp = Math.floor(thirtyDaysAgo.getTime() / 1000);
    
    log('Fetching activities from last 30 days...', 'info');
    
    try {
        const baseUrl = 'https://www.strava.com/api/v3/athlete/activities';
        const params = `?per_page=200&after=${afterTimestamp}`;
        const url = baseUrl + params;
        
        const response = await makeStravaApiCall(url);
        if (!response || !response.ok) {
            throw new Error(`Failed to fetch recent activities: ${response?.status}`);
        }
        
        const activities = await response.json();
        return activities || [];
        
    } catch (error) {
        console.error('❌ Error fetching recent activities:', error);
        throw error;
    }
}

/** Fetch all activities from Firebase first, then Strava API if needed. */
async function fetchAllActivities(forceRefresh = false) {
    
    const fetchStartTime = Date.now();
    if (OPTIMIZATION_FEATURES.enhancedLogging) {
        enhancedLog('Starting to fetch all activities...', 'info');
    }
    
    // First, try to load from Firebase if available (unless forced refresh)
    if (!forceRefresh && window.firebaseProgressService && window.firebaseProgressService.isEnabled) {
        try {
            const needsRefresh = await window.firebaseProgressService.needsActivityRefresh();
            
            if (!needsRefresh) {
                const firebaseActivities = await window.firebaseProgressService.loadActivitiesFromFirebase();
                if (firebaseActivities && firebaseActivities.length > 0) {
                    if (OPTIMIZATION_FEATURES.enhancedLogging) {
                        enhancedLog(`Using Firebase activities (${firebaseActivities.length} activities)`, 'success', fetchStartTime);
                    }
                    log(`Loaded ${firebaseActivities.length} activities from Firebase (fast load)`, 'success');
                    return firebaseActivities;
                }
            }
        } catch (error) {
            console.error('Error loading from Firebase, falling back to Strava API:', error);
        }
    }
    
    // Fallback to localStorage cache (unless forced refresh)
    if (!forceRefresh) {
        const cachedData = localStorage.getItem(CACHED_ACTIVITIES_KEY);
        const cachedTimestamp = localStorage.getItem(CACHED_ACTIVITIES_TIMESTAMP_KEY);
        
        if (cachedData && cachedTimestamp) {
            const cacheAge = Date.now() - parseInt(cachedTimestamp);
            if (cacheAge < CACHE_EXPIRY_MS) {
                if (OPTIMIZATION_FEATURES.enhancedLogging) {
                    enhancedLog(`Using localStorage cached activities (${Math.round(cacheAge / 1000 / 60)}min old)`, 'success', fetchStartTime);
                }
                
                const cachedActivities = JSON.parse(cachedData);
                return cachedActivities;
            }
        }
    }
    
    // Need to fetch from Strava API
    log('Fetching fresh activities from Strava API...', 'info');
    
    // === PHASE 1: OPTIMIZED API DELAY ===
    // Reduce delay between API calls when parallel loading is enabled
    const apiDelay = OPTIMIZATION_FEATURES.parallelLoading ? 100 : 200; // 50% faster when optimized
    
    if (OPTIMIZATION_FEATURES.enhancedLogging) {
        enhancedLog(`Fetching from API with ${apiDelay}ms delays between requests...`, 'info');
    }
    
    let allActivities = [];
    let page = 1;
    const perPage = 200;
    
    try {
        while (page < 10) { // Max 10 pages (2000 activities) to prevent runaway
            const baseUrl = 'https://www.strava.com/api/v3/athlete/activities';
            const params = `?per_page=${perPage}&page=${page}`;
            const url = baseUrl + params;
            
            const response = await makeStravaApiCall(url);
            
            if (!response || !response.ok) {
                break;
            }
            
            const activities = await response.json();
            
            if (!activities || activities.length === 0) {
                break;
            }
            
            allActivities = allActivities.concat(activities);
            
            if (activities.length < perPage) {
                break;
            }
            
            page++;
            if (page < 10) { // Only sleep if we're going to fetch another page
                await sleep(apiDelay);
            }
        }
    } catch (error) {
        console.error('❌ Error fetching activities:', error);
        if (OPTIMIZATION_FEATURES.enhancedLogging) {
            enhancedLog(`Activity fetch failed: ${error.message}`, 'error');
        }
        throw error;
    }
    
    // Cache the activities in localStorage
    localStorage.setItem(CACHED_ACTIVITIES_KEY, JSON.stringify(allActivities));
    localStorage.setItem(CACHED_ACTIVITIES_TIMESTAMP_KEY, Date.now().toString());
    
    // Save to Firebase (with analysis status)
    if (window.firebaseProgressService && window.firebaseProgressService.isEnabled) {
        try {
            // Get current analyzed activity IDs from unified progress
            const unifiedData = JSON.parse(localStorage.getItem('swcp_unified_progress') || '{}');
            const analyzedIds = new Set(unifiedData.analyzedActivityIds || []);
            
            // Mark activities as analyzed if they're in the analyzed list
            const activitiesWithStatus = allActivities.map(activity => ({
                ...activity,
                analyzed: analyzedIds.has(String(activity.id))
            }));
            
            await window.firebaseProgressService.saveActivitiesToFirebase(activitiesWithStatus);
            log(`Saved ${allActivities.length} activities to Firebase with analysis status`, 'success');
        } catch (error) {
            console.error('Failed to save activities to Firebase:', error);
        }
    }
    
    if (OPTIMIZATION_FEATURES.enhancedLogging) {
        enhancedLog(`Successfully fetched ${allActivities.length} activities`, 'perf', fetchStartTime);
    }
    
    return allActivities;
}

async function updateProgressUI(payload) {
    // --- DEBUGGING LOGS ---
    console.log("updateProgressUI: Payload received:", payload);
    console.log("updateProgressUI: totalDistance (from payload):", payload.totalDistance);
    console.log("updateProgressUI: percentage (from payload):", payload.percentage);
    console.log("updateProgressUI: segments (from payload):", payload.segments);
    // --- END DEBUGGING LOGS ---

    // 🛡️ DATA PROTECTION: Prevent accidental data loss
    const existingPoints = JSON.parse(localStorage.getItem('swcp_completed_points') || '[]');
    const newPoints = payload.newCompletedPoints || [];
    
    // If we have existing data and new data is empty/much smaller, require confirmation
    if (existingPoints.length > 50 && newPoints.length === 0) {
        console.error('🚨 DATA PROTECTION: Refusing to overwrite', existingPoints.length, 'points with empty array');
        log(`🛡️ Data protection: Refusing to overwrite ${existingPoints.length} completed points with empty data`, 'error');
        return;
    }
    
    if (existingPoints.length > 100 && newPoints.length < (existingPoints.length * 0.1)) {
        console.error('🚨 DATA PROTECTION: Refusing to overwrite', existingPoints.length, 'points with only', newPoints.length, 'points');
        log(`🛡️ Data protection: Refusing to overwrite ${existingPoints.length} points with suspiciously small ${newPoints.length} points`, 'error');
        return;
    }
    
    // Log data protection status
    if (existingPoints.length > 0) {
        console.log(`🛡️ Data protection: ${existingPoints.length} existing points → ${newPoints.length} new points (${newPoints.length >= existingPoints.length ? 'SAFE' : 'MONITORED'})`);
    }

    // Check critical dashboard elements (always required)
    if (!UIElements.completedDistance || !UIElements.progressPercentage) {
        console.error('Critical dashboard UI elements missing - cannot update progress');
        log('Critical dashboard elements missing for progress update.', 'error');
        return;
    }
    
    // Map elements are optional - will update dashboard but skip map rendering if not ready
    const mapReady = completedSegmentsLayer && mainMap;
    if (!mapReady) {
        console.log('⏳ Map not ready yet, updating dashboard only (map will render later)');
    }
    const { segments, totalDistance, percentage, newCompletedPoints } = payload; // Destructure newCompletedPoints

    // Get processed activity IDs for stats calculations and Firebase save
    const processedIds = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));

    // Generate segments from points if not provided
    let segmentsToRender = segments;
    if (!segmentsToRender && newCompletedPoints && newCompletedPoints.length > 0) {
        segmentsToRender = groupPointsIntoSegments(newCompletedPoints);
        console.log(`📊 Generated ${segmentsToRender.length} segments from ${newCompletedPoints.length} points`);
    }

    // Only render map if map is ready
    if (mapReady) {
        completedSegmentsLayer.clearLayers();
        if (segmentsToRender && segmentsToRender.length > 0) {
            segmentsToRender.forEach(seg => {
                const leafletCoords = seg.map(c => [c[1], c[0]]);
                
                // Create a shadow/glow layer underneath
                L.polyline(leafletCoords, { 
                    color: '#fd8640', 
                    weight: 6, 
                    opacity: 0.3,
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(completedSegmentsLayer);
                
                // Main line with glow effect
                const mainLine = L.polyline(leafletCoords, { 
                    color: '#fd8640', 
                    weight: 3, 
                    opacity: 0.9,
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(completedSegmentsLayer);
                
                // Add glow effect by applying CSS class to the SVG element
                mainLine.on('add', function() {
                    const path = this.getElement();
                    if (path) {
                        path.classList.add('map-glow-3d-combined');
                    }
                });
            });
            log(`✅ Rendered ${segmentsToRender.length} completed segments on the map`, 'success');
        } else {
            log('No completed segments to render on map', 'info');
        }
    } else {
        console.log('🗺️ Map not ready, skipping map rendering (will render when map loads)');
    }

    // --- Updating text fields ---
    UIElements.completedDistance.textContent = `${parseFloat(totalDistance).toFixed(2)} km`;
    UIElements.progressPercentage.textContent = `${parseFloat(percentage).toFixed(2)}%`;
    if (UIElements.totalDistance) {
        UIElements.totalDistance.textContent = `${swcpTotalDistance.toFixed(2)} km`;
    }

    // --- Elevation Gained: handled by loading function ---
    // Note: Elevation is calculated and set by loadProgressFromStorage()
    // This avoids dependency on allFetchedActivities being loaded
   
    // --- CRITICAL: Update global currentPercentage variable ---
    currentPercentage = parseFloat(percentage); // Update the global variable here

    // --- CRITICAL FIX: Ensure newCompletedPoints are saved for persistence ---
    // This array holds all the points that define the completed sections of the path.
    // If this is not correctly saved, then on next load, `loadProgressFromStorage` will get an empty array,
    // leading to 0% overall progress being calculated by the worker.
    if (newCompletedPoints) { // Defensive check
        // Save to localStorage immediately
        localStorage.setItem(COMPLETED_POINTS_KEY, JSON.stringify(newCompletedPoints));
        
        // Backup to Firebase if available
        if (firebaseProgressService && firebaseProgressService.isEnabled) {
            firebaseProgressService.saveItem(COMPLETED_POINTS_KEY, newCompletedPoints);
        }

    } else {
        console.warn("updateProgressUI: newCompletedPoints was null or undefined in payload. Not saving to localStorage.");
    }

    // --- Time Taken: handled by loading function ---
    // Note: Time is calculated and set by loadProgressFromStorage()
    // This avoids dependency on allFetchedActivities being loaded

    // --- Remaining Distance: total - completed ---
    if (UIElements.remainingDistance) {
        const completed = parseFloat(totalDistance) || 0;
        const total = swcpTotalDistance || 630; // SWCP is 630 miles = ~1014 km
        const remaining = Math.max(total - completed, 0);
        UIElements.remainingDistance.textContent = `${remaining.toFixed(2)} km`;
        console.log(`📊 Remaining distance: ${remaining.toFixed(2)} km (${total} - ${completed})`);
    }

    log(`Overall progress updated: ${totalDistance.toFixed(2)} km (${parseFloat(percentage).toFixed(2)}%)`, 'success');
    
    // Ensure stats are always populated (fallback safety)
    setTimeout(() => ensureStatsPopulated(), 50);
    
    // Save to Firebase (source of truth) with cache update
    if (firebaseProgressService && !payload.isFromCache && !payload.isBackgroundVerification) {
        try {
            await firebaseProgressService.saveProgressToFirebase({
                completedPoints: newCompletedPoints,  // ✅ FIXED: Use newCompletedPoints from payload
                processedActivities: Array.from(processedIds),
                totalDistance: totalDistance,
                completedDistance: totalDistance,
                percentage: parseFloat(percentage)
            });
        } catch (error) {
            console.error('❌ Failed to save to Firebase:', error);
        }
    }
}

// Make functions available globally (kept for debugging access)
window.updateProgressUI = updateProgressUI;
window.log = log;
   
async function addDescriptionToStrava(activity, button) {
    button.disabled = true; button.innerHTML = `<span class="loader"></span>Adding...`;
    try {
        const responseGet = await makeStravaApiCall(`https://www.strava.com/api/v3/activities/${activity.id}`);
        if (!responseGet.ok) throw new Error(await responseGet.text());
        const fullActivity = await responseGet.json();
        const existingDescription = fullActivity.description || '';
       
        // --- MODIFIED TEXT HERE ---
        // Ensure UIElements.completedDistance and UIElements.totalDistance exist before accessing textContent
        const totalKilometersWalked = UIElements.completedDistance ? parseFloat(UIElements.completedDistance.textContent) : 0;
        const totalPathDistance = UIElements.totalDistance ? parseFloat(UIElements.totalDistance.textContent) : 0;

        // Chosen emoji: Wave
        const emojiCliffCoast = '🌊';
        const emojiHikingBoot = '🥾';

        // currentPercentage is now guaranteed to be updated by updateProgressUI
        const newTextLine1 = `${currentPercentage.toFixed(2)}% of the South West Coast Path completed! ${emojiCliffCoast}`;
        const newTextLine2 = `${totalKilometersWalked.toFixed(2)} out of ${totalPathDistance.toFixed(2)} kilometres walked ${emojiHikingBoot}`;
       
        const newText = `${newTextLine1}\n${newTextLine2}`; // Combine lines with a newline character
        // --- END MODIFIED TEXT ---

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
    // Initialize all UI elements (excluding old auth elements)
    UIElements.configSection = document.getElementById('config-section');
    UIElements.activityListContainer = document.getElementById('activity-list-container');
    UIElements.activityCardTemplate = document.getElementById('activity-card-template');
    UIElements.activityCount = document.getElementById('activity-count');
    UIElements.filterButtons = document.getElementById('filter-buttons');
    UIElements.filterButtonsMobile = document.getElementById('filter-buttons-mobile');
    UIElements.resetButton = document.getElementById('reset-button');
    UIElements.statusLog = document.getElementById('status-log');
    UIElements.stravaUserInfo = document.getElementById('strava-user-info');

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
    UIElements.loadAllActivitiesBtn   = document.getElementById('load-all-activities-btn');
    UIElements.headerSection = document.getElementById('header-section');
    UIElements.progressSummarySection = document.getElementById('progress-summary-section');
    UIElements.appBackground = document.getElementById('app-background');
    UIElements.initialLoadingScreen = document.getElementById('initial-loading-screen');

    
    // New UI elements
    UIElements.darkModeToggle = document.getElementById('dark-mode-toggle');
    // Hide dashboard dark mode toggle entirely (dashboard uses settings toggle instead)
    if (UIElements.darkModeToggle) {
        UIElements.darkModeToggle.style.display = 'none';
    }
    UIElements.mobileMenuBtn = document.getElementById('mobile-menu-btn');
    UIElements.mobileFilterMenu = document.getElementById('mobile-filter-menu');
    UIElements.activitySearchBoxMobile = document.getElementById('activity-search-box-mobile');
    UIElements.fabContainer = document.getElementById('fab-container');
    UIElements.fabMain = document.getElementById('fab-main');
    UIElements.fabMenu = document.getElementById('fab-menu');
    UIElements.fabRefresh = document.getElementById('fab-refresh');
    UIElements.fabMap = document.getElementById('fab-map');
    UIElements.mapFullscreenBtn = document.getElementById('map-fullscreen-btn');
    UIElements.bottomSheet = document.getElementById('bottom-sheet');
    UIElements.elevationGained = document.getElementById('elevation-gained');
    UIElements.timeTaken = document.getElementById('time-taken');
    UIElements.remainingDistance = document.getElementById('remaining-distance');
    // New: Latest activity elements
    UIElements.latestActivitySection = document.getElementById('latest-activity-section');
    UIElements.latestActivityContainer = document.getElementById('latest-activity-container');

    log('Application initialization started.');

    // Initialize Firebase Progress Service
    try {
        if (window.firebaseProgressService) {
            firebaseProgressService = window.firebaseProgressService;
            await firebaseProgressService.init();
            console.log('✅ Firebase Progress Service initialized');
        } else {
            console.log('📱 Firebase Progress Service not available, using localStorage only');
        }
    } catch (error) {
        console.error('❌ Failed to initialize Firebase Progress Service:', error);
    }

    // Initialize dark mode
    const savedDarkMode = localStorage.getItem(DARK_MODE_KEY) === 'true';
    if (savedDarkMode) {
        isDarkMode = true;
        document.body.classList.add('dark-mode');
        if (UIElements.darkModeToggle) {
            const icon = UIElements.darkModeToggle.querySelector('svg');
            if (icon) {
                icon.innerHTML = `
                    <circle cx="12" cy="12" r="4.5"/>
                    <path stroke-linecap="round" stroke-linejoin="round" d="
                      M12 3v1.5
                      M12 19.5V21
                      M20.2 12h-1.2
                      M5.5 12H3
                      M17.07 6.93l-1.06 1.06
                      M6.93 17.07l-1.06 1.06
                      M17.07 17.07l-1.06-1.06
                      M6.93 6.93l-1.06-1.06
                    "/>
                `;
            }
        }
    }
   
    try {
        analysisWorker = new Worker('swcp_analysis_worker.js');
        log('Analysis worker initialized. Loading Turf.js library...', 'info');
        
        // Add timeout for worker initialization
        const workerTimeout = setTimeout(() => {
            if (analysisWorker) {
                log('Worker initialization taking longer than expected - Turf.js library may be loading slowly', 'warn');
                console.warn('Worker initialization taking longer than expected. This might be due to slow Turf.js library loading.');
            }
        }, 60000); // 60 second timeout (increased from 30s)
        
        // Flag to track if worker ready message has been logged
        let workerReadyLogged = false;
        
        // This single handler is responsible for ALL messages from the worker.
        // It now uses document.querySelector to target specific buttons.
        analysisWorker.onmessage = async (e) => {
            clearTimeout(workerTimeout); // Clear timeout on first message
            
            // Only log worker ready message once
            if (!workerReadyLogged) {
                log('Worker successfully initialized and ready for analysis', 'success');
                workerReadyLogged = true;
            }
            
            const { type, payload } = e.data;
            
            // Handle worker initialization errors
            if (type === 'error' && payload && payload.activityId === 'worker_init') {
                log(`Worker initialization error: ${payload.error}`, 'error');
                alert(`Analysis system failed to initialize: ${payload.error}`);
                return;
            }
            
            if (!payload || !payload.activityId) return;
           
            const { activityId, progress, error } = payload;
            const analyzeBtn = document.querySelector(`button[data-analyze-btn][data-activity-id='${activityId}']`);
           
            if (type === 'progress') {
                if (analyzeBtn) {
                    // REAL PROGRESS: Worker analysis is 0-80% of total process
                    const realProgress = Math.round(progress * 0.8);
                    const buttonTextSpan = analyzeBtn.querySelector('.button-text');
                    if (buttonTextSpan) {
                        buttonTextSpan.textContent = `Analyzing (${realProgress}%)...`;
                    } else {
                        analyzeBtn.textContent = `Analyzing (${realProgress}%)...`;
                    }
                }
            } else if (type === 'result') {
                log(`Analysis complete for activity ${activityId}. Updating UI.`, 'success');
                console.log("Worker Result Payload (Result):", payload); // Console log final payload from worker

                if (activityId === 'background_verification' || payload.isBackgroundVerification) {
                    // Handle background verification results
                    const currentPercentageDisplay = document.getElementById('progress-percentage')?.textContent || '0';
                    const verifiedPercentage = parseFloat(payload.percentage).toFixed(2);
                    
                    if (Math.abs(parseFloat(currentPercentageDisplay) - parseFloat(verifiedPercentage)) > 0.1) {
                        log(`🔄 Verification update: ${currentPercentageDisplay}% → ${verifiedPercentage}% (cache was slightly outdated)`, 'info');
                        // Update with verified results (but quietly, no loading states)
                        updateProgressUI(payload);
                    } else {
                        log(`✅ Verification complete: Cache was accurate (${verifiedPercentage}%)`, 'success');
                    }
                    
                    // Save the verified results using unified system - fire and forget
                    saveUnifiedProgress(payload).catch(error => {
                        console.error('❌ Failed to save verified results:', error);
                    });
                    return; // Don't continue with normal processing
                }

                if (activityId !== 'initial_load') {
                    // REAL PROGRESS: Start UI rendering phase (80-100%)
                    if (analyzeBtn) {
                        const buttonTextSpan = analyzeBtn.querySelector('.button-text');
                        if (buttonTextSpan) {
                            buttonTextSpan.textContent = `Saving (85%)...`;
                        } else {
                            analyzeBtn.textContent = `Saving (85%)...`;
                        }
                    }
                    
                    // ✅ NEW UNIFIED SYSTEM: Save everything in one place
                    console.log('🔍 UNIFIED DEBUG: Worker result received:', {
                        activityId,
                        hasActivity: !!allFetchedActivities.find(act => String(act.id) === String(activityId)),
                        activityOverlapsRoute: payload.activityOverlapsRoute,
                        activityOverlapPointCount: payload.activityOverlapPointCount,
                        totalDistance: payload.totalDistance,
                        percentage: payload.percentage
                    });
                    
                    const activity = allFetchedActivities.find(act => String(act.id) === String(activityId));
                    if (activity) {
                        const overlapsRoute = payload.activityOverlapsRoute || false;
                        
                        console.log(`📊 Activity ${activity.name}: ${overlapsRoute ? 'OVERLAPS' : 'DOES NOT OVERLAP'} route (${payload.activityOverlapPointCount || 0} points)`);
                        
                        // Save using unified system
                        console.log('🔍 UNIFIED DEBUG: Calling saveUnifiedProgress...');
                        const saveResult = await saveUnifiedProgress(payload, activity, overlapsRoute);
                        console.log('🔍 UNIFIED DEBUG: Save result:', saveResult);
                        
                        if (saveResult.success) {
                            // Update UI with latest unified data
                            updateDashboardFromUnified(saveResult.data);
                            
                            // Update Firebase activity status
                            if (window.firebaseProgressService && window.firebaseProgressService.isEnabled) {
                                try {
                                    await window.firebaseProgressService.updateActivityAnalysisStatus(activityId, true);
                                    console.log(`🔥 Updated Firebase activity status for ${activityId}`);
                                } catch (error) {
                                    console.error('❌ Failed to update Firebase activity status:', error);
                                }
                            }
                            
                            // Update the activity object in allFetchedActivities for immediate UI consistency
                            const activityIndex = allFetchedActivities.findIndex(act => String(act.id) === String(activityId));
                            if (activityIndex !== -1) {
                                allFetchedActivities[activityIndex].analyzed = true;
                            }
                            
                            if (analyzeBtn) {
                                // Update button to "Reanalyze" state
                                analyzeBtn.textContent = 'Reanalyze';
                                analyzeBtn.classList.remove('btn-analyze');
                                analyzeBtn.classList.add('btn-secondary');
                                analyzeBtn.disabled = false;
                                // NEW: reveal Un-process button on same card
                                const unBtn = document.querySelector(`button[data-unprocess-btn][data-activity-id='${payload.activityId}']`);
                                if (unBtn) {
                                    unBtn.classList.remove('hidden');
                                    unBtn.style.display = '';
                                }
                            }
                            
                            log(`✅ Analysis complete for ${activity.name}. ${overlapsRoute ? 'Route progress updated.' : 'Activity tracked but does not overlap route.'}`, 'success');
                        } else {
                            console.error('❌ Failed to save unified progress:', saveResult.error);
                            log(`❌ Failed to save progress for ${activity.name}`, 'error');
                        }
                    }
                } else {
                    // This is for activityId === 'initial_load'
                    // Load complete - update UI with unified data
                    const unifiedData = await loadUnifiedProgress(true);
                    if (unifiedData) {
                        log('✅ Initial data loading complete', 'success');
                    }
                }
                
            } else if (type === 'error') {
                log(`Worker error for ${activityId}: ${error}`, 'error');
                if (analyzeBtn) {
                    analyzeBtn.textContent = 'Analysis Failed';
                    analyzeBtn.disabled = false;
                    const loaderSpan = analyzeBtn.querySelector('.loader');
                    if(loaderSpan) loaderSpan.remove(); // Remove loader
                }
                alert(`Analysis failed for activity ${activityId}: ${error}. Check console for details.`);
            }
        };

        analysisWorker.onerror = (e) => {
            log(`Critical worker error: ${e.message || 'Unknown worker error'}`, 'error');
            console.error('Web worker error details:', e);
            
            // Check if it's a Turf.js loading error
            if (e.message && e.message.includes('importScripts')) {
                alert('Failed to load required libraries from local files. Please check if turf.min.js exists in the project directory and refresh the page.');
            } else {
                alert(`A critical error occurred with the analysis worker: ${e.message || 'Check console for details'}. Please refresh the page.`);
            }
            

        };
    } catch (e) {
        log(`Failed to initialize analysis worker: ${e.message}`, 'error');
        alert('Failed to load background analysis. Progress tracking might not work. Check console for "swcp_analysis_worker.js" errors.');

    }

    // Enhanced Event Listeners (only for elements that exist in the new auth system)
    if (UIElements.resetButton) {
        UIElements.resetButton.addEventListener('click', resetProgress);
    }
    if (UIElements.filterButtons) {
        UIElements.filterButtons.addEventListener('click', handleFilterClick);
    }
    if (UIElements.filterButtonsMobile) {
        UIElements.filterButtonsMobile.addEventListener('click', handleFilterClick);
    }
    if (UIElements.activitySearchBox) {
        UIElements.activitySearchBox.addEventListener('input', debouncedSearch);
    }
    if (UIElements.refreshActivitiesBtn) {
        UIElements.refreshActivitiesBtn.addEventListener('click', refreshActivities);
    }
    // Bind Load All Activities button
    if (UIElements.loadAllActivitiesBtn) {
        UIElements.loadAllActivitiesBtn.addEventListener('click', loadAllActivities);
    }
    window.addEventListener('resize', updateGridLayout);

    // New Event Listeners
    if (UIElements.darkModeToggle) {
        UIElements.darkModeToggle.addEventListener('click', toggleDarkMode);
        updateDarkModeToggle(); // Set correct icon/label on load
    }

    if (UIElements.mobileMenuBtn) {
        UIElements.mobileMenuBtn.addEventListener('click', toggleMobileMenu);
    }

    if (UIElements.activitySearchBoxMobile) {
        UIElements.activitySearchBoxMobile.addEventListener('input', debouncedSearch);
    }

    if (UIElements.fabMain) {
        UIElements.fabMain.addEventListener('click', toggleFabMenu);
    }

    if (UIElements.fabRefresh) {
        UIElements.fabRefresh.addEventListener('click', () => {
            refreshActivities();
            toggleFabMenu();
        });
    }

    if (UIElements.fabMap) {
        UIElements.fabMap.addEventListener('click', () => {
            if (UIElements.mapSection) {
                UIElements.mapSection.scrollIntoView({ behavior: 'smooth' });
            }
            toggleFabMenu();
        });
    }

    if (UIElements.mapFullscreenBtn) {
        UIElements.mapFullscreenBtn.addEventListener('click', toggleMapFullscreen);
    }

    if (UIElements.bottomSheet) {
        UIElements.bottomSheet.addEventListener('click', (e) => {
            if (e.target === UIElements.bottomSheet) {
                hideBottomSheet();
            }
        });
    }

    // Close FAB menu when clicking outside
    document.addEventListener('click', (e) => {
        if (UIElements.fabContainer && !UIElements.fabContainer.contains(e.target)) {
            if (fabMenuOpen) {
                toggleFabMenu();
            }
        }
    });

    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
        if (UIElements.mobileMenuBtn && !UIElements.mobileMenuBtn.contains(e.target) && 
            UIElements.mobileFilterMenu && !UIElements.mobileFilterMenu.contains(e.target)) {
            if (mobileMenuOpen) {
                toggleMobileMenu();
            }
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape key closes modals and menus
        if (e.key === 'Escape') {
            if (fabMenuOpen) toggleFabMenu();
            if (mobileMenuOpen) toggleMobileMenu();
            if (UIElements.bottomSheet && !UIElements.bottomSheet.classList.contains('hidden')) {
                hideBottomSheet();
            }
        }
        
        // Ctrl/Cmd + R to refresh activities
        if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            refreshActivities();
        }
        
        // Ctrl/Cmd + M to toggle map fullscreen
        if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
            e.preventDefault();
            toggleMapFullscreen();
        }
    });

    // Note: Input field population is now handled by the auth system

    UIElements.initialLoadingScreen.classList.add('hidden'); // Hide initial loading screen

    // The auth controller will handle showing/hiding screens based on auth state
   
    updateGridLayout(); // Initial layout adjustment
};

// Wait for auth system to be ready before initializing
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for auth controller to be available
    let attempts = 0;
    while (!window.authController && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    
    if (!window.authController) {
        console.warn('Auth controller not available, proceeding anyway');
    }
    
    // Ensure stats fields are never left empty on page load
    setTimeout(() => ensureStatsPopulated(), 2000);
    
    await init();
});

// Export showMainApp for auth controller
export { showMainApp };

function syncActivitiesSectionHeight() {
    const mapCard = document.querySelector('.p-6 .rounded-2xl.shadow-xl.overflow-hidden');
    const activitiesSection = document.getElementById('activities-section');
    if (mapCard && activitiesSection) {
        const mapCardRect = mapCard.getBoundingClientRect();
        activitiesSection.style.height = mapCardRect.height + 'px';
    }
}

window.addEventListener('DOMContentLoaded', syncActivitiesSectionHeight);
window.addEventListener('resize', syncActivitiesSectionHeight);

function syncBlurredBgHeights() {
    const dashBg = document.getElementById('dashboard-blur-bg');
    const actBg = document.getElementById('activities-blur-bg');
    if (dashBg && actBg) {
        actBg.style.height = dashBg.offsetHeight + 'px';
    }
}
window.addEventListener('DOMContentLoaded', syncBlurredBgHeights);
window.addEventListener('resize', syncBlurredBgHeights);

// === PHASE 1: PERFORMANCE MONITORING ===

/**
 * Show performance summary to user (optional, for demonstration)
 * @param {number} totalLoadTime - Total time taken for the load operation
 */
function showPerformanceSummary(totalLoadTime) {
    if (!OPTIMIZATION_FEATURES.enhancedLogging) return;
    
    const seconds = (totalLoadTime / 1000).toFixed(1);
    const isOptimized = OPTIMIZATION_FEATURES.parallelLoading;
    const optimizationStatus = isOptimized ? '🚀 Optimized' : '📦 Standard';
    
    // Log to console
    console.log(`\n🎯 PERFORMANCE SUMMARY:
    └── Total Load Time: ${seconds}s
    └── Loading Mode: ${optimizationStatus}
    └── Parallel Loading: ${isOptimized ? 'Enabled' : 'Disabled'}
    └── API Delays: ${isOptimized ? '100ms' : '200ms'} between requests
    `);
    
    // Optional: Show to user (you can comment this out if too verbose)
    if (seconds < 2) {
        log(`⚡ Fast load completed in ${seconds}s`, 'success');
    } else if (seconds < 4) {
        log(`✅ Load completed in ${seconds}s`, 'success');
    } else {
        log(`📊 Load completed in ${seconds}s`, 'info');
    }
}

/**
 * Enhanced updateProgressUI with real progress tracking for UI rendering phase
 * @param {Object} payload - The result payload from worker
 * @param {HTMLElement} analyzeBtn - The analyze button to update progress on
 */
async function updateProgressUIWithProgress(payload, analyzeBtn) {
    const renderStartTime = Date.now();
    
    console.log('🔍 DEBUG: updateProgressUIWithProgress called with:', {
        activityId: payload.activityId,
        hasAnalyzeBtn: !!analyzeBtn,
        buttonHTML: analyzeBtn ? analyzeBtn.innerHTML : 'no button'
    });
    
    // Helper function to update progress
    const updateProgress = (progress, message) => {
        console.log(`🔍 DEBUG: updateProgress called - ${progress}% - ${message}`);
        if (analyzeBtn && payload.activityId !== 'initial_load') {
            const buttonTextSpan = analyzeBtn.querySelector('.button-text');
            if (buttonTextSpan) {
                console.log('🔍 DEBUG: Found .button-text span, updating it');
                buttonTextSpan.textContent = `${message} (${progress}%)...`;
            } else {
                console.log('🔍 DEBUG: No .button-text span, updating button directly');
                analyzeBtn.textContent = `${message} (${progress}%)...`;
            }
        } else {
            console.log('🔍 DEBUG: Skipping progress update (no button or initial_load)');
        }
    };
    
    try {
        // 80%: Starting UI rendering
        console.log('🔍 DEBUG: Starting UI rendering phase at 80%');
        updateProgress(80, 'Rendering');
        await sleep(10); // Small delay to ensure UI updates
        
        // 82%: Defensive checks
        console.log('🔍 DEBUG: Doing defensive checks at 82%');
        updateProgress(82, 'Preparing');
        
        console.log('🔍 DEBUG: Checking UI elements:', {
            completedSegmentsLayer: !!completedSegmentsLayer,
            completedDistance: !!UIElements.completedDistance,
            progressPercentage: !!UIElements.progressPercentage,
            mainMap: !!mainMap
        });
        
        if (!completedSegmentsLayer || !UIElements.completedDistance || !UIElements.progressPercentage || !mainMap) {
            console.error('🔍 DEBUG: UI elements missing, returning early!');
            log('Critical UI elements missing for progress update.', 'error');
            if (!mainMap && UIElements.mainMap) {
                initializeMapAndData();
            }
            return;
        }
        
        // 85%: Clear existing map layers
        console.log('🔍 DEBUG: Moving to 85% - clearing map layers');
        updateProgress(85, 'Clearing map');
        const { segments, totalDistance, percentage, newCompletedPoints } = payload;
        console.log('🔍 DEBUG: Payload data:', { segments: segments?.length, totalDistance, percentage });
        completedSegmentsLayer.clearLayers();
        await sleep(5);
        
        // 87-95%: Render map segments (if any)
        if (segments && segments.length > 0) {
            console.log(`🔍 DEBUG: Found ${segments.length} segments to render`);
            updateProgress(87, 'Drawing segments');
            
            // Render segments incrementally for better progress tracking
            const progressPerSegment = 8 / segments.length; // 8% total for segments (87%-95%)
            
            // Apply rendering optimizations to segments
            const optimizedSegments = applyRenderingOptimizations(segments);
            
            for (let i = 0; i < optimizedSegments.length; i++) {
                const seg = optimizedSegments[i];
                const leafletCoords = seg.map(c => [c[1], c[0]]);
                
                // Get optimized polyline options
                const polylineOptions = getOptimizedPolylineOptions();
                
                // Conditional glow/shadow layer (only if not optimized away)
                if (!SPEED_OPTIMIZATIONS.noGlowEffects.enabled && !SPEED_OPTIMIZATIONS.turboMode.enabled) {
                    L.polyline(leafletCoords, { 
                        color: '#fd8640', 
                        weight: 6, 
                        opacity: 0.3,
                        lineCap: 'round',
                        lineJoin: 'round'
                    }).addTo(completedSegmentsLayer);
                }
                
                // Main line
                const mainLine = L.polyline(leafletCoords, polylineOptions).addTo(completedSegmentsLayer);
                
                // Add glow effect if not optimized away
                if (!SPEED_OPTIMIZATIONS.noGlowEffects.enabled && !SPEED_OPTIMIZATIONS.turboMode.enabled) {
                    mainLine.on('add', function() {
                        const path = this.getElement();
                        if (path) {
                            path.classList.add('map-glow-3d-combined');
                        }
                    });
                }
                
                // Update progress per segment
                const currentProgress = Math.round(87 + (i + 1) * progressPerSegment);
                updateProgress(Math.min(currentProgress, 95), 'Drawing segments');
                
                // Conditional delay - reduced for optimized mode
                if (i < optimizedSegments.length - 1) {
                    const delay = (SPEED_OPTIMIZATIONS.turboMode.enabled) ? 1 : 5;
                    await sleep(delay);
                }
            }
            
            log(`Rendered ${segments.length} completed segments on the map.`, 'info');
        } else {
            updateProgress(95, 'No segments');
            log('No new completed segments to render on map.', 'info');
        }
        
        // 96%: Update text fields
        updateProgress(96, 'Updating stats');
        UIElements.completedDistance.textContent = `${parseFloat(totalDistance).toFixed(2)} km`;
        UIElements.progressPercentage.textContent = `${parseFloat(percentage).toFixed(2)}%`;
        if (UIElements.totalDistance) {
            UIElements.totalDistance.textContent = `${swcpTotalDistance.toFixed(2)} km`;
        }
        await sleep(5);
        
        // 97%: Calculate stats (conditionally deferred)
        if (SPEED_OPTIMIZATIONS.deferredStats.enabled || SPEED_OPTIMIZATIONS.turboMode.enabled) {
            updateProgress(97, 'Deferring stats');
            // Skip stats calculation for faster map rendering - will be done later
        } else {
            updateProgress(97, 'Calculating elevation');
            if (UIElements.elevationGained) {
                let elevationSum = 0;
                // Only calculate elevation if there are completed points (actual progress)
                if (newCompletedPoints && newCompletedPoints.length > 0) {
                    const processedIds = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));
                    elevationSum = allFetchedActivities.reduce((sum, act) => {
                        return processedIds.has(String(act.id)) ? sum + (Number(act.total_elevation_gain) || 0) : sum;
                    }, 0);
                }
                UIElements.elevationGained.textContent = `${Math.round(elevationSum)} m`;
            }
            
            if (UIElements.timeTaken) {
                let timeSum = 0;
                // Only calculate time if there are completed points (actual progress)
                if (newCompletedPoints && newCompletedPoints.length > 0) {
                    const processedIds = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));
                    timeSum = allFetchedActivities.reduce((sum, act) => {
                        return processedIds.has(String(act.id)) ? sum + (Number(act.moving_time) || 0) : sum;
                    }, 0);
                }
                const hours = Math.floor(timeSum / 3600);
                const minutes = Math.floor((timeSum % 3600) / 60);
                UIElements.timeTaken.textContent = `${hours}h ${minutes}m`;
            }
        }
        await sleep(5);
        
        // 98%: Save data
        updateProgress(98, 'Saving progress');
        currentPercentage = parseFloat(percentage);
        
        if (newCompletedPoints) {
            // Save to localStorage immediately
            localStorage.setItem(COMPLETED_POINTS_KEY, JSON.stringify(newCompletedPoints));
            
            // Backup to Firebase if available
            if (firebaseProgressService && firebaseProgressService.isEnabled) {
                firebaseProgressService.saveItem(COMPLETED_POINTS_KEY, newCompletedPoints);
            }
        } else {
            console.warn("updateProgressUI: newCompletedPoints was null or undefined in payload. Not saving to localStorage.");
        }
        
        // 99%: Calculate remaining distance
        updateProgress(99, 'Finalizing');
        if (UIElements.remainingDistance && UIElements.completedDistance && UIElements.totalDistance) {
            const completed = parseFloat(UIElements.completedDistance.textContent) || 0;
            const total = parseFloat(UIElements.totalDistance.textContent) || 0;
            const remaining = Math.max(total - completed, 0);
            UIElements.remainingDistance.textContent = `${remaining.toFixed(2)} km`;
        }
        await sleep(10);
        
        // 100%: Complete
        console.log('🔍 DEBUG: Reaching 100% completion');
        updateProgress(100, 'Complete');
        await sleep(100); // Brief moment to show 100%
        
        // Finalize button state
        console.log('🔍 DEBUG: Finalizing button state');
        if (analyzeBtn && payload.activityId !== 'initial_load') {
            console.log('🔍 DEBUG: Setting button to "Reanalyze"');
            analyzeBtn.textContent = 'Reanalyze';
            analyzeBtn.classList.remove('btn-primary', 'btn-secondary');
            analyzeBtn.classList.add('bg-gray-300', 'text-gray-700');
            analyzeBtn.disabled = false;
            const loaderSpan = analyzeBtn.querySelector('.loader');
            if (loaderSpan) loaderSpan.remove();
            // NEW: ensure Un-process button becomes visible
            const unBtn = document.querySelector(`button[data-unprocess-btn][data-activity-id='${payload.activityId}']`);
            if (unBtn) {
                unBtn.classList.remove('hidden');
                unBtn.style.display = '';
            }
        }
        
        const renderTime = Date.now() - renderStartTime;
        console.log(`🔍 DEBUG: updateProgressUIWithProgress completed in ${renderTime}ms`);
        log(`Overall progress updated: ${totalDistance.toFixed(2)} km (${parseFloat(percentage).toFixed(2)}%) - Render time: ${renderTime}ms`, 'success');
        
        // Save calculated results for instant loading next time
        if (firebaseProgressService && !payload.isFromCache) {
            firebaseProgressService.saveCachedResults({
                percentage: parseFloat(percentage),
                totalDistance: totalDistance,
                completedDistance: totalDistance,
                segments: segments,
                newCompletedPoints: newCompletedPoints
            });
        }
        
        // Deferred stats calculation (if enabled)
        if (SPEED_OPTIMIZATIONS.deferredStats.enabled || SPEED_OPTIMIZATIONS.turboMode.enabled) {
            setTimeout(() => {
                calculateDeferredStats();
            }, 100); // Small delay to ensure map rendering is complete
        }
        
    } catch (error) {
        console.error('🔍 DEBUG: ERROR in updateProgressUIWithProgress:', error);
        
        // Fallback to original function on error
        console.log('🔍 DEBUG: Falling back to original updateProgressUI function');
        updateProgressUI(payload);
        
        if (analyzeBtn && payload.activityId !== 'initial_load') {
            console.log('🔍 DEBUG: Restoring button state after error');
            analyzeBtn.textContent = 'Reanalyze';
            analyzeBtn.disabled = false;
            const loaderSpan = analyzeBtn.querySelector('.loader');
            if (loaderSpan) loaderSpan.remove();
        }
    }
}

// ============================================================================
// SPEED OPTIMIZATION OPTIONS
// ============================================================================

/**
 * Speed optimization features that can be enabled/disabled
 * These provide various levels of performance improvements
 */
const SPEED_OPTIMIZATIONS = {
    // === WORKER ANALYSIS OPTIMIZATIONS (0-80% phase) ===
    reducedPrecision: {
        enabled: false,
        description: "Use lower precision for GPS matching (faster but slightly less accurate)",
        impact: "30-50% faster worker analysis",
        tradeoff: "May miss very short path segments"
    },
    
    batchProcessing: {
        enabled: false, 
        description: "Process multiple activities in single worker call",
        impact: "20-40% faster for multiple activities",
        tradeoff: "Less granular progress updates"
    },
    
    skipDetailedCalcs: {
        enabled: false,
        description: "Skip elevation gain and time calculations during analysis",
        impact: "10-20% faster worker analysis", 
        tradeoff: "Stats calculated separately (minor delay)"
    },
    
    // === UI RENDERING OPTIMIZATIONS (80-100% phase) ===
    simplifiedSegments: {
        enabled: false,
        description: "Render fewer points per map segment",
        impact: "40-70% faster map rendering",
        tradeoff: "Slightly less smooth segment curves"
    },
    
    noGlowEffects: {
        enabled: false,
        description: "Remove glow/shadow effects from map segments", 
        impact: "20-30% faster map rendering",
        tradeoff: "Less visually appealing segments"
    },
    
    deferredStats: {
        enabled: false,
        description: "Calculate elevation/time stats after map rendering",
        impact: "Maps appear 200-500ms faster",
        tradeoff: "Stats populate slightly later"
    },
    
    // === EXTREME PERFORMANCE MODE ===
    turboMode: {
        enabled: false,
        description: "Enable all optimizations + reduce visual quality",
        impact: "2-3x faster overall analysis",
        tradeoff: "Reduced accuracy and visual quality"
    }
};

/**
 * Apply speed optimizations to worker analysis
 * @param {Object} workerPayload - The payload being sent to worker
 * @returns {Object} - Modified payload with optimizations
 */
function applyWorkerOptimizations(workerPayload) {
    if (SPEED_OPTIMIZATIONS.reducedPrecision.enabled || SPEED_OPTIMIZATIONS.turboMode.enabled) {
        // Reduce GPS coordinate precision for faster processing
        workerPayload.precision = 'reduced';
        workerPayload.tolerance = 15; // meters instead of default 10
    }
    
    if (SPEED_OPTIMIZATIONS.skipDetailedCalcs.enabled || SPEED_OPTIMIZATIONS.turboMode.enabled) {
        // Skip detailed calculations in worker
        workerPayload.skipElevation = true;
        workerPayload.skipTime = true;
    }
    
    return workerPayload;
}

/**
 * Apply UI rendering optimizations
 * @param {Array} segments - Map segments to render
 * @returns {Array} - Optimized segments
 */
function applyRenderingOptimizations(segments) {
    if (!segments || segments.length === 0) return segments;
    
    if (SPEED_OPTIMIZATIONS.simplifiedSegments.enabled || SPEED_OPTIMIZATIONS.turboMode.enabled) {
        // Reduce points per segment for faster rendering
        return segments.map(segment => {
            if (segment.length <= 4) return segment; // Keep short segments as-is
            
            // Keep every 3rd point for longer segments
            const simplified = [];
            for (let i = 0; i < segment.length; i += 3) {
                simplified.push(segment[i]);
            }
            // Always keep the last point
            if (simplified[simplified.length - 1] !== segment[segment.length - 1]) {
                simplified.push(segment[segment.length - 1]);
            }
            return simplified;
        });
    }
    
    return segments;
}

/**
 * Get optimized polyline options for map rendering
 * @returns {Object} - Leaflet polyline options
 */
function getOptimizedPolylineOptions() {
    const baseOptions = {
        color: '#fd8640',
        weight: 3,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
    };
    
    if (SPEED_OPTIMIZATIONS.noGlowEffects.enabled || SPEED_OPTIMIZATIONS.turboMode.enabled) {
        // Remove glow effects for faster rendering
        return baseOptions;
    }
    
    // Return options with glow effects
    return {
        ...baseOptions,
        className: 'map-glow-3d-combined'
    };
}

/**
 * Show speed optimization settings modal
 */
function showSpeedOptimizationSettings() {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-bold text-gray-900 dark:text-white">Speed Optimization Settings</h2>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            
            <div class="space-y-4">
                <div class="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                    <p class="text-sm text-blue-800 dark:text-blue-200">
                        <strong>Current Performance:</strong> Your analysis typically takes time in two phases:
                        <br>• Worker Analysis (0-80%): GPS coordinate processing
                        <br>• UI Rendering (80-100%): Map drawing and stats calculation
                    </p>
                </div>
                
                <h3 class="font-semibold text-gray-900 dark:text-white">Worker Analysis Optimizations (0-80%)</h3>
                ${generateOptimizationToggles(['reducedPrecision', 'batchProcessing', 'skipDetailedCalcs'])}
                
                <h3 class="font-semibold text-gray-900 dark:text-white">UI Rendering Optimizations (80-100%)</h3>
                ${generateOptimizationToggles(['simplifiedSegments', 'noGlowEffects', 'deferredStats'])}
                
                <h3 class="font-semibold text-gray-900 dark:text-white">Extreme Performance</h3>
                ${generateOptimizationToggles(['turboMode'])}
                
                <div class="flex justify-end space-x-2 pt-4 border-t">
                    <button onclick="resetOptimizations(); this.closest('.fixed').remove();" 
                            class="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300">
                        Reset All
                    </button>
                    <button onclick="applyOptimizations(); this.closest('.fixed').remove();" 
                            class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                        Apply Changes
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

/**
 * Generate HTML for optimization toggles
 */
function generateOptimizationToggles(optionKeys) {
    return optionKeys.map(key => {
        const option = SPEED_OPTIMIZATIONS[key];
        return `
            <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded">
                <label class="flex items-start space-x-3">
                    <input type="checkbox" ${option.enabled ? 'checked' : ''} 
                           onchange="SPEED_OPTIMIZATIONS.${key}.enabled = this.checked"
                           class="mt-1">
                    <div class="flex-1">
                        <div class="font-medium text-gray-900 dark:text-white">${option.description}</div>
                        <div class="text-sm text-green-600 dark:text-green-400">Impact: ${option.impact}</div>
                        <div class="text-sm text-yellow-600 dark:text-yellow-400">Tradeoff: ${option.tradeoff}</div>
                    </div>
                </label>
            </div>
        `;
    }).join('');
}

/**
 * Reset all optimizations to default (disabled)
 */
function resetOptimizations() {
    Object.values(SPEED_OPTIMIZATIONS).forEach(opt => opt.enabled = false);
    localStorage.removeItem('swcp_speed_optimizations');
    log('All speed optimizations reset to default (disabled)', 'info');
}

/**
 * Apply and save optimization settings
 */
function applyOptimizations() {
    // Save to localStorage
    const enabledOptimizations = {};
    Object.entries(SPEED_OPTIMIZATIONS).forEach(([key, opt]) => {
        enabledOptimizations[key] = opt.enabled;
    });
    localStorage.setItem('swcp_speed_optimizations', JSON.stringify(enabledOptimizations));
    
    // Count enabled optimizations
    const enabledCount = Object.values(SPEED_OPTIMIZATIONS).filter(opt => opt.enabled).length;
    log(`Applied ${enabledCount} speed optimizations. Changes will take effect on next analysis.`, 'success');
}

/**
 * Load saved optimization settings
 */
function loadOptimizationSettings() {
    try {
        const saved = localStorage.getItem('swcp_speed_optimizations');
        if (saved) {
            const settings = JSON.parse(saved);
            Object.entries(settings).forEach(([key, enabled]) => {
                if (SPEED_OPTIMIZATIONS[key]) {
                    SPEED_OPTIMIZATIONS[key].enabled = enabled;
                }
            });
            
            const enabledCount = Object.values(SPEED_OPTIMIZATIONS).filter(opt => opt.enabled).length;
            if (enabledCount > 0) {
                log(`Loaded ${enabledCount} saved speed optimizations`, 'info');
            }
        }
    } catch (error) {
        console.error('Error loading optimization settings:', error);
    }
}

/**
 * Calculate elevation and time stats (used for deferred optimization)
 * Only counts activities that have been analyzed for GPS progress
 */
function calculateDeferredStats() {
    try {
        // Only calculate stats from processed activities (ones that contributed to progress)
        const processedIds = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));
        
        if (processedIds.size > 0) {
            let totalElevation = 0;
            let totalTime = 0;
            let foundStats = 0;
            
            // Use saved activity statistics instead of fetched activities (more reliable)
            processedIds.forEach(activityId => {
                const activityStatsKey = `swcp_activity_stats_${activityId}`;
                const cachedActivityStats = JSON.parse(localStorage.getItem(activityStatsKey) || 'null');
                
                if (cachedActivityStats) {
                    totalElevation += cachedActivityStats.elevationGain || 0;
                    totalTime += cachedActivityStats.movingTime || 0;
                    foundStats++;
                } else {
                    // Fallback: try to get from allFetchedActivities if stats not saved
                    if (allFetchedActivities && allFetchedActivities.length > 0) {
                        const activity = allFetchedActivities.find(act => String(act.id) === String(activityId));
                        if (activity) {
                            totalElevation += activity.total_elevation_gain || 0;
                            totalTime += activity.moving_time || 0;
                            foundStats++;
                            console.log(`⚠️ Using fallback stats for activity ${activityId} (stats not saved)`);
                        }
                    }
                }
            });
            
            // Update UI elements
            if (UIElements.elevationGained) {
                UIElements.elevationGained.textContent = `${Math.round(totalElevation)} m`;
            }
            
            if (UIElements.timeTaken) {
                const hours = Math.floor(totalTime / 3600);
                const minutes = Math.floor((totalTime % 3600) / 60);
                UIElements.timeTaken.textContent = `${hours}h ${minutes}m`;
            }
            
            log(`Stats calculated from ${foundStats}/${processedIds.size} analyzed activities: ${Math.round(totalElevation)}m, ${Math.floor(totalTime/3600)}h${Math.floor((totalTime%3600)/60)}m`, 'success');
        } else {
            // No processed activities, so set stats to 0
            if (UIElements.elevationGained) {
                UIElements.elevationGained.textContent = '0 m';
            }
            if (UIElements.timeTaken) {
                UIElements.timeTaken.textContent = '0h 0m';
            }
            log('No analyzed activities - stats set to zero', 'info');
        }
        
        // Final fallback to ensure fields are never empty
        setTimeout(() => ensureStatsPopulated(), 100);
    } catch (error) {
        console.error('Error in deferred stats calculation:', error);
        // Ensure stats are set even if calculation fails
        setTimeout(() => ensureStatsPopulated(), 100);
    }
}

// Load optimization settings on startup
loadOptimizationSettings();

async function cleanStart() {
    if (confirm("🧹 CLEAN START: This will clear all progress data but keep your Strava connection. You can then re-analyze your activities. Continue?")) {
        try {
            log('🧹 Starting clean data reset...', 'warn');
            
            // Clear only progress-related data
            localStorage.removeItem('swcp_completed_points');
            localStorage.removeItem('swcp_processed_activities');
            localStorage.removeItem('swcp_cached_results');
            
            // Clear Firebase progress data
            if (firebaseProgressService && firebaseProgressService.isEnabled) {
                log('🔥 Clearing Firebase progress data...', 'warn');
                try {
                    await firebaseProgressService.saveProgressToFirebase({
                        completedPoints: [],
                        processedActivities: [],
                        totalDistance: 0,
                        completedDistance: 0,
                        percentage: 0
                    });
                    log('✅ Firebase progress data cleared', 'success');
                } catch (error) {
                    log('⚠️ Firebase clear failed: ' + error.message, 'error');
                }
            }
            
            // Reset UI to zero state
            if (UIElements.progressPercentage) UIElements.progressPercentage.textContent = '0.00%';
            if (UIElements.completedDistance) UIElements.completedDistance.textContent = '0.00';
            if (UIElements.remainingDistance) UIElements.remainingDistance.textContent = '1014.00 km';
            if (UIElements.elevationGained) UIElements.elevationGained.textContent = '0 m';
            if (UIElements.timeTaken) UIElements.timeTaken.textContent = '0h 0m';
            
            // Clear map
            if (completedSegmentsLayer) {
                completedSegmentsLayer.clearLayers();
            }
            
            log('✅ Clean start completed! You can now re-analyze your activities.', 'success');
            
        } catch (error) {
            console.error('❌ Error during clean start:', error);
            log('❌ Clean start failed: ' + error.message, 'error');
        }
    }
}

// Make available globally
window.cleanStart = cleanStart;

/**
 * UNIFIED PROGRESS SYSTEM
 * Single source of truth for all progress data
 */

/**
 * Save all progress data to Firebase in unified structure
 * @param {Object} progressData - Progress data from worker
 * @param {Object} activityData - Activity metadata (name, elevation, time, etc.)
 * @param {boolean} overlapsRoute - Whether this activity overlaps the main route
 */
async function saveUnifiedProgress(progressData, activityData = null, overlapsRoute = false) {
    console.log('🔍 SAVE DEBUG: saveUnifiedProgress called with:', {
        progressData: {
            totalDistance: progressData?.totalDistance,
            percentage: progressData?.percentage,
            newCompletedPoints: progressData?.newCompletedPoints?.length
        },
        activityData: activityData ? {
            id: activityData.id,
            name: activityData.name,
            elevation: activityData.total_elevation_gain,
            time: activityData.moving_time
        } : null,
        overlapsRoute
    });
    
    try {
        // Get current unified data directly (avoid circular dependency with loadUnifiedProgress)
        console.log('🔍 SAVE DEBUG: Getting current unified data directly...');
        let unifiedData = null;
        
        // Try localStorage first
        try {
            const localData = localStorage.getItem('swcp_unified_progress');
            if (localData) {
                unifiedData = JSON.parse(localData);
                console.log('🔍 SAVE DEBUG: Found existing unified data in localStorage');
            }
        } catch (error) {
            console.log('🔍 SAVE DEBUG: No valid unified data in localStorage');
        }
        
        // Try Firebase if no local data and Firebase is available
        if (!unifiedData && firebaseProgressService && firebaseProgressService.isEnabled) {
            try {
                const firebaseResult = await firebaseProgressService.getProgressData();
                if (firebaseResult && firebaseResult.unifiedProgressData) {
                    unifiedData = firebaseResult.unifiedProgressData;
                    console.log('🔍 SAVE DEBUG: Found existing unified data in Firebase');
                }
            } catch (error) {
                console.log('🔍 SAVE DEBUG: Error getting data from Firebase:', error);
            }
        }
        
        if (!unifiedData) {
            // Initialize new unified structure
            unifiedData = {
                // Route info (calculated once)
                totalRouteDistance: swcpTotalDistance || 0,
                
                // User progress
                completedPoints: [],
                completedDistance: 0,
                percentage: 0,
                
                // Activity tracking
                analyzedActivityIds: [],
                activityStats: {},
                
                // Stats (only from overlapping activities)
                totalElevation: 0,
                totalTime: 0,
                
                // Metadata
                lastUpdated: new Date().toISOString(),
                version: 1
            };
        }
        
        // Update progress data
        unifiedData.completedPoints = progressData.newCompletedPoints || [];
        unifiedData.completedDistance = progressData.totalDistance || 0;
        unifiedData.percentage = parseFloat(progressData.percentage) || 0;
        unifiedData.totalRouteDistance = swcpTotalDistance || unifiedData.totalRouteDistance;
        
        // Update activity data (only if provided and overlaps route)
        if (activityData && overlapsRoute) {
            const activityId = String(activityData.id);
            
            // Add to analyzed activities if not already there
            if (!unifiedData.analyzedActivityIds.includes(activityId)) {
                unifiedData.analyzedActivityIds.push(activityId);
            }
            
            // Save activity stats
            unifiedData.activityStats[activityId] = {
                name: activityData.name,
                elevation: activityData.total_elevation_gain || 0,
                time: activityData.moving_time || 0,
                date: activityData.start_date,
                overlapsRoute: true
            };
            
            // Recalculate totals from all overlapping activities
            unifiedData.totalElevation = 0;
            unifiedData.totalTime = 0;
            
            Object.values(unifiedData.activityStats).forEach(stats => {
                if (stats.overlapsRoute) {
                    unifiedData.totalElevation += stats.elevation || 0;
                    unifiedData.totalTime += stats.time || 0;
                }
            });
        } else if (activityData && !overlapsRoute) {
            // Activity doesn't overlap - still track it but don't include in stats
            const activityId = String(activityData.id);
            if (!unifiedData.analyzedActivityIds.includes(activityId)) {
                unifiedData.analyzedActivityIds.push(activityId);
            }
            
            unifiedData.activityStats[activityId] = {
                name: activityData.name,
                elevation: activityData.total_elevation_gain || 0,
                time: activityData.moving_time || 0,
                date: activityData.start_date,
                overlapsRoute: false
            };
        }
        
        unifiedData.lastUpdated = new Date().toISOString();
        
        // Save to Firebase
        console.log('🔍 SAVE DEBUG: Saving to Firebase...', {
            firebaseEnabled: firebaseProgressService && firebaseProgressService.isEnabled,
            dataSize: JSON.stringify(unifiedData).length
        });
        
        if (firebaseProgressService && firebaseProgressService.isEnabled) {
            const firebaseResult = await firebaseProgressService.saveProgressToFirebase({
                unifiedProgressData: unifiedData
            });
            console.log('🔍 SAVE DEBUG: Firebase save result:', firebaseResult);
            console.log('✅ Unified progress saved to Firebase');
        } else {
            console.log('⚠️ Firebase not enabled, skipping Firebase save');
        }
        
        // Save to localStorage as backup
        localStorage.setItem('swcp_unified_progress', JSON.stringify(unifiedData));
        console.log('✅ Unified progress saved to localStorage');
        
        // Persist daily totals for heatmap (distance per day)
        if (activityData) {
            try {
                const { writeDailyTotals } = await import('./utils/dailyTotalsWriter.js');
                await writeDailyTotals(userManager.currentUser?.uid, activityData);
            } catch (err) {
                console.warn('Failed to write daily totals:', err);
            }
        }
        
        return { success: true, data: unifiedData };
        
    } catch (error) {
        console.error('❌ Error saving unified progress:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Load all progress data from Firebase unified structure
 * @param {boolean} updateUI - Whether to update the UI (default: true)
 * @returns {Object|null} - Unified progress data or null if not found
 */
async function loadUnifiedProgress(updateUI = true) {
    try {
        let unifiedData = null;
        
        // Try Firebase first
        if (firebaseProgressService && firebaseProgressService.isEnabled) {
            const firebaseResult = await firebaseProgressService.getProgressData();
            if (firebaseResult && firebaseResult.unifiedProgressData) {
                unifiedData = firebaseResult.unifiedProgressData;
                console.log('✅ Loaded unified progress from Firebase');
            }
        }
        
        // Fallback to localStorage
        if (!unifiedData) {
            const localData = localStorage.getItem('swcp_unified_progress');
            if (localData) {
                unifiedData = JSON.parse(localData);
                console.log('✅ Loaded unified progress from localStorage');
            }
        }
        
        if (unifiedData && updateUI) {
            updateDashboardFromUnified(unifiedData);
        }
        
        return unifiedData;
        
    } catch (error) {
        console.error('❌ Error loading unified progress:', error);
        return null;
    }
}

/**
 * Update dashboard UI from unified data structure
 * @param {Object} unifiedData - Unified progress data
 */
function updateDashboardFromUnified(unifiedData) {
    try {
        // Update progress fields
        if (UIElements.completedDistance) {
            UIElements.completedDistance.textContent = `${unifiedData.completedDistance.toFixed(2)} km`;
        }
        
        if (UIElements.progressPercentage) {
            UIElements.progressPercentage.textContent = `${unifiedData.percentage.toFixed(2)}%`;
        }
        
        if (UIElements.totalDistance) {
            UIElements.totalDistance.textContent = `${unifiedData.totalRouteDistance.toFixed(2)} km`;
        }
        
        if (UIElements.remainingDistance) {
            const remaining = Math.max(unifiedData.totalRouteDistance - unifiedData.completedDistance, 0);
            UIElements.remainingDistance.textContent = `${remaining.toFixed(2)} km`;
        }
        
        // Update elevation and time (only from overlapping activities)
        if (UIElements.elevationGained) {
            UIElements.elevationGained.textContent = `${Math.round(unifiedData.totalElevation)} m`;
        }
        
        if (UIElements.timeTaken) {
            const hours = Math.floor(unifiedData.totalTime / 3600);
            const minutes = Math.floor((unifiedData.totalTime % 3600) / 60);
            UIElements.timeTaken.textContent = `${hours}h ${minutes}m`;
        }
        
        // Update global variables
        currentPercentage = unifiedData.percentage;
        
        // Update localStorage keys for compatibility
        localStorage.setItem(COMPLETED_POINTS_KEY, JSON.stringify(unifiedData.completedPoints));
        localStorage.setItem(PROCESSED_ACTIVITIES_KEY, JSON.stringify(unifiedData.analyzedActivityIds));
        
        // Render map
        if (unifiedData.completedPoints && unifiedData.completedPoints.length > 0) {
            renderMapSegmentsFromPoints(unifiedData.completedPoints);
        }
        
        const overlappingActivities = Object.values(unifiedData.activityStats).filter(stats => stats.overlapsRoute);
        log(`✅ Progress loaded: ${unifiedData.completedDistance.toFixed(2)}km (${unifiedData.percentage.toFixed(2)}%), ${overlappingActivities.length} overlapping activities`, 'success');
        
        // NEW: Update latest activity tile
        renderLatestProcessedActivity();

        // NEW: Re-render activity list now that processed/analyzed info is in place
        if (Array.isArray(allFetchedActivities) && allFetchedActivities.length > 0) {
            renderActivityList(allFetchedActivities);
        }
 
    } catch (error) {
        console.error('❌ Error updating dashboard from unified data:', error);
    }
}

/**
 * Debug function to check activity statistics
 */
/**
 * Debug the unified progress system
 */
function debugUnifiedSystem() {
    console.log('🔍 === UNIFIED SYSTEM DEBUG ===');
    
    // Check localStorage unified data
    const localUnified = localStorage.getItem('swcp_unified_progress');
    if (localUnified) {
        try {
            const data = JSON.parse(localUnified);
            console.log('📱 LocalStorage Unified Data:', {
                completedDistance: data.completedDistance,
                percentage: data.percentage,
                totalRouteDistance: data.totalRouteDistance,
                analyzedActivityCount: data.analyzedActivityIds?.length || 0,
                overlappingActivityCount: Object.values(data.activityStats || {}).filter(stats => stats.overlapsRoute).length,
                totalElevation: data.totalElevation,
                totalTime: data.totalTime,
                lastUpdated: data.lastUpdated
            });
            
            // Show activity breakdown
            if (data.activityStats) {
                console.log('📊 Activity Breakdown:');
                Object.entries(data.activityStats).forEach(([id, stats]) => {
                    console.log(`  ${stats.name}: ${stats.overlapsRoute ? '✅ OVERLAPS' : '❌ NO OVERLAP'} - ${stats.elevation}m, ${Math.floor(stats.time/60)}min`);
                });
            }
        } catch (error) {
            console.error('❌ Error parsing unified data:', error);
        }
    } else {
        console.log('❌ No unified data in localStorage');
    }
    
    // Check Firebase
    if (firebaseProgressService && firebaseProgressService.isEnabled) {
        firebaseProgressService.getProgressData().then(firebaseData => {
            if (firebaseData && firebaseData.unifiedProgressData) {
                const data = firebaseData.unifiedProgressData;
                console.log('☁️ Firebase Unified Data:', {
                    completedDistance: data.completedDistance,
                    percentage: data.percentage,
                    totalRouteDistance: data.totalRouteDistance,
                    analyzedActivityCount: data.analyzedActivityIds?.length || 0,
                    overlappingActivityCount: Object.values(data.activityStats || {}).filter(stats => stats.overlapsRoute).length,
                    totalElevation: data.totalElevation,
                    totalTime: data.totalTime,
                    lastUpdated: data.lastUpdated
                });
            } else {
                console.log('❌ No unified data in Firebase (or Firebase not available)');
            }
        }).catch(error => {
            console.error('❌ Error getting Firebase data:', error);
        });
    }
    
    // Current UI values
    console.log('🖥️ Current UI Values:', {
        completedDistance: document.getElementById('completed-distance')?.textContent,
        percentage: document.getElementById('progress-percentage')?.textContent,
        totalDistance: document.getElementById('total-distance')?.textContent,
        remainingDistance: document.getElementById('remaining-distance')?.textContent,
        elevation: document.getElementById('elevation-gained')?.textContent,
        time: document.getElementById('time-taken')?.textContent
    });
    
    console.log('🔍 === END DEBUG ===');
}

// Make debug function available globally
window.debugUnifiedSystem = debugUnifiedSystem;

/**
 * Test function to verify unified system is working
 */
async function testUnifiedSystem() {
    console.log('🧪 TESTING UNIFIED SYSTEM...');
    
    // Test saving some dummy data
    const testProgressData = {
        totalDistance: 5.5,
        percentage: 0.5,
        newCompletedPoints: [[1, 2], [3, 4], [5, 6]]
    };
    
    const testActivityData = {
        id: 'test123',
        name: 'Test Activity',
        total_elevation_gain: 250,
        moving_time: 3600,
        start_date: '2024-01-01T10:00:00Z'
    };
    
    console.log('🧪 Testing save with overlapping activity...');
    const saveResult = await saveUnifiedProgress(testProgressData, testActivityData, true);
    console.log('🧪 Save result:', saveResult);
    
    console.log('🧪 Testing load...');
    const loadResult = await loadUnifiedProgress(false);
    console.log('🧪 Load result:', loadResult);
    
    console.log('🧪 Testing debug function...');
    debugUnifiedSystem();
    
    console.log('🧪 TEST COMPLETE');
    return { saveResult, loadResult };
}

// Make test function available globally
window.testUnifiedSystem = testUnifiedSystem;



function debugActivityStatistics() {
    console.log('🔍 ACTIVITY STATISTICS DEBUG:');
    
    const processedIds = JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]');
    console.log('Processed activity IDs:', processedIds);
    
    if (processedIds.length === 0) {
        console.log('❌ No processed activities found');
        return;
    }
    
    let totalElevation = 0;
    let totalTime = 0;
    let foundStats = 0;
    
    processedIds.forEach(activityId => {
        const activityStatsKey = `swcp_activity_stats_${activityId}`;
        const statsData = localStorage.getItem(activityStatsKey);
        
        if (statsData) {
            try {
                const stats = JSON.parse(statsData);
                console.log(`✅ Activity ${activityId} (${stats.name}):`);
                console.log(`   Elevation: ${stats.elevationGain}m`);
                console.log(`   Time: ${Math.floor(stats.movingTime/60)}min`);
                console.log(`   Analyzed: ${stats.analyzedDate}`);
                
                totalElevation += stats.elevationGain || 0;
                totalTime += stats.movingTime || 0;
                foundStats++;
            } catch (error) {
                console.error(`❌ Error parsing stats for ${activityId}:`, error);
            }
        } else {
            console.log(`❌ No stats found for activity ${activityId}`);
        }
    });
    
    console.log('📊 TOTALS:');
    console.log(`   Activities with stats: ${foundStats}/${processedIds.length}`);
    console.log(`   Total elevation: ${Math.round(totalElevation)}m`);
    console.log(`   Total time: ${Math.floor(totalTime/3600)}h ${Math.floor((totalTime%3600)/60)}m`);
    
    // Check what's currently displayed
    const elevationEl = document.getElementById('elevation-gained');
    const timeEl = document.getElementById('time-taken');
    console.log('🖥️ CURRENT DISPLAY:');
    console.log(`   Elevation displayed: ${elevationEl?.textContent || 'NONE'}`);
    console.log(`   Time displayed: ${timeEl?.textContent || 'NONE'}`);
    
    return {
        processedCount: processedIds.length,
        statsCount: foundStats,
        totalElevation,
        totalTime
    };
}

// Make available globally
window.debugActivityStatistics = debugActivityStatistics;

/**
 * TEMPORARY DEBUG FUNCTION: Reset all activities to "Analyze" status
 * This is a one-off function to test if the fresh start fix works properly
 */
function resetAllActivitiesToAnalyze() {
    console.log('🔄 Resetting all activities to "Analyze" status...');
    
    // Reset in-memory activities
    if (allFetchedActivities && allFetchedActivities.length > 0) {
        allFetchedActivities.forEach(activity => {
            activity.analyzed = false;
        });
        console.log(`✅ Reset ${allFetchedActivities.length} activities in memory`);
    }
    
    // Clear unified progress data that tracks analyzed activities
    localStorage.removeItem('swcp_unified_progress');
    console.log('✅ Cleared unified progress data');
    
    // Clear processed activities list
    localStorage.removeItem(PROCESSED_ACTIVITIES_KEY);
    console.log('✅ Cleared processed activities list');
    
    // Re-render the activity list to update UI
    if (allFetchedActivities && allFetchedActivities.length > 0) {
        renderActivityList(allFetchedActivities);
        console.log('✅ Re-rendered activity list');
    }
    
    console.log('🎯 All activities reset to "Analyze" status - you can now test the fresh start button');
}

// Make the function globally available for console access
window.resetAllActivitiesToAnalyze = resetAllActivitiesToAnalyze;

// ===============================================
// 🚀 RESPONSIVE NAVIGATION SYSTEM
// ===============================================
// Added for mobile/desktop navigation without modifying existing functionality

// Navigation state management
const Navigation = {
    currentPage: 'dashboard',
    
    // Initialize navigation
    init() {
        console.log('🔍 Navigation.init() called');
        this.setupTabNavigation();
        this.setupDesktopSidebarToggle();
        this.setupSettingsIntegration();
        
        // Set initial page
        this.showPage('dashboard');
        console.log('✅ Navigation initialized successfully');
    },
    
    // Setup tab navigation for both mobile and desktop
    setupTabNavigation() {
        console.log('🔍 Setting up tab navigation...');
        
        // Mobile navigation tabs
        const mobileNavTabs = document.querySelectorAll('.mobile-nav-tab');
        console.log(`🔍 Found ${mobileNavTabs.length} mobile navigation tabs`);
        
        mobileNavTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                const page = tab.getAttribute('data-page');
                console.log(`🔍 Mobile tab clicked: ${page}`);
                this.showPage(page);
                this.setActiveTab(tab, 'mobile');
            });
        });
        
        // Desktop navigation tabs
        const desktopNavTabs = document.querySelectorAll('.desktop-nav-tab');
        console.log(`🔍 Found ${desktopNavTabs.length} desktop navigation tabs`);
        
        desktopNavTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                const page = tab.getAttribute('data-page');
                if(!page){
                    return; // ignore non-navigation tiles (e.g., profile avatar)
                }
                console.log(`🔍 Desktop tab clicked: ${page}`);
                this.showPage(page);
                this.setActiveTab(tab, 'desktop');
            });
        });
    },
    
    // Setup desktop sidebar collapse toggle
    setupDesktopSidebarToggle() {
        const toggleBtn = document.getElementById('nav-toggle-btn');
        const desktopNav = document.getElementById('desktop-nav');
        
        // Force hide loading screen to prevent z-index conflicts
        const loadingScreen = document.getElementById('initial-loading-screen');
        if (loadingScreen) {
            loadingScreen.style.display = 'none';
            loadingScreen.classList.add('hidden');
        }
        
        if (toggleBtn && desktopNav) {
            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                desktopNav.classList.toggle('collapsed');
                
                // Store collapse state in localStorage
                const isCollapsed = desktopNav.classList.contains('collapsed');
                localStorage.setItem('sidebarCollapsed', isCollapsed.toString());
            });
            
            // Restore collapse state from localStorage
            const savedState = localStorage.getItem('sidebarCollapsed');
            if (savedState === 'true') {
                desktopNav.classList.add('collapsed');
            }
        }
    },
    
    // Show specific page and hide others
    showPage(pageId) {
        console.log(`🔍 showPage called with pageId: ${pageId}`);
        
        // Hide all pages
        const allPages = document.querySelectorAll('.page-container');
        console.log(`🔍 Found ${allPages.length} page containers`);
        
        allPages.forEach(page => {
            console.log(`🔍 Hiding page: ${page.id}`);
            page.classList.remove('active');
        });
        
        // Show target page
        const targetPage = document.getElementById(`${pageId}-page`);
        console.log(`🔍 Target page element:`, targetPage);
        
        if (targetPage) {
            targetPage.classList.add('active');
            this.currentPage = pageId;
            
            // Debug the actual state after setting active
            const computedStyle = getComputedStyle(targetPage);
            const hasActiveClass = targetPage.classList.contains('active');
            const isVisible = computedStyle.display !== 'none';
            const hasContent = targetPage.children.length > 0;
            
            console.log(`🔍 Page ${pageId} debug:`, {
                hasActiveClass,
                display: computedStyle.display,
                visibility: computedStyle.visibility,
                opacity: computedStyle.opacity,
                isVisible,
                hasContent,
                classList: Array.from(targetPage.classList),
                // Add positioning debug
                position: computedStyle.position,
                top: computedStyle.top,
                left: computedStyle.left,
                zIndex: computedStyle.zIndex,
                width: computedStyle.width,
                height: computedStyle.height,
                // Check if it's in viewport
                boundingRect: targetPage.getBoundingClientRect()
            });
            
            // Force the page to be absolutely visible
            if (pageId === 'activities') {
                targetPage.style.position = 'static !important';
                targetPage.style.top = '0 !important';
                targetPage.style.left = '0 !important';
                targetPage.style.zIndex = '9999 !important';
                targetPage.style.backgroundColor = 'rgba(0, 255, 0, 0.3) !important';
                targetPage.style.border = '5px solid blue !important';
                targetPage.style.minHeight = '100vh !important';
                console.log('🔧 FORCED activities page positioning and visibility');
            }
            
            // Special debugging for activities page
            if (pageId === 'activities') {
                const activitiesSection = targetPage.querySelector('#activities-section');
                console.log(`🔍 Activities section found:`, !!activitiesSection);
                if (activitiesSection) {
                    const sectionStyle = getComputedStyle(activitiesSection);
                    console.log(`🔍 Activities section debug:`, {
                        display: sectionStyle.display,
                        height: sectionStyle.height,
                        minHeight: sectionStyle.minHeight,
                        visibility: sectionStyle.visibility,
                        opacity: sectionStyle.opacity
                    });
                    
                    // Force fix the height issue
                    if (sectionStyle.height === '0px' || sectionStyle.height === '0') {
                        activitiesSection.style.height = 'auto !important';
                        activitiesSection.style.minHeight = '500px !important';
                        console.log('🔧 FORCED activities section height fix');
                    }
                    
                    // Debug the content inside activities section
                    console.log('🔍 Activities section content debug:');
                    console.log('- Children count:', activitiesSection.children.length);
                    console.log('- Inner HTML length:', activitiesSection.innerHTML.length);
                    
                    // Check if activity list container exists and has content
                    const activityListContainer = activitiesSection.querySelector('#activity-list-container');
                    if (activityListContainer) {
                        console.log('- Activity list container found, children:', activityListContainer.children.length);
                        console.log('- Activity list container display:', getComputedStyle(activityListContainer).display);
                    } else {
                        console.log('- ❌ Activity list container NOT found');
                    }
                    
                    // Add temporary visible border to see the section boundaries
                    activitiesSection.style.border = '3px solid red !important';
                    activitiesSection.style.backgroundColor = 'rgba(255, 255, 0, 0.2) !important';
                    console.log('🔧 Added yellow background and red border for debugging');
                }
            }
            
            console.log(`✅ Showed page: ${pageId}`);
            
            // Handle special page logic
            this.handlePageSpecificLogic(pageId);
        } else {
            console.error(`❌ Page not found: ${pageId}-page`);
        }
    },
    
    // Set active tab styling
    setActiveTab(activeTab, navType) {
        // Remove active class from all tabs of this type
        const selector = navType === 'mobile' ? '.mobile-nav-tab' : '.desktop-nav-tab';
        const allTabs = document.querySelectorAll(selector);
        allTabs.forEach(tab => tab.classList.remove('active'));
        
        // Add active class to clicked tab
        activeTab.classList.add('active');
    },
    
    // Handle page-specific logic when switching
    handlePageSpecificLogic(pageId) {
        switch (pageId) {
            case 'dashboard':
                console.log('🏠 Dashboard page logic triggered');
                // Show main layout container if hidden
                const mainLayout = document.getElementById('main-layout-container');
                if (mainLayout && mainLayout.classList.contains('hidden')) {
                    mainLayout.classList.remove('hidden');
                }
                
                // Always try to re-center maps when switching to dashboard
                console.log('🏠 Setting up map reinitialization timeout');
                setTimeout(() => {
                    try {
                        console.log('🏠 About to call recenterMainMap');
                        recenterMainMap();
                    } catch (mainMapError) {
                        console.warn('🏠 Main map recentering failed:', mainMapError);
                    }
                    
                    try {
                        // Center the recent activity map using dedicated function
                        console.log('🏠 About to call recenterLatestActivityMap');
                        recenterLatestActivityMap();
                    } catch (recentMapError) {
                        console.warn('🏠 Recent activity map recentering failed:', recentMapError);
                    }
                }, 100);
                break;
                
            case 'activities':
                // Fix the height issue on activities section
                const activitiesSection = document.getElementById('activities-section');
                if (activitiesSection) {
                    // Remove the problematic height: 0px style
                    activitiesSection.style.height = 'auto';
                    activitiesSection.style.minHeight = '500px';
                    console.log('🔧 Fixed activities section height');
                }
                
                // First, display activities already in memory (respect any active filters)
                if (typeof allFetchedActivities !== 'undefined' && allFetchedActivities && allFetchedActivities.length > 0) {
                    setTimeout(() => {
                        const listToShow = (typeof filterActivities === 'function') ? filterActivities() : allFetchedActivities;
                        renderActivityList(listToShow);
                    }, 50);
                }
                // Then auto-refresh if container is empty and user is connected
                else if (typeof refreshActivities === 'function') {
                    const activityContainer = document.getElementById('activity-list-container');
                    if (activityContainer && !activityContainer.children.length && localStorage.getItem(STRAVA_ACCESS_TOKEN_KEY)) {
                        setTimeout(() => refreshActivities(), 100);
                    }
                }
                break;
                
            case 'status':
                // Status log is already loaded, no special action needed
                break;
                
            case 'settings':
                // Update settings with current state
                this.updateSettingsPage();
                break;
        }
    },
    
    // Setup settings page integration with existing functionality
    setupSettingsIntegration() {
        // Settings page Strava connect button
        const settingsStravaBtn = document.querySelector('#settings-strava-connect .strava-connect-btn');
        if (settingsStravaBtn) {
            settingsStravaBtn.addEventListener('click', () => {
                // Use existing Strava auth function
                if (typeof authorizeStrava === 'function') {
                    authorizeStrava();
                }
            });
        }
        
        // Settings page disconnect button  
        const settingsDisconnectBtn = document.getElementById('settings-disconnect-btn');
        if (settingsDisconnectBtn) {
            settingsDisconnectBtn.addEventListener('click', () => {
                // Use existing disconnect function
                if (typeof disconnectStrava === 'function') {
                    disconnectStrava();
                }
            });
        }
        
        // Settings dark mode toggle
        const settingsDarkModeToggle = document.getElementById('settings-dark-mode-toggle');
        if (settingsDarkModeToggle) {
            settingsDarkModeToggle.addEventListener('click', (e) => {
                // Toggle theme class on body
                const currentlyDark = document.body.classList.contains('dark-mode');
                document.body.classList.toggle('dark-mode', !currentlyDark);
                localStorage.setItem(DARK_MODE_KEY, (!currentlyDark).toString());

                // Persist to Firebase if available
                try {
                    if (window.userManager && typeof window.userManager.updatePreferences === 'function') {
                        window.userManager.updatePreferences({ darkMode: !currentlyDark });
                    }
                } catch (err) { console.warn('Dark mode Firebase save failed', err); }

                // Update toggle visuals
                const btn = e.currentTarget;
                const knob = btn.querySelector('div');
                btn.classList.toggle('bg-green-600', !currentlyDark);
                btn.classList.toggle('bg-gray-300', currentlyDark);
                if (knob) knob.classList.toggle('translate-x-6', !currentlyDark);
                btn.blur();
            });
        }
        
        // Settings toggles for preferences
        this.setupSettingsToggles();
    },
    
    // Setup settings toggle switches
    setupSettingsToggles() {
        // Auto-refresh toggle
        const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
        if (autoRefreshToggle) {
            // Load saved state
            const autoRefresh = localStorage.getItem('autoRefreshActivities') !== 'false';
            autoRefreshToggle.checked = autoRefresh;
            
            autoRefreshToggle.addEventListener('change', () => {
                localStorage.setItem('autoRefreshActivities', autoRefreshToggle.checked.toString());
            });
        }
        
        // Detailed progress toggle
        const detailedProgressToggle = document.getElementById('detailed-progress-toggle');
        if (detailedProgressToggle) {
            // Load saved state
            const detailedProgress = localStorage.getItem('showDetailedProgress') === 'true';
            detailedProgressToggle.checked = detailedProgress;
            
            detailedProgressToggle.addEventListener('change', () => {
                localStorage.setItem('showDetailedProgress', detailedProgressToggle.checked.toString());
                // Could trigger UI updates here
            });
        }
    },
    
    // Update settings page with current app state
    async updateSettingsPage() {
        // Update Strava connection status
        const isConnected = localStorage.getItem(STRAVA_ACCESS_TOKEN_KEY);
        const connectSection = document.getElementById('settings-strava-connect');
        const connectedSection = document.getElementById('settings-strava-connected');
        
        if (isConnected) {
            if (connectSection) connectSection.style.display = 'none';
            if (connectedSection) connectedSection.style.display = 'block';
        } else {
            if (connectSection) connectSection.style.display = 'block';
            if (connectedSection) connectedSection.style.display = 'none';
        }
        
        // Update athlete info
        const athleteName = document.getElementById('settings-athlete-name');
        const athleteStats = document.getElementById('settings-athlete-stats');
        
        if (isConnected && athleteName && athleteStats) {
            // Always attempt to refresh profile to pick up latest counts
            let athleteData = await refreshAthleteInfo();
            if (!athleteData) {
                // Fall back to cached data if network/auth failed
                const cachedStr = localStorage.getItem('strava_athlete') || localStorage.getItem('stravaAthlete');
                if (cachedStr) {
                    try { athleteData = JSON.parse(cachedStr); } catch(e) {}
                }
            }

            if (athleteData) {
                const fullName = `${athleteData.firstname ?? ''} ${athleteData.lastname ?? ''}`.trim() || 'Strava User';
                athleteName.textContent = fullName;
                const followers = athleteData.follower_count ?? athleteData.followers ?? 0;
                const following = athleteData.friend_count ?? athleteData.following ?? 0;
                athleteStats.textContent = `${followers} followers · ${following} following`;

                // Photo
                const photoImg = document.getElementById('settings-athlete-photo');
                if (photoImg) {
                    const photoUrl = athleteData.profile_medium || athleteData.profile;
                    if (photoUrl && !photoUrl.includes('avatar/athlete/large.png')) {
                        photoImg.src = photoUrl;
                    }
                }

                // Location
                const locationEl = document.getElementById('settings-athlete-location');
                if (locationEl) {
                    const locationParts = [athleteData.city, athleteData.state, athleteData.country].filter(Boolean);
                    locationEl.textContent = locationParts.join(', ');
                }

                // Premium badge
                const premiumEl = document.getElementById('settings-athlete-premium');
                if (premiumEl) {
                    premiumEl.classList.toggle('hidden', !athleteData.premium);
                }
            } else {
                athleteName.textContent = 'Strava User';
                athleteStats.textContent = 'Followers unavailable';
            }
        }
        
        // Update dark mode toggle
        const darkModeToggle = document.getElementById('settings-dark-mode-toggle');
        if (darkModeToggle) {
            const knob = darkModeToggle.querySelector('div');
            const active = document.body.classList.contains('dark-mode');
            darkModeToggle.classList.toggle('bg-green-600', active);
            darkModeToggle.classList.toggle('bg-gray-300', !active);
            if (knob) knob.classList.toggle('translate-x-6', active);
        }
    }
};

// Initialize navigation when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Ensure sidebar elements are interactive
    const testBtn = document.getElementById('nav-toggle-btn');
    if (testBtn) {
        const sidebar = document.getElementById('desktop-nav');
        if (sidebar) {
            sidebar.style.pointerEvents = 'auto';
            sidebar.style.zIndex = '1000';
            sidebar.style.position = 'fixed';
        }
        
        testBtn.style.pointerEvents = 'auto';
        testBtn.style.zIndex = '1001';
    }
    
    // Add slight delay to ensure all elements are rendered
    setTimeout(() => {
        Navigation.init();
    }, 100);
});

// Debug function to get complete positioning info
window.debugActivitiesPosition = function() {
    const page = document.getElementById('activities-page');
    if (!page) {
        console.log('❌ Activities page not found');
        return;
    }
    
    const rect = page.getBoundingClientRect();
    const style = getComputedStyle(page);
    
    console.log('=== ACTIVITIES PAGE POSITION DEBUG ===');
    console.log('Element:', page);
    console.log('Class list:', Array.from(page.classList));
    console.log('Display:', style.display);
    console.log('Visibility:', style.visibility);
    console.log('Opacity:', style.opacity);
    console.log('Position:', style.position);
    console.log('Top:', style.top);
    console.log('Left:', style.left);
    console.log('Width:', style.width);
    console.log('Height:', style.height);
    console.log('Z-index:', style.zIndex);
    console.log('Transform:', style.transform);
    console.log('Bounding rect:', {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        inViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth
    });
    console.log('Parent container:', page.parentElement);
    console.log('=== END POSITION DEBUG ===');
};

// Debug function to inspect activities page HTML
window.debugActivitiesHTML = function() {
    const activitiesPage = document.getElementById('activities-page');
    if (activitiesPage) {
        console.log('=== ACTIVITIES PAGE HTML ===');
        console.log('Page classes:', activitiesPage.className);
        console.log('Page innerHTML:');
        console.log(activitiesPage.innerHTML);
        console.log('=== END ACTIVITIES HTML ===');
    } else {
        console.log('❌ Activities page not found');
    }
};

// Debug function to check navigation state
window.debugNavigation = function() {
    console.log('=== NAVIGATION DEBUG ===');
    console.log('Current page:', Navigation.currentPage);
    
    const mainContainer = document.getElementById('main-layout-container');
    console.log('Main container:', mainContainer);
    console.log('Main container classes:', mainContainer?.className);
    console.log('Main container hidden:', mainContainer?.classList.contains('hidden'));
    
    const pageContainers = document.querySelectorAll('.page-container');
    console.log(`Found ${pageContainers.length} page containers:`);
    
    pageContainers.forEach(page => {
        console.log(`- ${page.id}: active=${page.classList.contains('active')}, display=${getComputedStyle(page).display}`);
    });
    
    const mobileNavTabs = document.querySelectorAll('.mobile-nav-tab');
    const desktopNavTabs = document.querySelectorAll('.desktop-nav-tab');
    console.log(`Mobile nav tabs: ${mobileNavTabs.length}`);
    console.log(`Desktop nav tabs: ${desktopNavTabs.length}`);
    
    console.log('=== END DEBUG ===');
};

// Test function to cycle through pages
window.testNavigation = function() {
    console.log('🧪 Testing navigation by cycling through pages...');
    const pages = ['dashboard', 'activities', 'status', 'settings'];
    let currentIndex = 0;
    
    const testInterval = setInterval(() => {
        const page = pages[currentIndex];
        console.log(`🧪 Testing page: ${page}`);
        Navigation.showPage(page);
        
        // Check if content is visible
        const pageElement = document.getElementById(`${page}-page`);
        if (pageElement) {
            const displayStyle = getComputedStyle(pageElement).display;
            const hasContent = pageElement.children.length > 0;
            console.log(`🔍 Page ${page}: display=${displayStyle}, hasContent=${hasContent}`);
            
            if (page === 'activities') {
                const activitiesSection = document.getElementById('activities-section');
                console.log(`🔍 Activities section found:`, !!activitiesSection);
            }
            if (page === 'status') {
                const statusSection = document.getElementById('status-log-section-container');
                console.log(`🔍 Status section found:`, !!statusSection);
            }
            if (page === 'settings') {
                const settingsContent = pageElement.querySelector('.blurred-tile-background');
                console.log(`🔍 Settings content found:`, !!settingsContent);
            }
        }
        
        currentIndex++;
        if (currentIndex >= pages.length) {
            clearInterval(testInterval);
            console.log('🧪 Navigation test complete! Check if pages switched.');
            Navigation.showPage('dashboard'); // Return to dashboard
        }
    }, 2000);
};

// Export for potential external use
window.Navigation = Navigation;

// ... insert near end of script (before init or after map init) ...
window.addEventListener('visibilitychange', () => {
    if (!document.hidden && typeof mainMap !== 'undefined' && mainMap) {
        setTimeout(() => {
            try { mainMap.invalidateSize(); } catch(e) { console.warn('Map invalidate failed', e); }
        }, 100);
    }
});

// NEW: Helper to render most recent processed activity on dashboard
async function renderLatestProcessedActivity(attempt = 0) {
    try {
        const MAX_ATTEMPTS = 5;
        const container = UIElements.latestActivityContainer || document.getElementById('latest-activity-container');
        if (!container) return;

        // Clear previous content and show a small loader
        container.innerHTML = '<div class="loader-large mx-auto"></div>';

        const processedIds = JSON.parse(localStorage.getItem('swcp_processed_activities') || '[]');
        if (processedIds.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center">No analyzed activities yet.</p>';
            return;
        }

        // Wait until activities are fetched (allFetchedActivities length) or give up after retries
        if ((!Array.isArray(allFetchedActivities) || allFetchedActivities.length === 0) && attempt < MAX_ATTEMPTS) {
            return setTimeout(() => renderLatestProcessedActivity(attempt + 1), 400);
        }

        // If no processed activities yet, fall back to most recent overall
        const useFallbackLatest = processedIds.length === 0;

        // Determine the most recent activity by date among the chosen ID list
        const idList = useFallbackLatest ? (Array.isArray(allFetchedActivities) ? allFetchedActivities.map(a => a.id) : []) : processedIds;

        let latestActivity = null;

        for (const id of idList) {
            const act = await getActivityById(id);
            if (!act || !act.start_date) continue;
            if (!latestActivity) {
                latestActivity = act;
            } else {
                const tsCurrent = new Date(act.start_date).getTime();
                const tsLatest = new Date(latestActivity.start_date).getTime();
                if (tsCurrent > tsLatest) latestActivity = act;
            }
        }

        const activity = latestActivity;

        const renderCard = (act) => {
            if (!act) {
                container.innerHTML = '<p class="text-gray-500 text-center">Latest activity details not available.</p>';
                return;
            }
            const template = UIElements.activityCardTemplate || document.getElementById('activity-card-template');
            if (!template) {
                container.innerHTML = '<p class="text-gray-500 text-center">Template missing.</p>';
                return;
            }
            const card = template.content.cloneNode(true);
            const cardDiv = card.querySelector('div');
            // Remove analyze / description buttons for dashboard view
            cardDiv.querySelector('[data-analyze-btn]')?.remove();
            cardDiv.querySelector('[data-update-btn]')?.remove();

            // Populate fields (same logic as renderActivityList)
            const gradientHeader = cardDiv.querySelector('#gradient-header');
            if (gradientHeader) {
                gradientHeader.style.background = getActivityGradient(act.id);
            }
            cardDiv.querySelector('[data-name]').textContent = act.name;
            const dateObj = new Date(act.start_date);
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = String(dateObj.getFullYear()).slice(-2);
            cardDiv.querySelector('[data-date]').textContent = `${day}/${month}/${year}`;
            cardDiv.querySelector('[data-type]').textContent = act.type;
            cardDiv.querySelector('[data-distance-display]').textContent = `${(act.distance / 1000).toFixed(2)} km`;
            cardDiv.querySelector('[data-time-display]').textContent = new Date(act.moving_time * 1000).toISOString().substr(11, 8);
            cardDiv.querySelector('[data-elevation-display]').textContent = `${act.total_elevation_gain.toFixed(0)}m`;

            // Strava link
            const stravaLink = cardDiv.querySelector('[data-strava-link]');
            if (stravaLink) stravaLink.href = `https://www.strava.com/activities/${act.id}`;

            // Map
            const mapEl = cardDiv.querySelector('[data-map-id]');
            if (mapEl) {
                mapEl.id = `latest-map-${act.id}`;
            }

            // Append to container
            container.innerHTML = '';
            container.appendChild(card);

            // Render mini map if polyline present
            if (act.map && act.map.summary_polyline) {
                try {
                    const latlngs = polyline.decode(act.map.summary_polyline);
                    if (latlngs.length > 0) {
                        const activityMap = L.map(mapEl.id, {
                            scrollWheelZoom: false,
                            attributionControl: false,
                            zoomControl: false,
                            dragging: false,
                            touchZoom: false,
                            doubleClickZoom: false,
                            boxZoom: false,
                            keyboard: false
                        });
                        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
                            attribution: 'Tiles © Esri'
                        }).addTo(activityMap);
                        L.polyline(latlngs, { color: '#fd8640', weight: 3 }).addTo(activityMap);
                        const bounds = L.latLngBounds(latlngs);
                        activityMap.fitBounds(bounds, { padding: [10, 10] });
                        setTimeout(() => {
                            activityMap.invalidateSize();
                        }, 100);
                        mapEl.style.filter = 'sepia(0.1) saturate(0.9) brightness(0.95)';
                        // Store reference globally for resize fixes
                        window.latestActivityMap = activityMap;
                        // Save bounds globally so we can re-fit after tab switches
                        window.latestActivityMapBounds = bounds;
                    }
                } catch (e) {
                    console.warn('Failed to render latest activity map:', e);
                    mapEl.innerHTML = '<div class="text-center text-gray-500 pt-8 text-sm">Map not available.</div>';
                }
            }
        };

        // If we already have the activity, render immediately
        if (activity) {
            renderCard(activity);
        } else {
            container.innerHTML = '<p class="text-gray-500 text-center">Failed to load latest activity.</p>';
        }
    } catch (error) {
        console.error('Error in renderLatestProcessedActivity:', error);
    }
}

async function unprocessActivity(activity, button) {
    if (!activity) return;
    if (!confirm(`Remove \"${activity.name}\" from processed activities?`)) return;
    try {
        button.disabled = true;
        button.textContent = 'Removing...';
        // Update processed IDs list
        const processedIds = JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]').filter(id => String(id) !== String(activity.id));
        localStorage.setItem(PROCESSED_ACTIVITIES_KEY, JSON.stringify(processedIds));

        // Update unified progress data – remove activity and clear points so we can rebuild from scratch
        const unifiedRaw = localStorage.getItem('swcp_unified_progress');
        if (unifiedRaw) {
            const unified = JSON.parse(unifiedRaw);
            unified.analyzedActivityIds = unified.analyzedActivityIds.filter(id => String(id) !== String(activity.id));
            delete unified.activityStats[String(activity.id)];
            unified.completedPoints       = [];
            unified.completedDistance     = 0;
            unified.percentage            = 0;
            unified.totalElevation        = 0;
            unified.totalTime             = 0;
            localStorage.setItem('swcp_unified_progress', JSON.stringify(unified));
        }

        // Remove unified blob entirely so rebuild starts clean
        localStorage.removeItem('swcp_unified_progress');
 
        // Remove cached stats for activity
        localStorage.removeItem(`swcp_activity_stats_${activity.id}`);

        // Optionally sync Firebase
        if (firebaseProgressService && firebaseProgressService.isEnabled) {
            try {
                await firebaseProgressService.saveProgressToFirebase({ removeActivityId: activity.id });
            } catch (err) {
                console.warn('Firebase sync failed', err);
            }
        }

        // Refresh UI elements (latest tile will update after rebuild)
 
        // Mark this activity as not analysed in the in-memory list and refresh the card
        const idx = Array.isArray(allFetchedActivities) ? allFetchedActivities.findIndex(a => String(a.id) === String(activity.id)) : -1;
        if (idx > -1) {
            allFetchedActivities[idx].analyzed = false;
        }

        // Re-render list so Analyse / Un-process buttons update instantly
        if (Array.isArray(allFetchedActivities) && allFetchedActivities.length > 0) {
            renderActivityList(allFetchedActivities);
        }

        // --------------------------------------------
        // Re-analyse every remaining processed activity
        // --------------------------------------------
        for (const id of processedIds) {
            const act = allFetchedActivities?.find(a => String(a.id) === String(id));
            const analyzeBtn = document.querySelector(`button[data-analyze-btn][data-activity-id='${id}']`);
            if (act && analyzeBtn && !analyzeBtn.disabled) {
                analyzeSingleActivity(act, analyzeBtn);
            }
        }

        button.textContent = 'Removed';
        button.classList.add('hidden');
    } catch (err) {
        console.error('Unprocess failed', err);
        button.textContent = 'Error';
    } finally {
        setTimeout(() => { if (button) { button.disabled = false; button.textContent = 'Un-process'; } }, 3000);
    }
}

// Load All Activities button (full sync)
async function loadAllActivities() {
    const loadBtn = UIElements.loadAllActivitiesBtn;
    if (!loadBtn) return;

    console.log('🟢 Load All Activities button clicked');
    const originalHTML = loadBtn.innerHTML;
    loadBtn.innerHTML = 'Loading all activities...';
    loadBtn.disabled = true;

    try {
        await fetchAndRenderActivities(true); // forceRefresh = true fetches full history
        loadBtn.innerHTML = 'All activities loaded';
    } catch (error) {
        console.error('❌ Error loading all activities:', error);
        loadBtn.innerHTML = 'Load failed – try again';
    }

    // Reset after 3 s
    setTimeout(() => {
        loadBtn.innerHTML = originalHTML;
        loadBtn.disabled = false;
    }, 3000);
}

function recenterLatestActivityMap() {
    console.log('🗺️ recenterLatestActivityMap called');
    if (!window.latestActivityMap) return;
    console.log('🗺️ latestActivityMap exists, proceeding with recentering');
    // Use two RAFs to wait for layout
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            try {
                console.log('🗺️ Calling invalidateSize()');
                window.latestActivityMap.invalidateSize();
                let bounds = window.latestActivityMapBounds;
                console.log('🗺️ Stored bounds:', bounds);
                if (!bounds && window.latestActivityMap._layers) {
                    const layer = Object.values(window.latestActivityMap._layers).find(l => l && typeof l.getBounds === 'function');
                    console.log('🗺️ Found layer for bounds:', !!layer);
                    if (layer) bounds = layer.getBounds();
                    console.log('🗺️ Calculated bounds from layer:', bounds);
                }
                if (bounds) {
                    console.log('🗺️ Fitting to bounds:', bounds);
                    window.latestActivityMap.fitBounds(bounds, { padding: [10,10] });
                } else {
                    console.log('🗺️ No bounds available, trying to set default view');
                    // Fallback: set a default view for UK southwest coast
                    window.latestActivityMap.setView([50.5, -4.0], 10);
                }
            } catch(e) { 
                console.error('🗺️ Error in recenterLatestActivityMap:', e);
            }
        });
    });
}

function recenterMainMap() {
    console.log('🗺️ recenterMainMap called');
    if (!mainMap) {
        console.log('🗺️ mainMap not available');
        return;
    }
    console.log('🗺️ mainMap exists, proceeding with recentering');
    
    // Use two RAFs to wait for layout, same approach as latest activity map
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            try {
                console.log('🗺️ Calling mainMap.invalidateSize()');
                mainMap.invalidateSize();
                
                // Try to get bounds from existing layers
                let bounds = null;
                
                // First priority: get bounds from completed segments layer
                if (completedSegmentsLayer && completedSegmentsLayer.getLayers().length > 0) {
                    try {
                        bounds = completedSegmentsLayer.getBounds();
                        console.log('🗺️ Using completed segments bounds:', bounds);
                    } catch(e) {
                        console.log('🗺️ Could not get completed segments bounds:', e);
                    }
                }
                
                // Second priority: get bounds from all layers on the map
                if (!bounds && mainMap._layers) {
                    const layers = Object.values(mainMap._layers);
                    const layersWithBounds = layers.filter(l => l && typeof l.getBounds === 'function');
                    console.log('🗺️ Found layers with bounds:', layersWithBounds.length);
                    
                    if (layersWithBounds.length > 0) {
                        try {
                            // Combine bounds from all layers
                            bounds = layersWithBounds[0].getBounds();
                            for (let i = 1; i < layersWithBounds.length; i++) {
                                bounds.extend(layersWithBounds[i].getBounds());
                            }
                            console.log('🗺️ Using combined layer bounds:', bounds);
                        } catch(e) {
                            console.log('🗺️ Could not combine layer bounds:', e);
                        }
                    }
                }
                
                // Apply bounds or fallback
                if (bounds && bounds.isValid && bounds.isValid()) {
                    console.log('🗺️ Fitting to calculated bounds');
                    mainMap.fitBounds(bounds, { padding: [20, 20] });
                } else {
                    console.log('🗺️ No valid bounds available, using SWCP default view');
                    // Fallback: SWCP area default view (same as initialization)
                    mainMap.setView([50.55, -3.75], 9); // Center of SWCP area
                }
                
                // Additional delay for final size adjustment
                setTimeout(() => {
                    try {
                        mainMap.invalidateSize();
                        console.log('🗺️ Final invalidateSize() completed');
                    } catch(e) {
                        console.log('🗺️ Final invalidateSize() failed:', e);
                    }
                }, 300);
                
            } catch(e) { 
                console.error('🗺️ Error in recenterMainMap:', e);
            }
        });
    });
}

async function getActivityById(id) {
    // Try cached list first
    if (Array.isArray(allFetchedActivities)) {
        const cached = allFetchedActivities.find(a => String(a.id) === String(id));
        if (cached) return cached;
    }
    // Fallback: fetch from Strava API
    try {
        const fetched = await makeStravaApiCall(`https://www.strava.com/api/v3/activities/${id}`);
        if (Array.isArray(allFetchedActivities)) allFetchedActivities.push(fetched);
        return fetched;
    } catch (err) {
        console.warn('Failed fetching activity', id, err);
        return null;
    }
}
