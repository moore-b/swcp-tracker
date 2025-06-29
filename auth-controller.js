// Authentication Controller for SWCP Tracker
// Integrates Firebase Authentication with existing app functionality

import { userManager } from './auth.js';

class AuthController {
    constructor() {
        this.isInitialized = false;
        this.authElements = {};
        this.currentUserProfile = null;
        this.modifiedStorageFunctions = false;
    }

    // Initialize authentication system
    async init() {
        if (this.isInitialized) return;

        console.log('🚀 AuthController init starting...');
        console.log('🔍 Initial state check:', {
            hasUser: !!userManager.getCurrentUser(),
            isAuthenticated: userManager.isAuthenticated(),
            currentUser: userManager.getCurrentUser(),
            localStorage: Object.keys(localStorage),
            sessionStorage: Object.keys(sessionStorage)
        });

        this.setupAuthElements();
        this.setupEventListeners();
        this.modifyExistingStorageFunctions();
        
        // Check for OAuth callback first
        const urlParams = new URLSearchParams(window.location.search);
        const authCode = urlParams.get('code');
        const authError = urlParams.get('error');
        
        if (authCode) {
            // Check if we've already processed this code to prevent reuse
            const processedCode = sessionStorage.getItem('processed_oauth_code');
            if (processedCode === authCode) {
                console.log('🔄 OAuth code already processed, cleaning URL and continuing...');
                // Clean URL and continue with normal flow
                window.history.replaceState({}, document.title, window.location.pathname);
            } else {
                console.log('🆕 OAuth code detected, storing for later processing:', authCode);
                // Store the code to process after authentication
                sessionStorage.setItem('pending_oauth_code', authCode);
                sessionStorage.setItem('processed_oauth_code', authCode);
            }
        }
        
        if (authError) {
            console.error(`Strava OAuth Error: ${authError}`);
            alert(`Strava connection failed: ${authError}`);
            // Clean URL
            window.location.href = window.location.pathname;
            return;
        }
        
        // Set up auth state listener
        userManager.onAuthStateChange((user) => {
            console.log('🔔 Auth state change triggered:', {
                hasUser: !!user,
                userUid: user ? user.uid : 'none',
                userEmail: user ? user.email : 'none',
                fullUser: user
            });
            this.handleAuthStateChange(user);
            
            // Notify Firebase Progress Service of auth state changes
            if (window.firebaseProgressService) {
                window.firebaseProgressService.onAuthStateChange(user);
            }
        });
        
        this.isInitialized = true;
        console.log('AuthController initialized');
    }

    // Setup authentication UI elements
    setupAuthElements() {
        // Auth screen elements
        this.authElements.authScreenWrapper = document.getElementById('auth-screen-wrapper');
        this.authElements.signinTab = document.getElementById('signin-tab');
        this.authElements.signupTab = document.getElementById('signup-tab');
        this.authElements.signinForm = document.getElementById('signin-form');
        this.authElements.signupForm = document.getElementById('signup-form');
        this.authElements.signinFormElement = document.getElementById('signin-form-element');
        this.authElements.signupFormElement = document.getElementById('signup-form-element');
        
        // User menu elements (now in settings page)
        this.authElements.settingsUserName = document.getElementById('settings-user-name');
        this.authElements.settingsUserEmail = document.getElementById('settings-user-email');
        this.authElements.settingsAvatarInitial = document.getElementById('settings-avatar-initial');
        this.authElements.settingsLogoutBtn = document.getElementById('settings-logout-btn');
        
        // Strava connection elements
        this.authElements.stravaConnectionBtn = document.getElementById('strava-connection-btn');
        this.authElements.stravaConnectionModal = document.getElementById('strava-connection-modal');
        this.authElements.stravaConnectionText = document.getElementById('strava-connection-text');
        this.authElements.modalClientId = document.getElementById('modal-clientId');
        this.authElements.modalClientSecret = document.getElementById('modal-clientSecret');
        this.authElements.modalConnectBtn = document.getElementById('modal-connect-btn');
        this.authElements.modalCancelBtn = document.getElementById('modal-cancel-btn');
        
        // Form switching elements
        this.authElements.switchToSignup = document.getElementById('switch-to-signup');
        this.authElements.switchToSignin = document.getElementById('switch-to-signin');
    }

    // Setup event listeners
    setupEventListeners() {
        // Tab switching
        this.authElements.signinTab?.addEventListener('click', () => this.switchToSignin());
        this.authElements.signupTab?.addEventListener('click', () => this.switchToSignup());
        this.authElements.switchToSignup?.addEventListener('click', () => this.switchToSignup());
        this.authElements.switchToSignin?.addEventListener('click', () => this.switchToSignin());

        // Form submissions
        this.authElements.signinFormElement?.addEventListener('submit', (e) => this.handleSignin(e));
        this.authElements.signupFormElement?.addEventListener('submit', (e) => this.handleSignup(e));

        // Settings logout button
        this.authElements.settingsLogoutBtn?.addEventListener('click', (e) => {
            console.log('🚪 Settings logout button clicked!');
            e.preventDefault();
            e.stopPropagation();
            this.handleSignout(e);
        });

        // Strava connection
        if (this.authElements.stravaConnectionBtn) {
            console.log('✅ Strava connection button found and event listener added');
            this.authElements.stravaConnectionBtn.addEventListener('click', async () => {
                // If user is already connected, ask if they want to disconnect
                if (this.currentUserProfile?.stravaConnected) {
                    const disconnect = confirm('You are currently connected to Strava. Do you want to disconnect?');
                    if (disconnect) {
                        await this.handleStravaDisconnect();
                    }
                } else {
                    // Show the full connection screen
                    this.showStravaConnectionScreen();
                }
            });
        } else {
            console.error('❌ Strava connection button NOT found!');
        }
        this.authElements.modalConnectBtn?.addEventListener('click', () => this.handleStravaConnect());
        this.authElements.modalCancelBtn?.addEventListener('click', () => this.hideStravaModal());

        // Close modals on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideStravaModal();
            }
        });

        // Debug: Add keyboard shortcut to force show Strava connection screen
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'S') {
                console.log('Force showing Strava connection screen');
                this.showStravaConnectionScreen();
            }
            
            // Debug: Add keyboard shortcut to force sign out
            if (e.ctrlKey && e.shiftKey && e.key === 'O') {
                console.log('Force signing out user');
                this.handleSignout();
            }
            
            // Debug: Add keyboard shortcut to test credentials
            if (e.ctrlKey && e.shiftKey && e.key === 'C') {
                console.log('🔑 Testing credentials...');
                console.log('Global:', {
                    clientId: window.STRAVA_CLIENT_ID ? 'SET' : 'NOT SET',
                    clientSecret: window.STRAVA_CLIENT_SECRET ? 'SET' : 'NOT SET'
                });
            }
            
            // Debug: Add keyboard shortcut to force show login screen
            if (e.ctrlKey && e.shiftKey && e.key === 'L') {
                console.log('🔒 Force showing login screen...');
                // Clear all auth data and force show login
                localStorage.clear();
                sessionStorage.clear();
                userManager.signOut().then(() => {
                    this.showAuthScreen();
                });
            }
            
            // Debug: Add keyboard shortcut to enable session-only mode
            if (e.ctrlKey && e.shiftKey && e.key === 'P') {
                console.log('🔓 Enabling session-only persistence mode...');
                sessionStorage.setItem('forceSessionOnly', 'true');
                location.reload();
            }
        });

        // Profile photo upload
        const avatarWrapper = document.getElementById('settings-avatar-wrapper');
        const fileInput = document.getElementById('profile-photo-input');
        if (avatarWrapper && fileInput) {
            avatarWrapper.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;

                // Compress image to max 300x300 JPEG 0.8 quality
                const compressedBlob = await this.compressImage(file, 300, 0.8);
                if (!compressedBlob) return;

                // Maintain original file name but ensure .jpg extension to match compressed format
                let uploadName = file.name.replace(/\.[^/.]+$/, '.jpg');
                const res = await userManager.uploadProfilePhoto(compressedBlob, uploadName);
                if (res.success) {
                    this.currentUserProfile.profilePhotoUrl = res.url;
                    this.updateUserDisplay();
                    alert('Profile photo updated');
                } else {
                    alert('Photo upload failed: ' + res.error);
                }
            });
        }
    }

    // Modify existing localStorage functions to be user-specific
    modifyExistingStorageFunctions() {
        if (this.modifiedStorageFunctions) return;

        // Store original functions
        const originalGetItem = localStorage.getItem.bind(localStorage);
        const originalSetItem = localStorage.setItem.bind(localStorage);
        const originalRemoveItem = localStorage.removeItem.bind(localStorage);

        // Override localStorage methods
        localStorage.getItem = (key) => {
            if (this.isUserSpecificKey(key)) {
                const data = userManager.getUserData(key, null);
                // Return as JSON string to match localStorage behavior
                return data !== null ? JSON.stringify(data) : null;
            }
            const result = originalGetItem(key);
            return result;
        };

        localStorage.setItem = (key, value) => {
            if (this.isUserSpecificKey(key)) {
                // For user-specific keys, we need to handle the value properly
                // setUserData expects the raw value and will JSON.stringify it
                // But if we're already getting a JSON string, we need to parse it first
                let actualValue = value;
                try {
                    // Try to parse as JSON - if it works, it was already stringified
                    actualValue = JSON.parse(value);
                } catch (e) {
                    // If parsing fails, it's probably a raw string value, use as-is
                    actualValue = value;
                }
                userManager.setUserData(key, actualValue);
                return;
            }
            originalSetItem(key, value);
        };

        localStorage.removeItem = (key) => {
            if (this.isUserSpecificKey(key)) {
                userManager.setUserData(key, null);
                return;
            }
            originalRemoveItem(key);
        };

        this.modifiedStorageFunctions = true;
    }

    // Check if a key should be user-specific
    isUserSpecificKey(key) {
        const userSpecificKeys = [
            'swcp_processed_activities',
            'swcp_completed_points',
            'swcp_cached_activities',
            'swcp_cached_activities_timestamp',
            'swcp_unified_progress',  // CRITICAL: New unified progress system
            'stravaAccessToken',
            'stravaRefreshToken',
            'stravaExpiresAt',
            'stravaAthlete',
            'stravaClientId',
            'stravaClientSecret',
            'swcp_dark_mode'
        ];
        
        const isUserSpecific = userSpecificKeys.includes(key) || key.startsWith('swcp_activity_stream_') || key.startsWith('swcp_activity_stats_');
        console.log(`🔍 isUserSpecificKey("${key}"):`, isUserSpecific);
        return isUserSpecific;
    }

    // Auth state change handler
    async handleAuthStateChange(user) {
        console.log('🔐 Auth state changed. User:', user ? 'signed in' : 'signed out');
        console.log('👤 User details:', user ? { uid: user.uid, email: user.email, displayName: user.displayName } : 'null');
        
        if (user) {
            // User is signed in - now load Strava credentials
            try {
                await userManager.init(); // This will load Firebase credentials now that user is authenticated
                console.log('Firebase credentials loaded after authentication');
            } catch (error) {
                console.error('Error loading Firebase credentials:', error);
            }
            
            this.currentUserProfile = await userManager.getCurrentUserProfile();
            this.updateUserDisplay();
            
            // Debug: Log the user profile state
            console.log('🔍 DETAILED User profile state:', {
                stravaConnected: this.currentUserProfile?.stravaConnected,
                stravaPromptShown: this.currentUserProfile?.stravaPromptShown,
                hasStravaData: !!this.currentUserProfile?.stravaData,
                fullProfile: this.currentUserProfile
            });
            
            // Check if there's a pending OAuth code to process
            const pendingOAuthCode = sessionStorage.getItem('pending_oauth_code');
            if (pendingOAuthCode) {
                console.log('🔄 Processing pending OAuth code after authentication:', pendingOAuthCode);
                sessionStorage.removeItem('pending_oauth_code');
                await this.handleOAuthCallback(pendingOAuthCode);
                return;
            }
            
            // EXPLICIT LOGIC: Show Strava connection screen if user is NOT connected to Strava
            // We ignore stravaPromptShown if they're not connected - they need to connect!
            const shouldShowStravaScreen = !this.currentUserProfile?.stravaConnected;
            
            console.log('🎯 STRAVA CONNECTION DECISION:', {
                shouldShowStravaScreen: shouldShowStravaScreen,
                reason: shouldShowStravaScreen ? 'User not connected to Strava' : 'User already connected to Strava',
                stravaConnected: this.currentUserProfile?.stravaConnected,
                stravaPromptShown: this.currentUserProfile?.stravaPromptShown
            });
            
            if (shouldShowStravaScreen) {
                console.log('📱 Showing Strava connection screen - user needs to connect');
                // Small delay to ensure proper UI state
                setTimeout(() => {
                    this.showStravaConnectionScreen();
                }, 100);
            } else {
                console.log('🚀 Skipping Strava prompt - user already connected');
                // Load user's Strava connection and show main app
                await this.loadStravaConnection();
                await this.showMainApp();
            }
        } else {
            // User is signed out
            this.currentUserProfile = null;
            this.showAuthScreen();
        }
    }

    // Form handlers
    async handleSignin(e) {
        e.preventDefault();
        const email = document.getElementById('signin-email').value;
        const password = document.getElementById('signin-password').value;
        
        const button = document.getElementById('signin-button');
        button.disabled = true;
        button.innerHTML = '<span class="loader"></span>Signing in...';

        const result = await userManager.signIn(email, password);
        
        if (result.success) {
            // Success - auth state change will handle the rest
        } else {
            alert(`Sign in failed: ${result.error}`);
            button.disabled = false;
            button.innerHTML = `<svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM8 12a2 2 0 114 0 2 2 0 01-4 0z"/>
            </svg>Sign In`;
        }
    }

    async handleSignup(e) {
        e.preventDefault();
        const name = document.getElementById('signup-name').value;
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const confirmPassword = document.getElementById('signup-password-confirm').value;

        if (password !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }

        const button = document.getElementById('signup-button');
        button.disabled = true;
        button.innerHTML = '<span class="loader"></span>Creating account...';

        const result = await userManager.signUp(email, password, name);
        
        if (result.success) {
            // Success - auth state change will handle the rest
        } else {
            alert(`Sign up failed: ${result.error}`);
            button.disabled = false;
            button.innerHTML = `<svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6z"/>
            </svg>Create Account`;
        }
    }

    async handleSignout(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        console.log('🚪 Signing out user...');
        
        try {
            const result = await userManager.signOut();
            if (result.success) {
                console.log('✅ User signed out successfully');
                // Clear any cached data - CRITICAL for security
                localStorage.clear();
                sessionStorage.clear();
                // Force reload to reset app state
                window.location.reload();
            } else {
                console.error('❌ Sign out failed:', result.error);
                alert(`Sign out failed: ${result.error}`);
            }
        } catch (error) {
            console.error('❌ Sign out error:', error);
            alert(`Sign out error: ${error.message}`);
        }
    }

    // Strava connection handlers
    async loadStravaConnection() {
        console.log('🔗 loadStravaConnection called');
        console.log('🔍 Current user profile:', this.currentUserProfile);
        console.log('🔍 Strava connected:', this.currentUserProfile?.stravaConnected);
        
        try {
            if (!this.currentUserProfile?.stravaConnected) {
                if (this.authElements.stravaConnectionText) {
                    this.authElements.stravaConnectionText.textContent = 'Connect Strava';
                }
                console.log('✅ User not connected to Strava, updated UI');
                return;
            }

            const stravaData = this.currentUserProfile.stravaData;
            console.log('🔍 Strava data exists:', !!stravaData);
            
            if (stravaData) {
                // Update the existing localStorage with user's Strava data (don't JSON.stringify the tokens)
                localStorage.setItem('stravaAccessToken', stravaData.accessToken);
                localStorage.setItem('stravaRefreshToken', stravaData.refreshToken);
                localStorage.setItem('stravaExpiresAt', stravaData.expiresAt.toString());
                localStorage.setItem('stravaAthlete', JSON.stringify(stravaData.athlete));
                
                if (this.authElements.stravaConnectionText) {
                    this.authElements.stravaConnectionText.textContent = 'Disconnect Strava';
                }
                console.log('✅ Strava connection loaded successfully');
            }
        } catch (error) {
            console.error('❌ Error in loadStravaConnection:', error);
            throw error;
        }
    }

    async showStravaModal() {
        console.log('🚀 Connect Strava button clicked!');
        
        // Wait a moment for Firebase config to load if needed
        if (!window.STRAVA_CLIENT_ID && !window.STRAVA_CLIENT_SECRET) {
            console.log('Waiting for Firebase config to load...');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Check if we have global app credentials first
        const globalClientId = window.STRAVA_CLIENT_ID || '';
        const globalClientSecret = window.STRAVA_CLIENT_SECRET || '';
        
        console.log('🔑 Strava credentials check:', {
            hasClientId: !!globalClientId,
            hasClientSecret: !!globalClientSecret,
            clientIdLength: globalClientId ? globalClientId.length : 0
        });
        
        if (globalClientId && globalClientSecret) {
            console.log('✅ Using global credentials for Strava connection');
            // Use global credentials directly without showing modal
            this.handleStravaConnectWithCredentials(globalClientId, globalClientSecret);
            return;
        }
        
        // Show helpful message if no credentials are set up
        if (!globalClientId && !globalClientSecret) {
            alert('Strava API credentials not found. Please:\n\n1. Open setup-strava-credentials.html in a new tab\n2. Add your Strava API credentials\n3. Return here and try again\n\nNote: You need to get your Client ID and Client Secret from https://www.strava.com/settings/api');
            return;
        }
        
        // Fall back to user-specific credentials if no global ones
        const clientId = userManager.getUserData('stravaClientId', '');
        const clientSecret = userManager.getUserData('stravaClientSecret', '');
        
        this.authElements.modalClientId.value = clientId;
        this.authElements.modalClientSecret.value = clientSecret;
        
        this.authElements.stravaConnectionModal.classList.remove('hidden');
    }

    hideStravaModal() {
        this.authElements.stravaConnectionModal.classList.add('hidden');
    }

    async handleStravaConnect() {
        const clientId = this.authElements.modalClientId.value.trim();
        const clientSecret = this.authElements.modalClientSecret.value.trim();

        if (!clientId || !clientSecret) {
            alert('Please enter both Client ID and Client Secret.');
            return;
        }

        // Hide modal first
        this.hideStravaModal();
        
        this.handleStravaConnectWithCredentials(clientId, clientSecret);
    }

    async handleStravaDisconnect() {
        console.log('🔌 Disconnecting from Strava...');
        console.log('🔍 Current user:', userManager.getCurrentUser());
        console.log('🔍 User authenticated:', userManager.isAuthenticated());
        console.log('🔍 Current profile before disconnect:', this.currentUserProfile);
        
        try {
            // Disconnect from Strava in the user profile
            const result = await userManager.disconnectStrava();
            console.log('🔍 Disconnect result:', result);
            
            if (result.success) {
                // Update local profile
                this.currentUserProfile.stravaConnected = false;
                this.currentUserProfile.stravaData = null;
                // Reset the prompt flag so user sees connection screen again
                this.currentUserProfile.stravaPromptShown = false;
                
                // Clear local storage tokens
                localStorage.removeItem('stravaAccessToken');
                localStorage.removeItem('stravaRefreshToken');
                localStorage.removeItem('stravaExpiresAt');
                localStorage.removeItem('stravaAthlete');
                
                // Force refresh profile from Firebase to confirm update
                this.currentUserProfile = await userManager.getCurrentUserProfile();
                console.log('🔍 Profile after disconnect:', this.currentUserProfile);
                
                // Update UI
                this.updateUserDisplay();
                
                // Ensure settings page reflects new state immediately
                if (window.Navigation && typeof window.Navigation.updateSettingsPage === 'function') {
                    window.Navigation.updateSettingsPage();
                }
                
                console.log('✅ Successfully disconnected from Strava');
                alert('Successfully disconnected from Strava.');
            } else {
                console.error('❌ Failed to disconnect from Strava:', result.error);
                alert(`Failed to disconnect from Strava: ${result.error}`);
            }
        } catch (error) {
            console.error('❌ Error disconnecting from Strava:', error);
            console.error('❌ Error stack:', error.stack);
            alert(`Error disconnecting from Strava: ${error.message}`);
        }
    }

    handleStravaConnectWithCredentials(clientId, clientSecret) {
        console.log('🚀 handleStravaConnectWithCredentials called');
        console.log('🔍 DETAILED OAUTH DEBUG:', {
            clientId: clientId,
            clientIdType: typeof clientId,
            clientIdLength: clientId?.length,
            clientSecret: clientSecret ? 'present' : 'missing',
            clientSecretType: typeof clientSecret,
            clientSecretLength: clientSecret?.length,
            windowOrigin: window.location.origin,
            windowPathname: window.location.pathname,
            fullUrl: window.location.href
        });
        
        // Validate credentials
        if (!clientId || !clientSecret) {
            console.error('❌ Missing Strava credentials:', { 
                clientId: !!clientId, 
                clientSecret: !!clientSecret,
                clientIdValue: clientId,
                clientSecretValue: clientSecret ? '[HIDDEN]' : null
            });
            alert('Strava credentials are missing. Please check your Firebase setup.');
            return;
        }

        // Validate Client ID format (should be all numbers)
        if (!/^\d+$/.test(clientId)) {
            console.error('❌ Invalid Client ID format:', clientId);
            alert(`Invalid Client ID format: "${clientId}". Client ID should be all numbers (e.g., "165413"). Please check your Strava app settings and update your Firebase credentials.`);
            return;
        }

        // Save credentials (only if not using global ones)
        if (!window.STRAVA_CLIENT_ID) {
            userManager.setUserData('stravaClientId', clientId);
            userManager.setUserData('stravaClientSecret', clientSecret);
            
            // Also save to localStorage as fallback for OAuth callbacks
            localStorage.setItem('strava_client_id', clientId);
            localStorage.setItem('strava_client_secret', clientSecret);
        }

        // Start OAuth flow
        const redirectUri = window.location.origin + window.location.pathname;
        console.log('🌐 Starting OAuth flow with redirect URI:', redirectUri);
        
        // Official Strava OAuth URL as required by brand guidelines
        const oauthUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read,activity:read_all,activity:write,profile:read_all`;
        console.log('🔗 Full OAuth URL:', oauthUrl);
        
        // Debug: Check individual components
        console.log('🔍 OAuth components:', {
            clientId: clientId,
            redirectUri: redirectUri,
            encodedRedirectUri: encodeURIComponent(redirectUri),
            scope: 'read,activity:read_all,activity:write,profile:read_all'
        });
        
        // Validate URL before redirecting
        try {
            new URL(oauthUrl);
            console.log('✅ OAuth URL is valid, redirecting...');
            window.location.href = oauthUrl;
        } catch (error) {
            console.error('❌ Invalid OAuth URL:', error);
            alert('Invalid OAuth URL generated. Please check your setup.');
        }
    }

    // UI Management
    switchToSignin() {
        // Only manipulate tab elements if they exist
        if (this.authElements.signinTab) {
            this.authElements.signinTab.classList.add('border-green-500', 'text-green-600');
        }
        if (this.authElements.signupTab) {
            this.authElements.signupTab.classList.remove('border-blue-500', 'text-blue-600');
        }
        
        // Always switch the forms
        if (this.authElements.signinForm) {
            this.authElements.signinForm.classList.remove('hidden');
        }
        if (this.authElements.signupForm) {
            this.authElements.signupForm.classList.add('hidden');
        }
    }

    switchToSignup() {
        // Only manipulate tab elements if they exist
        if (this.authElements.signupTab) {
            this.authElements.signupTab.classList.add('border-blue-500', 'text-blue-600');
        }
        if (this.authElements.signinTab) {
            this.authElements.signinTab.classList.remove('border-green-500', 'text-green-600');
        }
        
        // Always switch the forms
        if (this.authElements.signupForm) {
            this.authElements.signupForm.classList.remove('hidden');
        }
        if (this.authElements.signinForm) {
            this.authElements.signinForm.classList.add('hidden');
        }
    }

    updateUserDisplay() {
        if (!this.currentUserProfile) return;

        const displayName = this.currentUserProfile.displayName || 'User';
        const email = this.currentUserProfile.email || '';
        const initial = displayName.charAt(0).toUpperCase();

        // Update settings page user info
        if (this.authElements.settingsUserName) {
            this.authElements.settingsUserName.textContent = displayName;
        }
        if (this.authElements.settingsUserEmail) {
            this.authElements.settingsUserEmail.textContent = email;
        }
        if (this.authElements.settingsAvatarInitial) {
            this.authElements.settingsAvatarInitial.textContent = initial;
        }

        // Profile photo display
        const avatarPhoto = document.getElementById('settings-avatar-photo');
        const avatarPlaceholder = document.getElementById('settings-avatar-placeholder');
        if (this.currentUserProfile && this.currentUserProfile.profilePhotoUrl) {
            if (avatarPhoto) {
                avatarPhoto.src = this.currentUserProfile.profilePhotoUrl;
                avatarPhoto.classList.remove('hidden');
            }
            if (avatarPlaceholder) avatarPlaceholder.classList.add('hidden');
        } else {
            if (avatarPhoto) avatarPhoto.classList.add('hidden');
            if (avatarPlaceholder) avatarPlaceholder.classList.remove('hidden');
        }

        // Update navigation profile photos (desktop sidebar and mobile nav)
        const navDesk = document.getElementById('nav-profile-photo-desktop');
        const navMob = document.getElementById('nav-profile-photo-mobile');
        if (navDesk || navMob) {
            const photoUrl = this.currentUserProfile?.profilePhotoUrl || 'swcp-logo.png';
            if (navDesk) navDesk.src = photoUrl;
            if (navMob) navMob.src = photoUrl;
        }

        // Update Strava connection button appearance
        if (this.authElements.stravaConnectionBtn) {
            const stravaImg = document.getElementById('strava-connection-img');
            if (stravaImg) {
                // For now, we'll keep using the same button image
                // In a real implementation, you might have separate "Connect" and "Disconnect" button images
                stravaImg.alt = this.currentUserProfile.stravaConnected ? 'Disconnect from Strava' : 'Connect with Strava';
                stravaImg.title = this.currentUserProfile.stravaConnected ? 'Disconnect from Strava' : 'Connect with Strava';
            }
        }

        // Apply dark mode preference from profile
        if (this.currentUserProfile && this.currentUserProfile.preferences && typeof this.currentUserProfile.preferences.darkMode === 'boolean') {
            const preferDark = this.currentUserProfile.preferences.darkMode;
            document.body.classList.toggle('dark-mode', preferDark);
            localStorage.setItem('darkMode', preferDark.toString());
            if (typeof updateDarkModeToggle === 'function') {
                updateDarkModeToggle();
            }
        }
    }

    showAuthScreen() {
        console.log('📺 Showing auth screen (login/signup)');
        document.getElementById('main-layout-container')?.classList.add('hidden');
        document.getElementById('initial-loading-screen')?.classList.add('hidden');
        document.getElementById('strava-connection-screen')?.classList.add('hidden');
        this.authElements.authScreenWrapper?.classList.remove('hidden');
    }

    showStravaConnectionScreen() {
        console.log('🎯 showStravaConnectionScreen called');
        
        document.getElementById('main-layout-container')?.classList.add('hidden');
        document.getElementById('initial-loading-screen')?.classList.add('hidden');
        this.authElements.authScreenWrapper?.classList.add('hidden');
        
        const stravaScreen = document.getElementById('strava-connection-screen');
        console.log('🔍 Existing Strava screen element:', stravaScreen);
        
        if (stravaScreen) {
            console.log('📱 Showing existing Strava connection screen');
            stravaScreen.classList.remove('hidden');
        } else {
            console.log('🏗️ Creating new Strava connection screen');
            // Create the Strava connection screen if it doesn't exist
            this.createStravaConnectionScreen();
        }
    }

    createStravaConnectionScreen() {
        console.log('🏗️ Creating Strava connection screen HTML');
        
        const screenHTML = `
            <div id="strava-connection-screen" class="fixed inset-0 flex items-center justify-center" style="z-index: 999999 !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; display: flex !important; visibility: visible !important; background: url('swcp-background.webp') center/cover, linear-gradient(135deg, #2c5530 0%, #1a3d1f 100%);">
                <div class="blurred-tile-background rounded-2xl shadow-2xl max-w-lg w-full mx-4 p-8 border border-white/20">
                    <div class="text-center mb-8">
                        <div class="w-32 h-32 flex items-center justify-center mx-auto mb-6">
                            <img src="swcp-logo.png" alt="SWCP Logo" class="w-28 h-28 object-contain" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));" />
                        </div>
                        <h2 class="text-3xl font-bold text-white mb-3">Connect to Strava</h2>
                        <p class="text-white text-lg leading-relaxed">
                            To track your South West Coast Path progress, we need to connect to your Strava account to access your activities.
                        </p>
                    </div>

                    <div class="space-y-4 mb-8">
                        <div class="flex items-start space-x-3">
                            <div class="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                <svg class="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                                </svg>
                            </div>
                            <p class="text-white">Automatically analyze your hiking activities</p>
                        </div>
                        <div class="flex items-start space-x-3">
                            <div class="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                <svg class="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                                </svg>
                            </div>
                            <p class="text-white">Track your progress along the 630-mile coastal path</p>
                        </div>
                        <div class="flex items-start space-x-3">
                            <div class="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                <svg class="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                                </svg>
                            </div>
                            <p class="text-white">Add progress updates to your Strava activity descriptions</p>
                        </div>
                    </div>

                    <div class="space-y-4">
                        <!-- Official Connect with Strava Button using provided SVG -->
                        <button id="connect-strava-main-btn" class="w-full p-0 border-none bg-transparent">
                            <img src="btn_strava_connect_with_orange_x2.svg" alt="Connect with Strava" class="w-full h-auto strava-logo" style="max-height: 60px;" />
                        </button>
                        
                        <button id="skip-strava-btn" class="w-full text-white hover:text-gray-300 py-2 text-sm transition-colors duration-200">
                            Skip for now (limited functionality)
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        console.log('📝 Inserting HTML into document body');
        document.body.insertAdjacentHTML('beforeend', screenHTML);
        
        // Verify the element was created
        const createdScreen = document.getElementById('strava-connection-screen');
        console.log('✅ Strava screen created successfully:', !!createdScreen);
        
        // Add event listeners with a small delay to ensure DOM is ready
        // Store reference to 'this' for use in setTimeout
        const authController = this;
        
        setTimeout(() => {
            console.log('🔍 Looking for button elements...');
            const connectBtn = document.getElementById('connect-strava-main-btn');
            const skipBtn = document.getElementById('skip-strava-btn');
            
            console.log('🔗 Button elements search results:', {
                connectBtn: !!connectBtn,
                skipBtn: !!skipBtn,
                connectBtnElement: connectBtn,
                skipBtnElement: skipBtn
            });
            
            // Debug: List all elements with these IDs
            console.log('🔍 All elements with connect-strava-main-btn ID:', document.querySelectorAll('#connect-strava-main-btn'));
            console.log('🔍 All elements with skip-strava-btn ID:', document.querySelectorAll('#skip-strava-btn'));
            
            if (connectBtn) {
                console.log('✅ Adding event listener to connect button');
                connectBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('🎯 Connect Strava button clicked');
                    try {
                        await authController.showStravaModal();
                    } catch (error) {
                        console.error('Error in connect button:', error);
                        alert('Error connecting to Strava. Please try again.');
                    }
                });
            } else {
                console.error('❌ Connect button not found!');
            }
            
            if (skipBtn) {
                console.log('✅ Adding event listener to skip button');
                skipBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('⏭️ Skip Strava button clicked - THIS SHOULD SHOW IN CONSOLE');
                    try {
                        // Mark that user has seen the Strava prompt
                        if (authController.currentUserProfile) {
                            await userManager.updateUserProfile(authController.currentUserProfile.uid, {
                                stravaPromptShown: true
                            });
                            authController.currentUserProfile.stravaPromptShown = true;
                        }
                        console.log('🚀 About to call showMainApp...');
                        await authController.showMainApp();
                        console.log('✅ showMainApp completed');
                    } catch (error) {
                        console.error('Error in skip button:', error);
                        alert('Error skipping Strava connection. Please try again.');
                    }
                });
                
                // Also add a simple click test
                skipBtn.addEventListener('click', () => {
                    console.log('🧪 SIMPLE CLICK TEST - Skip button was definitely clicked!');
                });
                
            } else {
                console.error('❌ Skip button not found!');
                // Try to find it with a different method
                const allButtons = document.querySelectorAll('button');
                console.log('🔍 All buttons on page:', allButtons);
                allButtons.forEach((btn, index) => {
                    console.log(`Button ${index}:`, {
                        id: btn.id,
                        textContent: btn.textContent,
                        classList: btn.classList.toString()
                    });
                });
            }
            
            // Debug: Check what's currently visible
            const mainLayout = document.getElementById('main-layout-container');
            const authScreen = document.getElementById('auth-screen-wrapper');
            const loadingScreen = document.getElementById('initial-loading-screen');
            const stravaScreenCheck = document.getElementById('strava-connection-screen');
            
            console.log('🔍 UI Elements visibility check:', {
                mainLayout: mainLayout ? !mainLayout.classList.contains('hidden') : 'not found',
                authScreen: authScreen ? !authScreen.classList.contains('hidden') : 'not found',
                loadingScreen: loadingScreen ? !loadingScreen.classList.contains('hidden') : 'not found',
                stravaScreen: stravaScreenCheck ? !stravaScreenCheck.classList.contains('hidden') : 'not found'
            });
            
            // Check z-index and positioning
            if (stravaScreenCheck) {
                const styles = window.getComputedStyle(stravaScreenCheck);
                console.log('🎨 Strava screen computed styles:', {
                    display: styles.display,
                    visibility: styles.visibility,
                    zIndex: styles.zIndex,
                    position: styles.position,
                    top: styles.top,
                    left: styles.left
                });
            }
        }, 100);
    }

    async showMainApp() {
        console.log('🚀 showMainApp called');
        
        // Debug: Check what screens are currently visible
        console.log('🔍 UI state before changes:', {
            authScreen: !this.authElements.authScreenWrapper?.classList.contains('hidden'),
            loadingScreen: !document.getElementById('initial-loading-screen')?.classList.contains('hidden'),
            stravaScreen: !document.getElementById('strava-connection-screen')?.classList.contains('hidden'),
            mainContainer: !document.getElementById('main-layout-container')?.classList.contains('hidden')
        });
        
        this.authElements.authScreenWrapper?.classList.add('hidden');
        document.getElementById('initial-loading-screen')?.classList.add('hidden');
        
        // Force hide Strava connection screen (it has !important inline styles)
        const stravaScreen = document.getElementById('strava-connection-screen');
        if (stravaScreen) {
            console.log('🔍 Strava screen before hiding:', {
                display: stravaScreen.style.display,
                visibility: stravaScreen.style.visibility,
                classList: stravaScreen.classList.toString(),
                computedDisplay: window.getComputedStyle(stravaScreen).display,
                computedVisibility: window.getComputedStyle(stravaScreen).visibility
            });
            
            stravaScreen.style.setProperty('display', 'none', 'important');
            stravaScreen.style.setProperty('visibility', 'hidden', 'important');
            stravaScreen.classList.add('hidden');
            
            console.log('🔍 Strava screen after hiding:', {
                display: stravaScreen.style.display,
                visibility: stravaScreen.style.visibility,
                classList: stravaScreen.classList.toString(),
                computedDisplay: window.getComputedStyle(stravaScreen).display,
                computedVisibility: window.getComputedStyle(stravaScreen).visibility
            });
        } else {
            console.log('📱 Strava screen element not found (may not have been created yet) - this is normal');
        }
        
        const mainContainer = document.getElementById('main-layout-container');
        mainContainer?.classList.remove('hidden');
        
        // Debug: Check what screens are visible after changes
        console.log('🔍 UI state after changes:', {
            authScreen: !this.authElements.authScreenWrapper?.classList.contains('hidden'),
            loadingScreen: !document.getElementById('initial-loading-screen')?.classList.contains('hidden'),
            stravaScreen: !document.getElementById('strava-connection-screen')?.classList.contains('hidden'),
            mainContainer: !mainContainer?.classList.contains('hidden')
        });
        
        // Debug: Check main container visibility details
        if (mainContainer) {
            const computedStyle = window.getComputedStyle(mainContainer);
            console.log('🔍 Main container debug:', {
                exists: !!mainContainer,
                hasHiddenClass: mainContainer.classList.contains('hidden'),
                display: computedStyle.display,
                visibility: computedStyle.visibility,
                opacity: computedStyle.opacity,
                zIndex: computedStyle.zIndex,
                position: computedStyle.position
            });
        } else {
            console.error('❌ Main container not found!');
        }
        
        // Debug: Check for multiple Strava screens or other blocking elements
        const allStravaScreens = document.querySelectorAll('[id*="strava"]');
        console.log('🔍 All Strava-related elements:', allStravaScreens);
        allStravaScreens.forEach((el, index) => {
            const styles = window.getComputedStyle(el);
            console.log(`Strava element ${index}:`, {
                id: el.id,
                tagName: el.tagName,
                classList: el.classList.toString(),
                display: styles.display,
                visibility: styles.visibility,
                zIndex: styles.zIndex,
                position: styles.position
            });
        });
        
        // Debug: Check all fixed position elements that might be blocking
        const fixedElements = document.querySelectorAll('*');
        const blockingElements = [];
        fixedElements.forEach(el => {
            const styles = window.getComputedStyle(el);
            if (styles.position === 'fixed' && styles.display !== 'none' && styles.visibility !== 'hidden') {
                blockingElements.push({
                    element: el,
                    id: el.id,
                    tagName: el.tagName,
                    classList: el.classList.toString(),
                    zIndex: styles.zIndex,
                    display: styles.display,
                    visibility: styles.visibility
                });
            }
        });
        console.log('🔍 All visible fixed position elements:', blockingElements);
        
        // Wait for Firebase config to load Strava credentials
        try {
            const { userManager } = await import('./auth.js');
            await userManager.init(); // Ensure Firebase config is loaded
            console.log('Firebase config loaded before showing main app');
        } catch (error) {
            console.error('Error loading Firebase config:', error);
        }
        
        // Initialize the main app
        console.log('🔄 About to import and call script.js showMainApp...');
        try {
            const { showMainApp } = await import('./script.js');
            console.log('✅ Successfully imported showMainApp:', typeof showMainApp);
            if (typeof showMainApp === 'function') {
                console.log('🎯 Calling script.js showMainApp...');
                await showMainApp();
                console.log('✅ script.js showMainApp completed');
            } else {
                console.error('❌ showMainApp is not a function:', showMainApp);
            }
        } catch (error) {
            console.error('❌ Error importing or calling script.js showMainApp:', error);
        }
        
        console.log('✅ AuthController showMainApp completed');
    }

    // Handle OAuth callback
    async handleOAuthCallback(code) {
        console.log('Handling OAuth callback with code:', code);
        
        // User should already be authenticated when this runs
        if (!userManager.isAuthenticated()) {
            console.error('❌ User not authenticated during OAuth callback');
            alert('Authentication error. Please sign in again.');
            return;
        }
        
        console.log('✅ User authenticated, proceeding with OAuth callback');
        
        // For OAuth callback, we need to load credentials differently since user might not be authenticated yet
        console.log('🔐 Loading credentials for OAuth callback...');
        
        // First, try to load Firebase credentials manually
        try {
            const { FirebaseConfig } = await import('./firebase-config.js');
            const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
            
            // Get the database reference (should be available from auth.js initialization)
            const db = getFirestore();
            const firebaseConfig = new FirebaseConfig(db);
            
            // Try to load credentials directly (this might work even without authentication for public config)
            await firebaseConfig.getStravaCredentials();
            
            console.log('🔑 Attempted to load Firebase credentials for OAuth');
        } catch (error) {
            console.log('⚠️ Could not load Firebase credentials for OAuth:', error);
        }
        
        // Wait a bit for credentials to load
        let attempts = 0;
        while ((!window.STRAVA_CLIENT_ID || !window.STRAVA_CLIENT_SECRET) && attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
            console.log(`Waiting for credentials... attempt ${attempts}`);
        }
        
        // Try global credentials first, then user-specific, then localStorage fallback
        const clientId = window.STRAVA_CLIENT_ID || 
                        userManager.getUserData('stravaClientId') || 
                        localStorage.getItem('strava_client_id');
        const clientSecret = window.STRAVA_CLIENT_SECRET || 
                           userManager.getUserData('stravaClientSecret') || 
                           localStorage.getItem('strava_client_secret');

        console.log('OAuth credentials check:', {
            hasGlobalClientId: !!window.STRAVA_CLIENT_ID,
            hasGlobalClientSecret: !!window.STRAVA_CLIENT_SECRET,
            hasUserClientId: !!userManager.getUserData('stravaClientId'),
            hasUserClientSecret: !!userManager.getUserData('stravaClientSecret'),
            finalClientId: !!clientId,
            finalClientSecret: !!clientSecret
        });

        if (!clientId || !clientSecret) {
            console.error('Missing credentials for OAuth callback');
            alert('Missing Strava credentials. Please reconnect.');
            return;
        }

        try {
            console.log('🚀 Making token exchange request to Strava...');
            
            const response = await fetch('https://www.strava.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code: code,
                    grant_type: 'authorization_code'
                }),
            });

            console.log('📡 Response status:', response.status);
            console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ HTTP Error Response:', errorText);
                throw new Error(`Authentication failed: ${response.status} - ${errorText}`);
            }

            // Get the raw response text first
            const responseText = await response.text();
            console.log('📄 Raw response text:', responseText);
            console.log('📄 Response length:', responseText.length);
            console.log('📄 First 100 characters:', responseText.substring(0, 100));
            
            // Try to parse as JSON
            let data;
            try {
                data = JSON.parse(responseText);
                console.log('✅ Successfully parsed JSON response');
            } catch (parseError) {
                console.error('❌ JSON Parse Error:', parseError);
                console.error('❌ Failed to parse response:', responseText);
                throw new Error(`Invalid JSON response from Strava: ${parseError.message}`);
            }
            
            // Save to user profile (connectStrava already sets stravaConnected: true)
            console.log('💾 Saving Strava connection to user profile...');
            try {
                await userManager.connectStrava(data, data.athlete);
                console.log('✅ Strava connection saved to user profile');
                
                // Update local profile cache
                if (this.currentUserProfile) {
                    this.currentUserProfile.stravaConnected = true;
                    this.currentUserProfile.stravaData = {
                        accessToken: data.access_token,
                        refreshToken: data.refresh_token,
                        expiresAt: data.expires_at,
                        athlete: data.athlete,
                        connectedAt: new Date()
                    };
                }
            } catch (profileError) {
                console.error('❌ Error saving to user profile:', profileError);
                throw profileError;
            }
            
            // Update localStorage for existing app code (don't JSON.stringify the tokens)
            localStorage.setItem('stravaAccessToken', data.access_token);
            localStorage.setItem('stravaRefreshToken', data.refresh_token);
            localStorage.setItem('stravaExpiresAt', data.expires_at.toString());
            localStorage.setItem('stravaAthlete', JSON.stringify(data.athlete));
            
            console.log('Strava connection successful');
            
            // Debug: Check what tokens were received
            console.log('🔑 OAuth tokens received:', {
                hasAccessToken: !!data.access_token,
                hasRefreshToken: !!data.refresh_token,
                expiresAt: data.expires_at,
                athlete: data.athlete ? data.athlete.firstname + ' ' + data.athlete.lastname : 'No athlete data'
            });
            

            
            // Clean up URL immediately
            window.history.replaceState({}, document.title, window.location.pathname);
            
            // Clear the processed code from session storage since we're done
            sessionStorage.removeItem('processed_oauth_code');
            
            // Close modal if it exists
            const modal = document.getElementById('strava-modal');
            if (modal) {
                modal.remove();
            }
            
            // Hide Strava connection screen and show main app
            document.getElementById('strava-connection-screen')?.classList.add('hidden');
            
            // Load Strava connection and show main app
            console.log('🔄 Loading Strava connection after OAuth...');
            await this.loadStravaConnection();
            
            console.log('🔄 Showing main app after OAuth...');
            await this.showMainApp();
            
        } catch (error) {
            console.error('❌ OAuth error:', error);
            console.error('❌ Error name:', error.name);
            console.error('❌ Error message:', error.message);
            console.error('❌ Error stack:', error.stack);
            alert(`Authentication failed: ${error.message}`);
        }
    }

    // Compress image using canvas
    async compressImage(file, maxSize = 300, quality = 0.8) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
            };
            img.onerror = () => resolve(null);
            img.src = URL.createObjectURL(file);
        });
    }
}

// Create and export singleton
export const authController = new AuthController();

// Expose globally for script coordination
window.authController = authController;
window.userManager = userManager;

// Provide a simple global helper for non-module scripts
window.disconnectStrava = () => authController.handleStravaDisconnect();
window.authorizeStrava = () => authController.showStravaModal();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => authController.init());
} else {
    authController.init();
} 