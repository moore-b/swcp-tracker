// User Authentication and Management System
// Using Firebase Authentication for multi-user support

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, setPersistence, browserSessionPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCCYfIHZcGoZfHZrOoJyR0J4ddz7mQmR6k",
    authDomain: "swcp-tracker-firebase.firebaseapp.com",
    projectId: "swcp-tracker-firebase",
    storageBucket: "swcp-tracker-firebase.firebasestorage.app",
    messagingSenderId: "468051404686",
    appId: "1:468051404686:web:bd95162959025afefda6df",
    measurementId: "G-MSB12XW460"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Import Firebase config helper
import { FirebaseConfig } from './firebase-config.js';
const firebaseConfig_helper = new FirebaseConfig(db);

// User management class
class UserManager {
    constructor() {
        this.currentUser = null;
        this.userProfiles = new Map();
        this.onUserChangeCallbacks = [];
    }

    // Initialize Firebase config and load Strava credentials
    async init() {
        try {
            // Check if we should use session-only persistence (for testing)
            if (window.location.search.includes('sessionOnly') || sessionStorage.getItem('forceSessionOnly')) {
                console.log('🔒 Setting Firebase auth to session-only persistence');
                await setPersistence(auth, browserSessionPersistence);
            }
            
            await firebaseConfig_helper.init();
            console.log('UserManager initialized with Firebase config');
        } catch (error) {
            console.error('Error initializing UserManager:', error);
        }
    }

    // Authentication methods
    async signUp(email, password, displayName) {
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            // Update user profile
            await updateProfile(user, { displayName });
            
            // Create user document in Firestore
            await this.createUserProfile(user, displayName);
            
            return { success: true, user };
        } catch (error) {
            console.error('Sign up error:', error);
            return { success: false, error: error.message };
        }
    }

    async signIn(email, password) {
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            return { success: true, user: userCredential.user };
        } catch (error) {
            console.error('Sign in error:', error);
            return { success: false, error: error.message };
        }
    }

    async signOut() {
        try {
            await signOut(auth);
            this.currentUser = null;
            this.clearUserData();
            return { success: true };
        } catch (error) {
            console.error('Sign out error:', error);
            return { success: false, error: error.message };
        }
    }

    // User profile management
    async createUserProfile(user, displayName) {
        try {
            const userProfile = {
                uid: user.uid,
                email: user.email,
                displayName: displayName,
                stravaConnected: false,
                stravaPromptShown: false,
                stravaData: null,
                progressData: {
                    completedPoints: [],
                    processedActivities: [],
                    totalDistance: 0,
                    completedDistance: 0,
                    percentage: 0
                },
                preferences: {
                    darkMode: false,
                    notifications: true
                },
                createdAt: new Date(),
                lastActive: new Date()
            };

            console.log('Creating user profile:', userProfile);
            await setDoc(doc(db, 'users', user.uid), userProfile);
            
            // Cache the profile locally
            this.userProfiles.set(user.uid, userProfile);
            
            console.log('User profile created successfully');
            return userProfile;
        } catch (error) {
            console.error('Error creating user profile:', error);
            throw error;
        }
    }

    async getUserProfile(uid) {
        if (this.userProfiles.has(uid)) {
            return this.userProfiles.get(uid);
        }

        const docRef = doc(db, 'users', uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const profile = docSnap.data();
            this.userProfiles.set(uid, profile);
            return profile;
        }
        
        return null;
    }

    async updateUserProfile(uid, updates) {
        try {
            await updateDoc(doc(db, 'users', uid), {
                ...updates,
                lastActive: new Date()
            });
            
            // Update local cache
            if (this.userProfiles.has(uid)) {
                const profile = this.userProfiles.get(uid);
                this.userProfiles.set(uid, { ...profile, ...updates });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Update profile error:', error);
            return { success: false, error: error.message };
        }
    }

    // Strava integration methods
    async connectStrava(stravaTokens, athleteData) {
        if (!this.currentUser) return { success: false, error: 'No user logged in' };

        const stravaData = {
            accessToken: stravaTokens.access_token,
            refreshToken: stravaTokens.refresh_token,
            expiresAt: stravaTokens.expires_at,
            athlete: athleteData,
            connectedAt: new Date()
        };

        const result = await this.updateUserProfile(this.currentUser.uid, {
            stravaConnected: true,
            stravaData: stravaData
        });

        return result;
    }

    async disconnectStrava() {
        if (!this.currentUser) return { success: false, error: 'No user logged in' };

        const result = await this.updateUserProfile(this.currentUser.uid, {
            stravaConnected: false,
            stravaData: null,
            stravaPromptShown: false  // Reset the prompt flag so user sees connection screen again
        });

        return result;
    }

    // Progress data methods
    async saveProgressData(progressData) {
        if (!this.currentUser) return { success: false, error: 'No user logged in' };

        const result = await this.updateUserProfile(this.currentUser.uid, {
            progressData: progressData
        });

        return result;
    }

    async getProgressData() {
        if (!this.currentUser) return null;

        const profile = await this.getUserProfile(this.currentUser.uid);
        return profile?.progressData || {
            completedPoints: [],
            processedActivities: [],
            totalDistance: 0,
            completedDistance: 0,
            percentage: 0
        };
    }

    // User preferences
    async updatePreferences(preferences) {
        if (!this.currentUser) return { success: false, error: 'No user logged in' };

        const result = await this.updateUserProfile(this.currentUser.uid, {
            preferences: preferences
        });

        return result;
    }

    // User data management
    getUserSpecificKey(key) {
        if (!this.currentUser) return key;
        return `${this.currentUser.uid}_${key}`;
    }

    setUserData(key, value) {
        if (!this.currentUser) return;
        const userKey = this.getUserSpecificKey(key);
        localStorage.setItem(userKey, JSON.stringify(value));
    }

    getUserData(key, defaultValue = null) {
        if (!this.currentUser) return defaultValue;
        const userKey = this.getUserSpecificKey(key);
        const data = localStorage.getItem(userKey);
        return data ? JSON.parse(data) : defaultValue;
    }

    clearUserData() {
        if (!this.currentUser) return;
        
        // Clear user-specific localStorage
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(`${this.currentUser.uid}_`)) {
                keysToRemove.push(key);
            }
        }
        
        keysToRemove.forEach(key => localStorage.removeItem(key));
    }

    // Event listeners
    onAuthStateChange(callback) {
        this.onUserChangeCallbacks.push(callback);
        
        // Set up Firebase auth state listener
        onAuthStateChanged(auth, async (user) => {
            this.currentUser = user;
            
            if (user) {
                // Load user profile
                await this.getUserProfile(user.uid);
            }
            
            // Notify all callbacks
            this.onUserChangeCallbacks.forEach(cb => cb(user));
        });
    }

    // Utility methods
    isAuthenticated() {
        return !!this.currentUser;
    }

    getCurrentUser() {
        return this.currentUser;
    }

    async getCurrentUserProfile() {
        if (!this.currentUser) return null;
        
        // Try to get the profile, with retry logic for newly created users
        let attempts = 0;
        const maxAttempts = 5;
        
        while (attempts < maxAttempts) {
            const profile = await this.getUserProfile(this.currentUser.uid);
            if (profile) {
                return profile;
            }
            
            // If no profile found and this is a new user, wait a bit and retry
            attempts++;
            if (attempts < maxAttempts) {
                console.log(`Profile not found, retrying... (${attempts}/${maxAttempts})`);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        console.error('Could not load user profile after multiple attempts');
        return null;
    }
}

// Export singleton instance
export const userManager = new UserManager(); 