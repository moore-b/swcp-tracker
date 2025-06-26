// Startup script for SWCP Tracker with Authentication
// Ensures proper initialization order

async function initializeApp() {
    try {
        // First initialize UserManager to load Firebase config
        const { userManager } = await import('./auth.js');
        await userManager.init();
        console.log('UserManager initialized');

        // Note: Strava credentials will be loaded after user authentication
        console.log('Strava credentials will be loaded after user authentication');

        // Then initialize auth controller
        const { authController } = await import('./auth-controller.js');
        console.log('Authentication system initialized');
        
    } catch (error) {
        console.error('Failed to initialize app:', error);
        // Show fallback UI or error message
        document.getElementById('initial-loading-screen')?.classList.add('hidden');
        document.getElementById('auth-screen-wrapper')?.classList.remove('hidden');
    }
}

// Start initialization
initializeApp(); 