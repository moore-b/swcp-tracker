// Firebase Configuration for Secure Credential Storage
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

class FirebaseConfig {
    constructor(db) {
        this.db = db;
        this.stravaCredentials = null;
    }

    // Fetch Strava credentials from Firebase
    async getStravaCredentials() {
        if (this.stravaCredentials) {
            return this.stravaCredentials;
        }

        try {
            // For OAuth callbacks, we need to try loading credentials even without authentication
            // Check if user is authenticated, but continue anyway for OAuth flows
            const auth = getAuth();
            const user = auth.currentUser;
            
            if (!user) {
                console.log('User not authenticated, but attempting to fetch Strava credentials for OAuth callback');
                // Continue anyway - OAuth callbacks need these credentials
            }
            
            // Try to get from the 'config' collection, 'strava' document
            const configRef = doc(this.db, 'config', 'strava');
            const configSnap = await getDoc(configRef);

            if (configSnap.exists()) {
                const data = configSnap.data();
                this.stravaCredentials = {
                    clientId: data.clientId,
                    clientSecret: data.clientSecret
                };
                
                // Set global variables for compatibility
                window.STRAVA_CLIENT_ID = data.clientId;
                window.STRAVA_CLIENT_SECRET = data.clientSecret;
                
                console.log('Strava credentials loaded from Firebase');
                return this.stravaCredentials;
            } else {
                console.log('No Strava credentials found in Firebase config');
                return null;
            }
        } catch (error) {
            console.error('Error fetching Strava credentials from Firebase:', error);
            return null;
        }
    }

    // Initialize and load credentials
    async init() {
        await this.getStravaCredentials();
    }
}

// Export for use in other modules
export { FirebaseConfig }; 