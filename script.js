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

/**
 * Toggles dark mode and saves preference to localStorage
 */
function toggleDarkMode() {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('dark-mode', isDarkMode);
    localStorage.setItem(DARK_MODE_KEY, isDarkMode.toString());
    updateDarkModeToggle();
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
                UIElements.activitiesSection.style.top = '1.5rem'; // Ensure sticky top is set
            }
            UIElements.mainLayoutContainer.dataset.layout = 'desktop';
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
    if (!UIElements.activitiesLoadingSpinner) return;
    
    // Show enhanced loading state
    showEnhancedLoading(UIElements.activitiesLoadingSpinner, 'Fetching your activities from Strava...', true);
    
    try {
        allFetchedActivities = await fetchAllActivities();
        if (allFetchedActivities === null) {
            log('Failed to fetch activities. Please check your connection and try again.', 'error');
            UIElements.activitiesLoadingSpinner.classList.add('hidden');
            return;
        }
        
        const filteredActivities = filterActivities();
        renderActivityList(filteredActivities);
        
        log(`Successfully loaded and rendered ${filteredActivities.length} activities.`, 'success');
    } catch (error) {
        log(`Error fetching activities: ${error.message}`, 'error');
    } finally {
        UIElements.activitiesLoadingSpinner.classList.add('hidden');
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
        // Correctly send existingPoints to worker for initial_load calculation
        analysisWorker.postMessage({ type: 'process_activity', activityId: 'initial_load', activityStream: null, existingPoints: completedPoints });
    } else {
        // If no completed points, immediately update UI to 0 and hide loader
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
    if (!UIElements.activitySearchBox || !UIElements.filterButtons) return [];

    const searchTerm = UIElements.activitySearchBox.value.toLowerCase();
    const activeFilterBtn = UIElements.filterButtons.querySelector('.filter-btn.active');
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
    UIElements.filterButtons.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');
    
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
    
    // Show skeleton loading while fetching
    if (UIElements.activityListContainer) {
        showSkeletonLoading(UIElements.activityListContainer, 5);
    }
    
    await fetchAndRenderActivities();
}

// Function to generate consistent pine green gradient for all activity cards
function getActivityGradient(activityId) {
    // Use the new pine green gradient for all activity cards
    return 'linear-gradient(135deg, #5a8a5e 0%, #4a7a4e 100%)';
}

function renderActivityList(activities) {
    const activityCountEl = document.getElementById('activity-count');
    if (!activityCountEl) {
        console.warn('No element with id="activity-count" found in the DOM. Skipping renderActivityList.');
        return;
    }
    if (!UIElements.activityListContainer) return;
    UIElements.activityListContainer.innerHTML = ''; // Clear previous list
    activityCountEl.textContent = `(${activities.length} found)`;
    const processedIds = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));
   
    activities.forEach(activity => {
        const card = UIElements.activityCardTemplate.content.cloneNode(true);
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
        const dateObj = new Date(activity.start_date);
        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = String(dateObj.getFullYear()).slice(-2);
        cardDiv.querySelector('[data-date]').textContent = `${day}/${month}/${year}`;
        cardDiv.querySelector('[data-type]').textContent = activity.type;
        
        // Data display
        const distance = (activity.distance / 1000).toFixed(2);
        const time = new Date(activity.moving_time * 1000).toISOString().substr(11, 8);
        const elevation = activity.total_elevation_gain.toFixed(0);
        cardDiv.querySelector('[data-distance-display]').textContent = `${distance} km`;
        cardDiv.querySelector('[data-time-display]').textContent = time;
        cardDiv.querySelector('[data-elevation-display]').textContent = `${elevation}m`;
       
        const mapEl = card.querySelector('[data-map-id]');
        mapEl.id = `map-${activity.id}`;
       
        const analyzeBtn = card.querySelector('[data-analyze-btn]');
        analyzeBtn.dataset.activityId = activity.id;
        analyzeBtn.classList.remove('btn-primary', 'btn-secondary', 'bg-gray-300', 'text-gray-700');
        if (processedIds.has(String(activity.id))) {
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
        const isMobile = window.innerWidth <= 1024;
        if (isMobile) {
            cardDiv.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                showBottomSheet(cardDiv);
            });
            cardDiv.style.cursor = 'pointer';
            cardDiv.title = 'Tap to view details';
        }
        UIElements.activityListContainer.appendChild(card);
        if (activity.map && activity.map.summary_polyline) {
            try {
                const latlngs = polyline.decode(activity.map.summary_polyline);
                if (latlngs.length > 0) {
                    const activityMap = L.map(mapEl.id, {
                        scrollWheelZoom: false,
                        attributionControl: false,
                        zoomControl: false
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
    });
    if (window.innerWidth <= 1024 && UIElements.fabContainer) {
        UIElements.fabContainer.classList.remove('hidden');
    }
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
    // --- DEBUGGING LOGS ---
    console.log("updateProgressUI: Payload received:", payload);
    console.log("updateProgressUI: totalDistance (from payload):", payload.totalDistance);
    console.log("updateProgressUI: percentage (from payload):", payload.percentage);
    console.log("updateProgressUI: segments (from payload):", payload.segments);
    // --- END DEBUGGING LOGS ---

    // Defensive checks for UIElements properties being non-null
    if (!completedSegmentsLayer || !UIElements.completedDistance || !UIElements.progressPercentage || !UIElements.progressBar || !mainMap) {
        console.error('UI elements or map for progress update are not ready. Cannot update UI. Re-initializing map if possible.');
        log('Critical UI elements missing for progress update.', 'error');
        // Attempt to re-initialize map if components are missing (might already be done by init)
        if (!mainMap && UIElements.mainMap) {
            initializeMapAndData(); // Re-init map
        }
        return; // Exit if critical elements are truly missing
    }
    const { segments, totalDistance, percentage, newCompletedPoints } = payload; // Destructure newCompletedPoints

    completedSegmentsLayer.clearLayers();
    if (segments && segments.length > 0) {
        segments.forEach(seg => {
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
        log(`Rendered ${segments.length} completed segments on the map.`, 'info');
    } else {
        log('No new completed segments to render on map.', 'info');
    }

    // --- Updating text fields and progress bar ---
    UIElements.completedDistance.textContent = parseFloat(totalDistance).toFixed(2);
    UIElements.progressPercentage.textContent = `${parseFloat(percentage).toFixed(2)}%`;
    UIElements.progressBar.style.width = `${parseFloat(percentage)}%`;
    if (UIElements.totalDistance) {
        UIElements.totalDistance.textContent = `${swcpTotalDistance.toFixed(2)} km`;
    }

    // --- Elevation Gained: sum from processed (SWCP) activities only ---
    if (UIElements.elevationGained) {
        let elevationSum = 0;
        // Get processed activity IDs from localStorage
        const processedIds = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));
        if (Array.isArray(allFetchedActivities) && allFetchedActivities.length > 0) {
            elevationSum = allFetchedActivities.reduce((sum, act) => {
                if (processedIds.has(String(act.id))) {
                    return sum + (Number(act.total_elevation_gain) || 0);
                }
                return sum;
            }, 0);
        }
        UIElements.elevationGained.textContent = `${Math.round(elevationSum)} m`;
    }
   
    // --- CRITICAL: Update global currentPercentage variable ---
    currentPercentage = parseFloat(percentage); // Update the global variable here

    // --- CRITICAL FIX: Ensure newCompletedPoints are saved for persistence ---
    // This array holds all the points that define the completed sections of the path.
    // If this is not correctly saved, then on next load, `loadProgressFromStorage` will get an empty array,
    // leading to 0% overall progress being calculated by the worker.
    if (newCompletedPoints) { // Defensive check
        localStorage.setItem(COMPLETED_POINTS_KEY, JSON.stringify(newCompletedPoints));
        console.log("updateProgressUI: Saved newCompletedPoints to localStorage:", newCompletedPoints.length);
    } else {
        console.warn("updateProgressUI: newCompletedPoints was null or undefined in payload. Not saving to localStorage.");
    }

    // --- Time Taken: sum from processed (SWCP) activities only ---
    if (UIElements.timeTaken) {
        let timeSum = 0;
        const processedIds = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));
        if (Array.isArray(allFetchedActivities) && allFetchedActivities.length > 0) {
            timeSum = allFetchedActivities.reduce((sum, act) => {
                if (processedIds.has(String(act.id))) {
                    return sum + (Number(act.moving_time) || 0);
                }
                return sum;
            }, 0);
        }
        // Format as Hh Mm
        const hours = Math.floor(timeSum / 3600);
        const minutes = Math.floor((timeSum % 3600) / 60);
        UIElements.timeTaken.textContent = `${hours}h ${minutes}m`;
    }

    // --- Remaining Distance: total - completed ---
    if (UIElements.remainingDistance && UIElements.completedDistance && UIElements.totalDistance) {
        const completed = parseFloat(UIElements.completedDistance.textContent) || 0;
        const total = parseFloat(UIElements.totalDistance.textContent) || 0;
        const remaining = Math.max(total - completed, 0);
        UIElements.remainingDistance.textContent = `${remaining.toFixed(2)} km`;
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
    // Initialize all UI elements
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
    
    // New UI elements
    UIElements.darkModeToggle = document.getElementById('dark-mode-toggle');
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

    log('Application initialization started.');

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
        log('Analysis worker initialized.', 'success');
        
        // Add timeout for worker initialization
        const workerTimeout = setTimeout(() => {
            if (analysisWorker) {
                log('Worker initialization taking longer than expected - Turf.js library may be loading slowly', 'warn');
                console.warn('Worker initialization taking longer than expected. This might be due to slow Turf.js library loading.');
            }
        }, 30000); // 30 second timeout
        
        // This single handler is responsible for ALL messages from the worker.
        // It now uses document.querySelector to target specific buttons.
        analysisWorker.onmessage = (e) => {
            clearTimeout(workerTimeout); // Clear timeout on first message
            log('Worker successfully initialized and ready for analysis', 'success');
            const { type, payload } = e.data;
            
            // Handle worker initialization errors
            if (type === 'error' && payload && payload.activityId === 'worker_init') {
                log(`Worker initialization error: ${payload.error}`, 'error');
                alert(`Analysis system failed to initialize: ${payload.error}`);
                if (UIElements.overallProgressLoading) {
                    UIElements.overallProgressLoading.classList.add('hidden');
                }
                return;
            }
            
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
                console.log("Worker Result Payload (Result):", payload); // Console log final payload from worker

                if (activityId !== 'initial_load') {
                    if(analyzeBtn) {
                        analyzeBtn.textContent = 'Reanalyze';
                        analyzeBtn.classList.remove('btn-primary', 'btn-secondary'); // Clean slate
                        analyzeBtn.classList.add('bg-gray-300', 'text-gray-700'); // Apply grey styling
                        analyzeBtn.disabled = false;
                        const loaderSpan = analyzeBtn.querySelector('.loader');
                        if(loaderSpan) loaderSpan.remove(); // Remove loader
                    }
                    const processedIds = new Set(JSON.parse(localStorage.getItem(PROCESSED_ACTIVITIES_KEY) || '[]'));
                    processedIds.add(activityId);
                    localStorage.setItem(PROCESSED_ACTIVITIES_KEY, JSON.stringify(Array.from(processedIds)));
                } else { // This is for activityId === 'initial_load'
                    // --- HIDE OVERALL PROGRESS LOADING INDICATOR ---
                    if (UIElements.overallProgressLoading) {
                        UIElements.overallProgressLoading.classList.add('hidden');
                    }
                }
                updateProgressUI(payload); // Update main progress bar and map segments
            } else if (type === 'error') {
                log(`Worker error for ${activityId}: ${error}`, 'error');
                if (analyzeBtn) {
                    analyzeBtn.textContent = 'Analysis Failed';
                    analyzeBtn.disabled = false;
                    const loaderSpan = analyzeBtn.querySelector('.loader');
                    if(loaderSpan) loaderSpan.remove(); // Remove loader
                }
                alert(`Analysis failed for activity ${activityId}: ${error}. Check console for details.`);
                // Hide overall progress loading indicator also on initial load error
                if (activityId === 'initial_load' && UIElements.overallProgressLoading) {
                    UIElements.overallProgressLoading.classList.add('hidden');
                }
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
            
            // Hide progress indicator if worker crashes
            if (UIElements.overallProgressLoading) {
                UIElements.overallProgressLoading.classList.add('hidden');
            }
        };
    } catch (e) {
        log(`Failed to initialize analysis worker: ${e.message}`, 'error');
        alert('Failed to load background analysis. Progress tracking might not work. Check console for "swcp_analysis_worker.js" errors.');
        // Hide progress indicator if worker fails to initialize
        if (UIElements.overallProgressLoading) {
            UIElements.overallProgressLoading.classList.add('hidden');
        }
    }

    // Enhanced Event Listeners
    UIElements.connectButton.addEventListener('click', connectToStrava);
    UIElements.resetButton.addEventListener('click', resetProgress);
    UIElements.filterButtons.addEventListener('click', handleFilterClick);
    UIElements.activitySearchBox.addEventListener('input', debouncedSearch);
    UIElements.refreshActivitiesBtn.addEventListener('click', refreshActivities);
    UIElements.clientId.addEventListener('input', checkInputs);
    UIElements.clientSecret.addEventListener('input', checkInputs);
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

    // Populate input fields from local storage (if available)
    UIElements.clientId.value = localStorage.getItem('stravaClientId') || '';
    UIElements.clientSecret.value = localStorage.getItem('stravaClientSecret') || '';
    checkInputs(); // Check inputs immediately to enable/disable connect button

    // Handle Strava OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    const authError = urlParams.get('error'); // Check for OAuth errors

    UIElements.initialLoadingScreen.classList.add('hidden'); // Hide initial loading screen

    if (authError) {
        log(`Strava OAuth Error: ${authError}. Please try connecting again.`, 'error');
        alert(`Strava connection failed: ${authError}`);
        UIElements.loginScreenWrapper.classList.remove('hidden'); // Show login screen on error
    } else if (authCode) {
        // We've been redirected back from Strava with a code
        UIElements.loginScreenWrapper.innerHTML = `<div class="text-center p-8"><div class="loader mr-3"></div><span class="text-gray-500 text-lg">Authenticating...</span></div>`;
        UIElements.loginScreenWrapper.classList.remove('hidden');
        await getAccessToken(authCode);
    } else if (localStorage.getItem(STRAVA_ACCESS_TOKEN_KEY)) {
        // User has existing tokens, show main app
        UIElements.mainLayoutContainer.classList.remove('hidden');
        if (UIElements.fabContainer) {
            UIElements.fabContainer.classList.remove('hidden');
        }
        await showMainApp();
    } else {
        // No code, no existing token, show login screen
        UIElements.loginScreenWrapper.classList.remove('hidden');
    }
   
    updateGridLayout(); // Initial layout adjustment
};

document.addEventListener('DOMContentLoaded', init);

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
