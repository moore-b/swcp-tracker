// Firebase Progress Service for SWCP Tracker
// Works alongside localStorage to provide automatic backup and sync
// Falls back gracefully if Firebase is unavailable

import { userManager } from './auth.js';
import { doc, getDoc, setDoc, updateDoc, getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';

class FirebaseProgressService {
    constructor() {
        this.isEnabled = false;
        this.syncInProgress = false;
        this.lastSyncTime = null;
        this.syncQueue = [];
        this.currentUser = null;
        
        // Initialize Firebase (reuse existing app if available)
        try {
            let app;
            const existingApps = getApps();
            
            if (existingApps.length > 0) {
                // Reuse existing Firebase app
                app = existingApps[0];
                console.log('🔥 Reusing existing Firebase app in progress service');
            } else {
                // Initialize new Firebase app
                const firebaseConfig = {
                    apiKey: "AIzaSyCCYfIHZcGoZfHZrOoJyR0J4ddz7mQmR6k",
                    authDomain: "swcp-tracker-firebase.firebaseapp.com",
                    projectId: "swcp-tracker-firebase",
                    storageBucket: "swcp-tracker-firebase.firebasestorage.app",
                    messagingSenderId: "468051404686",
                    appId: "1:468051404686:web:bd95162959025afefda6df",
                    measurementId: "G-MSB12XW460"
                };
                app = initializeApp(firebaseConfig);
                console.log('🔥 Firebase initialized in progress service');
            }
            
            this.db = getFirestore(app);
        } catch (error) {
            console.error('❌ Firebase initialization failed:', error);
            this.db = null;
        }
        
        // Track what data we're managing
        this.managedKeys = [
            'swcp_completed_points',
            'swcp_processed_activities',
            'swcp_speed_optimizations',
            'swcp_cached_results'  // New: Store calculated progress results
        ];
        
        // Also manage activity statistics keys (pattern-based)
        this.activityStatsKeyPattern = /^swcp_activity_stats_\d+$/;
    }

    /**
     * Initialize the service and check if user is authenticated
     */
    async init() {
        try {
            this.isEnabled = userManager.isAuthenticated();
            if (this.isEnabled) {
                console.log('🔥 Firebase Progress Service: Enabled for authenticated user');
                await this.loadProgressFromFirebase();
            } else {
                console.log('📱 Firebase Progress Service: Disabled (using localStorage only)');
            }
            return true;
        } catch (error) {
            console.error('❌ Firebase Progress Service init failed:', error);
            this.isEnabled = false;
            return false;
        }
    }

    /**
     * Get current progress data with Firebase-localStorage hybrid approach
     */
    async getProgressData() {
        try {
            if (!this.isEnabled) {
                // Fall back to localStorage only
                return this.getLocalStorageUnified();
            }

            // Try Firebase first, fall back to localStorage
            const firebaseData = await userManager.getProgressData();

            // Handle unified data structure
            if (firebaseData && firebaseData.unifiedProgressData) {
                console.log('📥 Loading unified progress from Firebase');
                
                const unifiedData = firebaseData.unifiedProgressData;
                
                // Convert Firebase string coordinates back to arrays
                if (unifiedData.completedPoints && Array.isArray(unifiedData.completedPoints)) {
                    // Check if points are strings (from Firebase) or already arrays (from localStorage)
                    const firstPoint = unifiedData.completedPoints[0];
                    if (typeof firstPoint === 'string' && firstPoint.includes(',')) {
                        console.log('🔄 Converting Firebase string coordinates back to arrays');
                        unifiedData.completedPoints = unifiedData.completedPoints.map(pointStr => {
                            const [lng, lat] = pointStr.split(',');
                            return [parseFloat(lng), parseFloat(lat)];
                        });
                        console.log('✅ Converted coordinates:', {
                            count: unifiedData.completedPoints.length,
                            sample: unifiedData.completedPoints.slice(0, 3)
                        });
                    }
                }
                
                return { unifiedProgressData: unifiedData };
            }
            
            // Handle legacy data structure (for backwards compatibility)
            if (firebaseData && Object.keys(firebaseData).length > 0) {
                console.log('📥 Loading legacy progress from Firebase');
                
                // Convert legacy Firebase data back to expected format
                const convertedData = { ...firebaseData };
                
                // Restore completedPoints from the flattened format
                if (firebaseData.completedPointsData && Array.isArray(firebaseData.completedPointsData)) {
                    convertedData.completedPoints = firebaseData.completedPointsData.map(pointStr => {
                        if (typeof pointStr === 'string' && pointStr.includes(',')) {
                            const [lat, lng] = pointStr.split(',');
                            return [parseFloat(lat), parseFloat(lng)];
                        }
                        return pointStr;
                    });
                    // Clean up the flattened data
                    delete convertedData.completedPointsData;
                    delete convertedData.completedPointsCount;
                }
                
                return convertedData;
            }
            
            // Fall back to localStorage
            console.log('📱 Loading progress from localStorage (Firebase empty)');
            return this.getLocalStorageUnified();
            
        } catch (error) {
            console.error('❌ Error loading progress from Firebase, using localStorage:', error);
            return this.getLocalStorageUnified();
        }
    }
    
    /**
     * Get unified progress data from localStorage
     */
    getLocalStorageUnified() {
        try {
            const unifiedData = localStorage.getItem('swcp_unified_progress');
            if (unifiedData) {
                return { unifiedProgressData: JSON.parse(unifiedData) };
            }
            return null;
        } catch (error) {
            console.error('❌ Error loading unified data from localStorage:', error);
            return null;
        }
    }

    /**
     * Save progress data to both localStorage and Firebase
     */
    async saveProgressData(progressData) {
        try {
            // Always save to localStorage first (immediate, reliable)
            this.saveLocalStorageProgress(progressData);
            console.log('💾 Progress saved to localStorage');

            // Then backup to Firebase if available
            if (this.isEnabled) {
                await this.saveToFirebase(progressData);
                console.log('🔥 Progress backed up to Firebase');
            }

            return { success: true };
        } catch (error) {
            console.error('❌ Error saving progress to Firebase (localStorage saved):', error);
            return { success: true, warning: 'Firebase backup failed but localStorage saved' };
        }
    }

    /**
     * Save specific item to both localStorage and Firebase
     */
    async saveItem(key, value) {
        try {
            // Save to localStorage immediately
            localStorage.setItem(key, JSON.stringify(value));
            console.log(`💾 ${key} saved to localStorage`);

            // Backup to Firebase if enabled (check both managed keys and activity stats pattern)
            const shouldBackupToFirebase = this.isEnabled && 
                (this.managedKeys.includes(key) || this.activityStatsKeyPattern.test(key));
                
            if (shouldBackupToFirebase) {
                await this.backupToFirebase(key, value);
                console.log(`🔥 ${key} backed up to Firebase`);
            }

            return { success: true };
        } catch (error) {
            console.error(`❌ Error saving ${key} to Firebase:`, error);
            return { success: true, warning: 'Firebase backup failed' };
        }
    }

    /**
     * Load initial progress from Firebase when user logs in
     */
    async loadProgressFromFirebase() {
        try {
            if (!this.isEnabled) return;

            const firebaseData = await userManager.getProgressData();
            console.log('🔍 Firebase progress data:', firebaseData);

            // Check for data in either format (old completedPoints or new completedPointsData)
            const hasData = (firebaseData && firebaseData.completedPoints && firebaseData.completedPoints.length > 0) ||
                           (firebaseData && firebaseData.completedPointsData && firebaseData.completedPointsData.length > 0);

            if (hasData) {
                // Sync Firebase data to localStorage
                this.syncFirebaseToLocalStorage(firebaseData);
                console.log('📥 Synced Firebase progress to localStorage');
                return firebaseData;
            } else {
                console.log('📱 No Firebase progress data, keeping localStorage');
                return null;
            }
        } catch (error) {
            console.error('❌ Error loading from Firebase:', error);
            return null;
        }
    }

    /**
     * Get progress data from localStorage (existing format)
     */
    getLocalStorageProgress() {
        try {
            const completedPoints = JSON.parse(localStorage.getItem('swcp_completed_points') || '[]');
            const processedActivities = JSON.parse(localStorage.getItem('swcp_processed_activities') || '[]');
            
            // Calculate stats from completed points (if any)
            let totalDistance = 0;
            let percentage = 0;
            
            if (completedPoints.length > 0) {
                // These would be calculated by the worker normally
                // For now, return basic structure
                totalDistance = completedPoints.length * 0.1; // Rough estimate
            }

            return {
                completedPoints,
                processedActivities,
                totalDistance,
                completedDistance: totalDistance,
                percentage
            };
        } catch (error) {
            console.error('❌ Error reading localStorage progress:', error);
            return {
                completedPoints: [],
                processedActivities: [],
                totalDistance: 0,
                completedDistance: 0,
                percentage: 0
            };
        }
    }

    /**
     * Save progress data to localStorage (existing format)
     */
    saveLocalStorageProgress(progressData) {
        try {
            if (progressData.completedPoints) {
                localStorage.setItem('swcp_completed_points', JSON.stringify(progressData.completedPoints));
            }
            if (progressData.processedActivities) {
                localStorage.setItem('swcp_processed_activities', JSON.stringify(progressData.processedActivities));
            }
        } catch (error) {
            console.error('❌ Error saving to localStorage:', error);
        }
    }

    /**
     * Save progress data to Firebase
     */
    async saveToFirebase(progressData, bypassProtection = false) {
        if (!this.isEnabled) return;

        try {
            // 🛡️ DATA PROTECTION: Prevent backing up corrupted data (unless bypassed for reset)
            if (!bypassProtection) {
                const existingData = await this.getProgressData();
                const existingPoints = existingData?.completedPoints || existingData?.completedPointsData || [];
                const newPoints = progressData.completedPoints || [];

                // Convert string format back to array for comparison if needed
                let existingPointsCount = 0;
                if (Array.isArray(existingPoints)) {
                    existingPointsCount = existingPoints.length;
                } else if (existingData?.completedPointsCount) {
                    existingPointsCount = existingData.completedPointsCount;
                }

                // Prevent backing up empty data when we have existing data
                if (existingPointsCount > 50 && newPoints.length === 0) {
                    console.error('🚨 FIREBASE PROTECTION: Refusing to backup empty data when', existingPointsCount, 'points exist');
                    return { success: false, error: 'Data protection: Refusing to backup empty data' };
                }

                if (existingPointsCount > 100 && newPoints.length < (existingPointsCount * 0.1)) {
                    console.error('🚨 FIREBASE PROTECTION: Refusing to backup', newPoints.length, 'points when', existingPointsCount, 'exist');
                    return { success: false, error: 'Data protection: Suspicious data reduction detected' };
                }

                console.log(`🛡️ Firebase backup protection: ${existingPointsCount} existing → ${newPoints.length} new points`);
            } else {
                console.log('⚠️ Data protection bypassed for intentional reset');
            }

            // === Preserve existing unifiedProgressData (fetch from Firestore) ===
            let existingUnified = null;
            if (!bypassProtection) {
                try {
                    const { getFirestore, doc: fsDoc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
                    const existingSnap = await getDoc(fsDoc(getFirestore(), 'users', this.currentUser.uid));
                    if (existingSnap.exists()) {
                        const pd = existingSnap.data().progressData;
                        if (pd && pd.unifiedProgressData) existingUnified = pd.unifiedProgressData;
                    }
                } catch (e) {
                    console.warn('⚠️ Could not fetch existing unifiedProgressData for merge:', e);
                }
            } else {
                console.log('🗑️  Hard reset detected – skipping unifiedProgressData merge');
            }

            // Merge logic: prefer fresh data, else keep existing (only when not resetting)
            const unifiedToSave = progressData.unifiedProgressData || existingUnified;

            if (unifiedToSave) {
                progressData.unifiedProgressData = unifiedToSave;
                progressData.totalDistance      = unifiedToSave.completedDistance;
                progressData.completedDistance  = unifiedToSave.completedDistance;
                progressData.percentage         = unifiedToSave.percentage;
            }

            // Convert nested arrays to Firestore-compatible format
            const dataToSave = {
                ...progressData,
                lastUpdated: new Date(),
                source: 'swcp-tracker'
            };
            
            // Fix nested arrays issue - convert to simple objects
            if (dataToSave.completedPoints && Array.isArray(dataToSave.completedPoints)) {
                console.log(`🔧 Converting ${dataToSave.completedPoints.length} completed points for Firebase`);
                // Convert array of coordinates to simple array of strings
                dataToSave.completedPointsCount = dataToSave.completedPoints.length;
                dataToSave.completedPointsData = dataToSave.completedPoints.map(point => {
                    if (Array.isArray(point)) {
                        return `${point[0]},${point[1]}`;
                    }
                    return point;
                });
                // Remove the problematic nested array
                delete dataToSave.completedPoints;
                console.log(`✅ Converted to ${dataToSave.completedPointsData.length} Firebase-compatible points`);
            }

            const result = await userManager.saveProgressData(dataToSave);
            if (result.success) {
                this.lastSyncTime = new Date();
                console.log('✅ Progress successfully saved to Firebase');

                // Invalidate local cache so next getProgressData fetches fresh data
                try {
                    if (userManager?.userProfiles?.delete) {
                        userManager.userProfiles.delete(this.currentUser.uid);
                    }
                } catch (cacheErr) {
                    console.warn('⚠️ Could not invalidate local profile cache:', cacheErr);
                }

                return result;
            } else {
                console.error('❌ Firebase save failed:', result.error);
            }
            return result;
        } catch (error) {
            console.error('❌ Error saving to Firebase:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Backup specific localStorage item to Firebase
     */
    async backupToFirebase(key, value) {
        if (!this.isEnabled) return;

        try {
            // Create a progress data structure with the specific item
            const currentProgress = await this.getProgressData();
            
            if (key === 'swcp_completed_points') {
                currentProgress.completedPoints = value;
            } else if (key === 'swcp_processed_activities') {
                currentProgress.processedActivities = value;
            } else if (key === 'swcp_cached_results') {
                currentProgress.cachedResults = value;
            }

            await this.saveToFirebase(currentProgress);
        } catch (error) {
            console.error(`❌ Error backing up ${key} to Firebase:`, error);
        }
    }

    /**
     * Sync Firebase data to localStorage
     */
    syncFirebaseToLocalStorage(firebaseData) {
        try {
            // Convert Firebase data back to expected format first
            let completedPoints = firebaseData.completedPoints;
            
            // Handle the flattened format from Firebase
            if (!completedPoints && firebaseData.completedPointsData) {
                completedPoints = firebaseData.completedPointsData.map(pointStr => {
                    if (typeof pointStr === 'string' && pointStr.includes(',')) {
                        const [lat, lng] = pointStr.split(',');
                        return [parseFloat(lat), parseFloat(lng)];
                    }
                    return pointStr;
                });
            }
            
            if (completedPoints) {
                localStorage.setItem('swcp_completed_points', JSON.stringify(completedPoints));
            }
            if (firebaseData.processedActivities) {
                localStorage.setItem('swcp_processed_activities', JSON.stringify(firebaseData.processedActivities));
            }
            if (firebaseData.cachedResults) {
                localStorage.setItem('swcp_cached_results', JSON.stringify(firebaseData.cachedResults));
            }
            
            // CRITICAL FIX: Sync activity statistics if present
            if (firebaseData.activityStats) {
                let statsCount = 0;
                Object.entries(firebaseData.activityStats).forEach(([key, value]) => {
                    if (this.activityStatsKeyPattern.test(key)) {
                        localStorage.setItem(key, JSON.stringify(value));
                        statsCount++;
                    }
                });
                if (statsCount > 0) {
                    console.log(`💾 Synced ${statsCount} activity statistics to localStorage`);
                }
            }
            
            console.log('✅ Synced Firebase data to localStorage');
        } catch (error) {
            console.error('❌ Error syncing to localStorage:', error);
        }
    }

    /**
     * Handle user authentication state changes
     */
    async onAuthStateChange(user) {
        if (user) {
            // User logged in - enable Firebase sync
            this.currentUser = user;
            this.isEnabled = true;
            console.log('🔥 Firebase Progress Service: Enabled for user', user.uid);
            
            // Load any existing progress from Firebase
            await this.loadProgressFromFirebase();
            
            // Backup current localStorage data to Firebase
            const localProgress = this.getLocalStorageProgress();
            if (localProgress.completedPoints.length > 0) {
                console.log('📤 Backing up existing localStorage progress to Firebase');
                await this.saveToFirebase(localProgress);
            }
        } else {
            // User logged out - disable Firebase sync
            this.currentUser = null;
            this.isEnabled = false;
            this.lastSyncTime = null;
            console.log('📱 Firebase Progress Service: Disabled (localStorage only)');
        }
    }

    /**
     * Get sync status for debugging
     */
    getStatus() {
        return {
            isEnabled: this.isEnabled,
            isAuthenticated: userManager.isAuthenticated(),
            lastSyncTime: this.lastSyncTime,
            syncInProgress: this.syncInProgress,
            managedKeys: this.managedKeys
        };
    }

    /**
     * Save calculated results for instant loading
     */
    async saveCachedResults(calculatedData) {
        try {
            const cacheData = {
                percentage: calculatedData.percentage,
                totalDistance: calculatedData.totalDistance,
                completedDistance: calculatedData.completedDistance || calculatedData.totalDistance,
                segmentCount: calculatedData.segments ? calculatedData.segments.length : 0,
                pointCount: calculatedData.newCompletedPoints ? calculatedData.newCompletedPoints.length : 0,
                lastCalculated: new Date().toISOString(),
                source: 'swcp-tracker-cache'
            };

            // Save to localStorage immediately
            localStorage.setItem('swcp_cached_results', JSON.stringify(cacheData));
            console.log('⚡ Cached results saved to localStorage');

            // Backup to Firebase if available
            if (this.isEnabled) {
                await this.saveItem('swcp_cached_results', cacheData);
                console.log('⚡ Cached results backed up to Firebase');
            }

            return { success: true };
        } catch (error) {
            console.error('❌ Error saving cached results:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Load cached results for instant display
     */
    async loadCachedResults() {
        try {
            console.log('🔍 DEBUG: loadCachedResults called');
            
            // Try localStorage first (fastest)
            let cachedData = localStorage.getItem('swcp_cached_results');
            console.log('🔍 DEBUG: localStorage cache raw:', cachedData ? cachedData.substring(0, 100) + '...' : 'NULL');
            
            if (cachedData) {
                cachedData = JSON.parse(cachedData);
                console.log('⚡ Loaded cached results from localStorage');
                console.log('🔍 DEBUG: Parsed cache data:', cachedData);
                return cachedData;
            }

            // Try Firebase if localStorage empty and user authenticated
            console.log('🔍 DEBUG: localStorage empty, checking Firebase. isEnabled:', this.isEnabled);
            if (this.isEnabled) {
                const firebaseData = await userManager.getProgressData();
                console.log('🔍 DEBUG: Firebase data:', firebaseData);
                if (firebaseData && firebaseData.cachedResults) {
                    console.log('⚡ Loaded cached results from Firebase');
                    return firebaseData.cachedResults;
                }
            }

            console.log('📱 No cached results found');
            return null;
        } catch (error) {
            console.error('❌ Error loading cached results:', error);
            return null;
        }
    }

    /**
     * SIMPLE CACHE: Show data from localStorage cache immediately (for speed)
     */
    async showFromCache() {
        try {
            console.log('⚡ Loading from cache...');
            
            const completedPoints = JSON.parse(localStorage.getItem('swcp_completed_points') || '[]');
            const cachedResults = JSON.parse(localStorage.getItem('swcp_cached_results') || 'null');
            
            console.log('🔍 CACHE DEBUG:', {
                pointsCount: completedPoints.length,
                hasCache: !!cachedResults,
                cacheData: cachedResults,
                firstFewPoints: completedPoints.slice(0, 3)
            });
            
            if (completedPoints.length === 0) {
                console.log('📱 No cached data available');
                return { success: false, reason: 'no_data' };
            }
            
            // Use cached results if available and valid
            if (cachedResults && this.validateCachedData(cachedResults)) {
                this.updateDisplayElementsOnly(cachedResults);
                console.log('✅ Displayed cached results');
                
                return {
                    success: true,
                    completedPoints: completedPoints,
                    pointCount: completedPoints.length,
                    percentage: cachedResults.percentage,
                    totalDistance: cachedResults.totalDistance,
                    source: 'cache'
                };
            }
            
            // Basic display without cached results
            const percentage = (completedPoints.length / 3000) * 100;
            const distance = completedPoints.length * 0.2;
            
            const percentageEl = document.getElementById('progress-percentage');
            const completedEl = document.getElementById('completed-distance');
            
            if (percentageEl) percentageEl.textContent = `${percentage.toFixed(2)}%`;
            if (completedEl) completedEl.textContent = `${distance.toFixed(2)} km`;
            
            console.log('✅ Displayed estimated progress from cache');
            
            return {
                success: true,
                completedPoints: completedPoints,
                pointCount: completedPoints.length,
                percentage: percentage,
                totalDistance: distance,
                source: 'cache_estimated'
            };
            
        } catch (error) {
            console.error('❌ Error loading from cache:', error);
            return { success: false, reason: 'error', error: error.message };
        }
    }
    
    /**
     * FIREBASE SOURCE OF TRUTH: Load authoritative data from Firebase
     */
    async loadFromFirebase() {
        try {
            console.log('☁️ Loading from Firebase...');
            
            if (!this.isEnabled || !this.currentUser || !this.db) {
                return { success: false, reason: 'not_authenticated' };
            }
            
            // Access the users collection where progress data is actually stored
            const docRef = doc(this.db, 'users', this.currentUser.uid);
            const docSnap = await getDoc(docRef);
            
            if (!docSnap.exists()) {
                console.log('📄 No Firebase user document found');
                return { success: false, reason: 'no_document' };
            }
            
            const userData = docSnap.data();
            const progressData = userData.progressData || {};
            
            console.log('📥 Firebase user document received:', {
                hasProgressData: !!userData.progressData,
                progressDataKeys: Object.keys(progressData),
                userDataKeys: Object.keys(userData)
            });
            
            console.log('📥 Firebase progress data details:', {
                points: progressData.completedPointsData?.length || progressData.completedPoints?.length || 0,
                activities: progressData.processedActivities?.length || 0,
                percentage: progressData.percentage,
                totalDistance: progressData.totalDistance,
                completedDistance: progressData.completedDistance,
                hasCachedResults: !!progressData.cachedResults,
                cachedResultsData: progressData.cachedResults,
                rawProgressDataKeys: Object.keys(progressData),
                fullProgressData: progressData
            });
            
            // Handle both old and new data formats
            let completedPoints = [];
            if (progressData.completedPointsData && progressData.completedPointsData.length > 0) {
                // New format: string array
                completedPoints = this.convertFirebaseToPoints(progressData.completedPointsData);
            } else if (progressData.completedPoints && progressData.completedPoints.length > 0) {
                // Old format: coordinate arrays
                completedPoints = progressData.completedPoints;
            } else if (progressData.cachedResults && progressData.cachedResults.pointCount > 0) {
                // Fallback: Firebase main data is corrupted/empty but we have cached results
                console.log('⚠️ Firebase main data corrupted/empty, but cached results exist');
                console.log('📦 Cached results data:', progressData.cachedResults);
                
                // Try to get actual points from localStorage (don't create fake coordinates!)
                try {
                    const cachedPoints = JSON.parse(localStorage.getItem('swcp_completed_points') || '[]');
                    if (cachedPoints.length > 0 && !this.areCoordinatesCorrupted(cachedPoints)) {
                        completedPoints = cachedPoints;
                        console.log('✅ Using valid localStorage coordinates instead of corrupted Firebase data');
                    } else {
                        console.log('⚠️ LocalStorage coordinates also corrupted or missing - returning empty array');
                        completedPoints = []; // Don't create fake coordinates!
                    }
                } catch (e) {
                    console.log('⚠️ Could not load localStorage points - returning empty array');
                    completedPoints = []; // Don't create fake coordinates!
                }
            }
            
            const processedActivities = progressData.processedActivities || [];
            
            // Update localStorage with Firebase data (cache sync)
            console.log('🔄 Syncing to localStorage:', {
                pointsToSave: completedPoints.length,
                activitiesToSave: processedActivities.length,
                pointsData: completedPoints.slice(0, 3)
            });
            
            localStorage.setItem('swcp_completed_points', JSON.stringify(completedPoints));
            localStorage.setItem('swcp_processed_activities', JSON.stringify(processedActivities));
            
            console.log('✅ Firebase data loaded and synced to cache');
            
            // Determine which data source to use for metrics
            let finalPercentage, finalTotalDistance, finalCompletedDistance;
            
            if (progressData.cachedResults && progressData.cachedResults.pointCount > 0 && 
                (progressData.percentage === 0 || !progressData.percentage)) {
                // Use cached results if main data is zero/empty
                console.log('📊 Using cached results for metrics');
                finalPercentage = progressData.cachedResults.percentage || 0;
                finalTotalDistance = progressData.cachedResults.totalDistance || progressData.cachedResults.completedDistance || 0;
                finalCompletedDistance = progressData.cachedResults.completedDistance || progressData.cachedResults.totalDistance || 0;
            } else {
                // Use main data
                finalPercentage = progressData.percentage || 0;
                finalTotalDistance = progressData.totalDistance || 0;
                finalCompletedDistance = progressData.completedDistance || 0;
            }

            console.log('📊 Final metrics selected:', {
                percentage: finalPercentage,
                totalDistance: finalTotalDistance,
                completedDistance: finalCompletedDistance,
                pointCount: completedPoints.length,
                usedCachedResults: !!(progressData.cachedResults && progressData.cachedResults.pointCount > 0 && (progressData.percentage === 0 || !progressData.percentage))
            });

            return {
                success: true,
                completedPoints: completedPoints,
                processedActivities: processedActivities,
                pointCount: completedPoints.length,
                percentage: finalPercentage,
                totalDistance: finalTotalDistance,
                completedDistance: finalCompletedDistance,
                lastUpdated: progressData.lastUpdated,
                source: 'firebase'
            };
            
        } catch (error) {
            console.error('❌ Error loading from Firebase:', error);
            return { success: false, reason: 'error', error: error.message };
        }
    }
    
    /**
     * UPDATE CACHE: Save Firebase data to localStorage for next time
     */
    updateCache(firebaseData) {
        try {
            console.log('💾 Updating cache with Firebase data...');
            
            // Update cache with calculated results
            if (firebaseData.percentage !== undefined) {
                const cachedResults = {
                    percentage: firebaseData.percentage,
                    totalDistance: firebaseData.totalDistance || 0,
                    completedDistance: firebaseData.completedDistance || 0,
                    pointCount: firebaseData.pointCount || 0,
                    lastCalculated: new Date().toISOString(),
                    source: 'firebase_sync'
                };
                
                localStorage.setItem('swcp_cached_results', JSON.stringify(cachedResults));
                console.log('✅ Cache updated with Firebase data');
            }
            
        } catch (error) {
            console.error('❌ Error updating cache:', error);
        }
    }
    
    /**
     * Convert Firebase string format back to coordinate arrays
     */
    convertFirebaseToPoints(firebaseData) {
        if (!Array.isArray(firebaseData)) return [];
        
        return firebaseData.map(pointStr => {
            const [lng, lat] = pointStr.split(',').map(parseFloat);
            return [lng, lat];
        }).filter(point => point.length === 2 && !isNaN(point[0]) && !isNaN(point[1]));
    }

    /**
     * Check if coordinate array is corrupted (all zeros or invalid coordinates)
     */
    areCoordinatesCorrupted(coordinates) {
        if (!Array.isArray(coordinates) || coordinates.length === 0) return true;
        
        // Check if all coordinates are [0,0] (the corruption pattern)
        const allZeros = coordinates.every(coord => 
            Array.isArray(coord) && coord.length === 2 && coord[0] === 0 && coord[1] === 0
        );
        
        if (allZeros) {
            console.log('🚨 Detected corrupted coordinates: all points are [0,0]');
            return true;
        }
        
        // Additional corruption checks could be added here
        // (e.g., all points identical, all points obviously invalid coordinates)
        
        return false;
    }
    
    /**
     * SIMPLIFIED SAVE: Firebase-first with cache update
     */
    async saveProgressToFirebase(progressData) {
        try {
            console.log('☁️ Saving to Firebase (unified structure)...');
            
            if (!this.isEnabled || !this.currentUser || !this.db) {
                console.log('❌ Firebase not enabled');
                return { success: false, reason: 'not_authenticated' };
            }
            
            // Handle unified data structure
            if (progressData.unifiedProgressData) {
                const unifiedData = progressData.unifiedProgressData;
                
                // 🛡️ CORRUPTION PROTECTION: Don't save corrupted coordinates
                if (unifiedData.completedPoints && this.areCoordinatesCorrupted(unifiedData.completedPoints)) {
                    console.error('🚨 CORRUPTION PROTECTION: Refusing to save corrupted coordinates to Firebase');
                    console.log('🛡️ Corrupted data:', unifiedData.completedPoints.slice(0, 5));
                    return { success: false, reason: 'corrupted_coordinates' };
                }
                
                // Convert nested arrays to Firebase-compatible format
                const firebaseCompatibleData = {
                    ...unifiedData,
                    // Convert coordinate arrays to strings for Firebase
                    completedPoints: unifiedData.completedPoints?.map(point => `${point[0]},${point[1]}`) || [],
                    completedPointsCount: unifiedData.completedPoints?.length || 0,
                    // Keep original nested array count for verification
                    _originalPointsCount: unifiedData.completedPoints?.length || 0
                };
                
                console.log('🔄 Firebase conversion:', {
                    originalPoints: unifiedData.completedPoints?.length || 0,
                    convertedPoints: firebaseCompatibleData.completedPoints?.length || 0,
                    sampleConverted: firebaseCompatibleData.completedPoints?.slice(0, 3)
                });
                
                // Save unified data to Firebase
                const docRef = doc(this.db, 'users', this.currentUser.uid);
                const { deleteField } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

                await updateDoc(docRef, {
                    'progressData.unifiedProgressData': firebaseCompatibleData,
                    'progressData.lastUpdated'        : new Date(),
                    'progressData.source'             : 'swcp-tracker-unified',

                    // Remove legacy summary keys
                    'progressData.completedDistance'  : deleteField(),
                    'progressData.totalDistance'      : deleteField(),
                    'progressData.percentage'         : deleteField(),

                    lastActive: new Date()
                }, { merge: true });
                
                console.log('✅ Unified progress saved to Firebase successfully');
                return { success: true, message: 'Unified data saved to Firebase' };
            }
            
            // Legacy support for old data structure (can be removed later)
            console.warn('⚠️ Using legacy data structure - should migrate to unified');
            return { success: false, reason: 'legacy_structure_not_supported' };
            
        } catch (error) {
            console.error('❌ Error saving to Firebase:', error);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Save to localStorage cache (fallback/performance)
     */
    saveToLocalStorageCache(progressData) {
        try {
            if (progressData.completedPoints) {
                // 🛡️ CORRUPTION PROTECTION: Don't save corrupted coordinates
                if (this.areCoordinatesCorrupted(progressData.completedPoints)) {
                    console.error('🚨 CORRUPTION PROTECTION: Refusing to save corrupted coordinates to localStorage');
                    console.log('🛡️ Corrupted data detected, keeping existing localStorage data');
                } else {
                    localStorage.setItem('swcp_completed_points', JSON.stringify(progressData.completedPoints));
                    console.log('✅ Saved valid coordinates to localStorage cache');
                }
            }
            if (progressData.processedActivities) {
                localStorage.setItem('swcp_processed_activities', JSON.stringify(progressData.processedActivities));
            }
        } catch (error) {
            console.error('❌ Error saving to localStorage cache:', error);
        }
    }
    
    /**
     * Show instant progress from cache - SAFE IMPLEMENTATION
     * Only updates display elements, never manipulates underlying data
     */
    async showInstantProgress() {
        try {
            console.log('⚡ Attempting safe instant progress display...');
            
            // Get cached results and validate them
            const cached = await this.loadCachedResults();
            if (!cached) {
                console.log('📱 No cached results available');
                return false;
            }
            
            // Validate cached data makes sense
            if (!this.validateCachedData(cached)) {
                console.log('⚠️ Cached data failed validation, using normal loading');
                return false;
            }
            
            // Get current stored progress for verification
            const storedPoints = JSON.parse(localStorage.getItem('swcp_completed_points') || '[]');
            const storedActivities = JSON.parse(localStorage.getItem('swcp_processed_activities') || '[]');
            
            // Safety check: ensure cached data matches stored data
            if (cached.pointCount !== storedPoints.length) {
                console.log(`⚠️ Cached point count (${cached.pointCount}) doesn't match stored (${storedPoints.length}), using normal loading`);
                return false;
            }
            
            // SAFE: Only update display text elements, never touch data arrays
            this.updateDisplayElementsOnly(cached);
            
            console.log('⚡ Instant progress displayed safely from cache');
            if (window.log) {
                window.log(`⚡ Instant loading: ${cached.percentage}% (${cached.pointCount} waypoints)`, 'success');
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Error in safe instant progress:', error);
            return false;
        }
    }
    
    /**
     * Validate cached data is sensible before using it
     */
    validateCachedData(cached) {
        if (!cached) return false;
        
        // Check required fields exist
        if (typeof cached.percentage !== 'number' || 
            typeof cached.totalDistance !== 'number' ||
            typeof cached.pointCount !== 'number') {
            console.log('❌ Cached data missing required numeric fields');
            return false;
        }
        
        // Check values are reasonable
        if (cached.percentage < 0 || cached.percentage > 100) {
            console.log('❌ Cached percentage out of range:', cached.percentage);
            return false;
        }
        
        if (cached.totalDistance < 0 || cached.totalDistance > 1000) {
            console.log('❌ Cached distance out of range:', cached.totalDistance);
            return false;
        }
        
        if (cached.pointCount < 0 || cached.pointCount > 10000) {
            console.log('❌ Cached point count out of range:', cached.pointCount);
            return false;
        }
        
        // Check data is recent (not older than 30 days)
        if (cached.lastCalculated) {
            const cacheAge = Date.now() - new Date(cached.lastCalculated).getTime();
            const thirtyDays = 30 * 24 * 60 * 60 * 1000;
            if (cacheAge > thirtyDays) {
                console.log('❌ Cached data too old:', new Date(cached.lastCalculated));
                return false;
            }
        }
        
        console.log('✅ Cached data validation passed');
        return true;
    }
    
    /**
     * SAFE: Update only display text elements, never touch data structures
     */
    updateDisplayElementsOnly(cached) {
        try {
            // Update percentage display
            const percentageEl = document.getElementById('progress-percentage');
            if (percentageEl) {
                percentageEl.textContent = `${cached.percentage.toFixed(2)}%`;
                console.log('✅ Updated percentage display');
            }
            
            // Update completed distance display
            const completedEl = document.getElementById('completed-distance');
            if (completedEl) {
                completedEl.textContent = `${cached.totalDistance.toFixed(2)} km`;
                console.log('✅ Updated completed distance display');
            }
            
            // Update remaining distance display
            const remainingEl = document.getElementById('remaining-distance');
            const totalEl = document.getElementById('total-distance');
            if (remainingEl && totalEl) {
                const total = parseFloat(totalEl.textContent) || 630; // SWCP total
                const remaining = Math.max(total - cached.totalDistance, 0);
                remainingEl.textContent = `${remaining.toFixed(2)} km`;
                console.log('✅ Updated remaining distance display');
            }
            
                         // Set elevation and time based on whether we have progress
             const elevationEl = document.getElementById('elevation-gained');
             const timeEl = document.getElementById('time-taken');
             
             if (cached.pointCount > 0) {
                 // Have progress - elevation/time will be calculated in background verification
                 console.log('⏳ Elevation/time will be calculated in background verification');
             } else {
                 // No progress - set to 0 immediately
                 if (elevationEl) elevationEl.textContent = '0 m';
                 if (timeEl) timeEl.textContent = '0h 0m';
                 console.log('✅ Set elevation/time to 0 (no progress)');
             }
             
             console.log('✅ Display elements updated safely');
            
        } catch (error) {
            console.error('❌ Error updating display elements:', error);
        }
    }

    /**
     * Force sync current localStorage to Firebase (for testing)
     */
    async forceSyncToFirebase() {
        if (!this.isEnabled) {
            console.log('❌ Cannot sync: Firebase not enabled');
            return { success: false, error: 'Not authenticated' };
        }

        try {
            const localProgress = this.getLocalStorageProgress();
            console.log('🔄 Force syncing localStorage to Firebase:', localProgress);
            
            const result = await this.saveToFirebase(localProgress);
            if (result.success) {
                console.log('✅ Force sync completed successfully');
            }
            return result;
        } catch (error) {
            console.error('❌ Force sync failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * NUCLEAR OPTION: Delete ALL Firebase data for the user
     */
    async deleteAllFirebaseData() {
        if (!this.isEnabled) {
            console.log('❌ Cannot delete: Firebase not enabled');
            return { success: false, error: 'Not authenticated' };
        }

        try {
            console.log('🗑️ DELETING ALL Firebase data for user...');
            
            // Clear all progress data by saving empty data
            const emptyProgressData = {
                // Legacy flat fields
                completedPoints: [],
                processedActivities: [],
                totalDistance: 0,
                completedDistance: 0,
                percentage: 0,
                totalElevation: 0,
                totalTime: 0,
                cachedResults: null,
                completedPointsCount: 0,
                completedPointsData: [],
                // Unified structure cleared as well
                unifiedProgressData: {
                    completedPoints: [],
                    completedDistance: 0,
                    percentage: 0,
                    analyzedActivityIds: [],
                    activityStats: {},
                    totalElevation: 0,
                    totalTime: 0,
                    totalRouteDistance: 0,
                    version: 1,
                    lastUpdated: new Date().toISOString()
                },
                lastUpdated: new Date(),
                source: 'swcp-tracker-reset'
            };

            // Use direct Firebase save with protection bypass for intentional reset
            const result = await this.saveToFirebase(emptyProgressData, true); // true = bypass protection
            
            if (result.success) {
                console.log('✅ All Firebase data deleted successfully');
                return { success: true };
            } else {
                console.error('❌ Failed to delete Firebase data:', result.error);
                return { success: false, error: result.error };
            }
        } catch (error) {
            console.error('❌ Error deleting Firebase data:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Save activity data to Firebase with analysis status
     * @param {Array} activities - Array of Strava activities
     * @returns {Promise<boolean>} Success status
     */
    async saveActivitiesToFirebase(activities) {
        if (!this.isEnabled || !this.db) {
            console.log('📱 Firebase not enabled, skipping activity save');
            return false;
        }

        try {
            const user = userManager.getCurrentUser();
            if (!user) {
                console.warn('❌ No authenticated user for activity save');
                return false;
            }

            // Merge with existing activities in Firestore to prevent accidental data loss

            const userDocRef = doc(this.db, 'users', user.uid);

            let existingActivities = [];
            try {
                const snap = await getDoc(userDocRef);
                if (snap.exists() && snap.data().activities && Array.isArray(snap.data().activities.activities)) {
                    existingActivities = snap.data().activities.activities;
                }
            } catch (mergeErr) {
                console.warn('⚠️ Could not read existing activities for merge:', mergeErr);
            }

            // Build a map by id so we can deduplicate and preserve analysed status
            const byId = {};
            existingActivities.forEach(a => {
                if (a && a.id !== undefined) {
                    byId[String(a.id)] = a;
                }
            });

            activities.forEach(a => {
                if (!a || a.id === undefined) return;
                const idKey = String(a.id);
                const existing = byId[idKey] || {};
                // Preserve analysed flag if it was ever true
                const analysed = (a.analyzed || existing.analyzed) ? true : false;
                byId[idKey] = { ...existing, ...a, analyzed: analysed };
            });

            const mergedActivities = Object.values(byId);

            // --- SAFETY CHECK ----------------------------------------------------
            if (existingActivities.length > 20 && mergedActivities.length < existingActivities.length * 0.9) {
                console.error(`🚨 FIREBASE PROTECTION: Refusing to overwrite ${existingActivities.length} activities with only ${mergedActivities.length}`);
                return false;
            }

            // Create activities document structure with merged list
            const activitiesData = {
                activities: mergedActivities,
                lastUpdated: new Date().toISOString(),
                totalCount: mergedActivities.length
            };

            await setDoc(userDocRef, {
                activities: activitiesData
            }, { merge: true });

            console.log(`🔥 Successfully saved ${activities.length} activities to Firebase`);
            return true;
        } catch (error) {
            console.error('❌ Error saving activities to Firebase:', error);
            return false;
        }
    }

    /**
     * Load activity data from Firebase
     * @returns {Promise<Array|null>} Activities array or null
     */
    async loadActivitiesFromFirebase() {
        if (!this.isEnabled || !this.db) {
            console.log('📱 Firebase not enabled, using localStorage only');
            return null;
        }

        try {
            const user = userManager.getCurrentUser();
            if (!user) {
                console.warn('❌ No authenticated user for activity load');
                return null;
            }

            const userDocRef = doc(this.db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);

            if (userDoc.exists() && userDoc.data().activities) {
                const activitiesData = userDoc.data().activities;
                console.log(`🔥 Loaded ${activitiesData.totalCount} activities from Firebase`);
                return activitiesData.activities;
            }

            console.log('📱 No activities found in Firebase');
            return null;
        } catch (error) {
            console.error('❌ Error loading activities from Firebase:', error);
            return null;
        }
    }

    /**
     * Update analysis status for a specific activity
     * @param {string} activityId - The activity ID
     * @param {boolean} analyzed - Whether the activity has been analyzed
     * @returns {Promise<boolean>} Success status
     */
    async updateActivityAnalysisStatus(activityId, analyzed = true) {
        if (!this.isEnabled || !this.db) {
            console.log('📱 Firebase not enabled, skipping status update');
            return false;
        }

        try {
            const user = userManager.getCurrentUser();
            if (!user) {
                console.warn('❌ No authenticated user for status update');
                return false;
            }

            const userDocRef = doc(this.db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);

            if (userDoc.exists() && userDoc.data().activities) {
                const activitiesData = userDoc.data().activities;
                
                // Find and update the specific activity
                const updatedActivities = activitiesData.activities.map(activity => {
                    if (String(activity.id) === String(activityId)) {
                        return { ...activity, analyzed };
                    }
                    return activity;
                });

                // Update the document
                await updateDoc(userDocRef, {
                    'activities.activities': updatedActivities,
                    'activities.lastUpdated': new Date().toISOString()
                });

                console.log(`🔥 Updated analysis status for activity ${activityId} to ${analyzed}`);
                return true;
            }

            console.warn('❌ No activities data found to update');
            return false;
        } catch (error) {
            console.error('❌ Error updating activity analysis status:', error);
            return false;
        }
    }

    /**
     * Check if activities data is stale and needs refresh from Strava
     * @returns {Promise<boolean>} True if refresh needed
     */
    async needsActivityRefresh() {
        if (!this.isEnabled || !this.db) {
            return true; // Always refresh if Firebase not available
        }

        try {
            const user = userManager.getCurrentUser();
            if (!user) return true;

            const userDocRef = doc(this.db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);

            if (!userDoc.exists() || !userDoc.data().activities) {
                return true; // No data, needs refresh
            }

            return false; // Data exists, no refresh needed
        } catch (error) {
            console.error('❌ Error checking activity refresh need:', error);
            return true; // Error means refresh needed
        }
    }
}

// Create singleton instance
export const firebaseProgressService = new FirebaseProgressService();

// Export for debugging
window.firebaseProgressService = firebaseProgressService;

// Add global debugging functions
window.testFirebaseSync = async () => {
    console.log('🧪 Testing Firebase Sync...');
    const status = firebaseProgressService.getStatus();
    console.log('📊 Status:', status);
    
    if (!status.isEnabled) {
        console.log('❌ Not authenticated - please log in first');
        return;
    }
    
    const result = await firebaseProgressService.forceSyncToFirebase();
    console.log('🔄 Sync result:', result);
    return result;
};

window.testInstantLoading = async () => {
    console.log('⚡ Testing Instant Loading...');
    
    const cachedResults = await firebaseProgressService.loadCachedResults();
    console.log('📋 Cached results:', cachedResults);
    
    if (cachedResults) {
        console.log('⚡ Showing instant progress...');
        const result = await firebaseProgressService.showInstantProgress();
        console.log('✅ Instant loading result:', result);
    } else {
        console.log('❌ No cached results found');
    }
    
    return cachedResults;
};

window.testFirebaseReset = async () => {
    console.log('🗑️ Testing Firebase Reset...');
    
    if (!firebaseProgressService.isEnabled) {
        console.log('❌ Not authenticated - please log in first');
        return;
    }
    
    const result = await firebaseProgressService.deleteAllFirebaseData();
    console.log('🔄 Reset result:', result);
    return result;
};

window.testInstantLoadingSafe = async () => {
    console.log('⚡ Testing Safe Instant Loading...');
    
    console.log('📊 Current progress state:');
    const points = JSON.parse(localStorage.getItem('swcp_completed_points') || '[]');
    const cached = await firebaseProgressService.loadCachedResults();
    console.log(`  Points: ${points.length}`);
    console.log(`  Cached: ${cached ? 'YES' : 'NO'}`);
    
    if (cached) {
        console.log('  Cached data:', cached);
        
        console.log('⚡ Testing instant display...');
        const result = await firebaseProgressService.showInstantProgress();
        console.log('✅ Instant loading result:', result);
        
        if (result) {
            console.log('✅ Instant loading succeeded - display should have updated');
        } else {
            console.log('❌ Instant loading failed - check validation');
        }
    } else {
        console.log('❌ No cached data available - process some activities first');
    }
    
    return { 
        hasPoints: points.length > 0,
        hasCached: !!cached,
        instantLoadingWorked: cached ? await firebaseProgressService.showInstantProgress() : false
    };
};

window.debugProgressData = async () => {
    console.log('🔍 DEBUG: Progress Data Investigation');
    
    // Check localStorage
    const localPoints = JSON.parse(localStorage.getItem('swcp_completed_points') || '[]');
    const localActivities = JSON.parse(localStorage.getItem('swcp_processed_activities') || '[]');
    const localCache = JSON.parse(localStorage.getItem('swcp_cached_results') || 'null');
    
    console.log('📱 localStorage data:', {
        points: localPoints.length,
        activities: localActivities.length,
        hasCache: !!localCache,
        cacheData: localCache
    });
    
    // Check Firebase
    if (firebaseProgressService.isEnabled) {
        console.log('☁️ Loading from Firebase...');
        const firebaseResult = await firebaseProgressService.loadFromFirebase();
        console.log('☁️ Firebase result:', firebaseResult);
        
        // Check userManager directly
        console.log('👤 Checking userManager...');
        const userProgress = await userManager.getProgressData();
        console.log('👤 User progress data:', userProgress);
        
        // Check what's in the actual user document
        const userProfile = await userManager.getCurrentUserProfile();
        console.log('👤 Full user profile:', userProfile);
    } else {
        console.log('❌ Firebase not enabled');
    }
    
    // Check current UI display
    const percentageEl = document.getElementById('progress-percentage');
    const completedEl = document.getElementById('completed-distance');
    const remainingEl = document.getElementById('remaining-distance');
    
    console.log('🖥️ Current UI display:', {
        percentage: percentageEl?.textContent || 'NOT FOUND',
        completed: completedEl?.textContent || 'NOT FOUND',
        remaining: remainingEl?.textContent || 'NOT FOUND'
    });
    
    return {
        localStorage: { points: localPoints.length, activities: localActivities.length },
        firebase: firebaseProgressService.isEnabled ? 'enabled' : 'disabled',
        ui: {
            percentage: percentageEl?.textContent,
            completed: completedEl?.textContent,
            remaining: remainingEl?.textContent
        }
    };
}; 