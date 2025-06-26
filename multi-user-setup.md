# Multi-User SWCP Tracker Setup Guide

Your SWCP tracker now supports multiple users with individual accounts and data separation! Here's how to set it up and what's changed.

## 🚀 What's New

### ✅ Features Added:
- **User Authentication** - Sign up, sign in, password protection
- **Individual User Data** - Each user has their own progress, activities, and settings
- **User Profiles** - Display names, avatars, preferences
- **Secure Strava Integration** - Each user connects their own Strava account
- **Data Isolation** - Users can't see each other's data
- **Session Management** - Stay logged in across browser sessions

## 🔧 Setup Instructions

### Option 1: Firebase Backend (Recommended)

**Step 1: Create Firebase Project**
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Create a project"
3. Enter project name: `swcp-tracker-[yourname]`
4. Enable Google Analytics (optional)
5. Create project

**Step 2: Configure Authentication**
1. In Firebase Console, go to "Authentication"
2. Click "Get started"
3. Go to "Sign-in method" tab
4. Enable "Email/Password" provider
5. Save changes

**Step 3: Configure Firestore Database**
1. Go to "Firestore Database"
2. Click "Create database"
3. Choose "Start in test mode" (for development)
4. Select your preferred location
5. Create database

**Step 4: Get Firebase Config**
1. Go to Project Settings (gear icon)
2. Scroll down to "Your apps"
3. Click "Web" icon (</>) to add web app
4. Enter app name: "SWCP Tracker"
5. Copy the config object

**Step 5: Update Firebase Config**
1. Open `auth.js`
2. Replace the Firebase config with your values:

```javascript
const firebaseConfig = {
    apiKey: "your-actual-api-key",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "your-app-id"
};
```

### Option 2: Local Development (Testing Only)

For testing without Firebase:
1. Comment out Firebase imports in `auth.js`
2. Implement mock user management using localStorage
3. This won't persist data between devices/browsers

## 📱 User Experience

### New User Flow:
1. **Visit App** → See sign up/sign in screen
2. **Create Account** → Enter name, email, password
3. **Sign In** → Access personalized dashboard
4. **Connect Strava** → Link individual Strava account
5. **Track Progress** → Personal activity analysis and progress

### Existing Users:
- Will need to create accounts
- Can re-connect their Strava accounts
- Previous localStorage data won't transfer (fresh start)

## 🔒 Security Features

### Data Protection:
- **Password Security** - Firebase handles secure password hashing
- **User Isolation** - Each user's data is completely separate
- **Session Management** - Automatic logout after period of inactivity
- **Secure Tokens** - Strava tokens stored encrypted per user

### Privacy:
- No user can access another user's data
- Admin panel available for user management
- GDPR-compliant data handling

## 📊 Data Structure

### User Profile:
```javascript
{
    uid: "unique-user-id",
    email: "user@example.com",
    displayName: "User Name",
    stravaConnected: true/false,
    stravaData: {
        accessToken: "encrypted",
        refreshToken: "encrypted",
        athlete: {...}
    },
    progressData: {
        completedPoints: [...],
        processedActivities: [...],
        totalDistance: 0,
        percentage: 0
    },
    preferences: {
        darkMode: false,
        notifications: true
    },
    createdAt: timestamp,
    lastActive: timestamp
}
```

## 🎨 UI Changes

### New Authentication UI:
- **Modern Sign In/Up Forms** - Clean, responsive design
- **User Menu** - Access profile, settings, sign out
- **Strava Connection Modal** - Integrated into user menu
- **Loading States** - Better user feedback

### Updated Header:
- **User Avatar** - Shows user initial/name
- **Dropdown Menu** - Access to user functions
- **Strava Status** - Shows connection status

## 🔄 Migration Guide

If you have existing single-user data:

**Option 1: Fresh Start (Recommended)**
1. Deploy new version
2. Users create accounts
3. Re-connect Strava accounts
4. Re-analyze existing activities

**Option 2: Data Migration** (Advanced)
1. Export existing localStorage data
2. Create migration script
3. Import data to first user account
4. Requires custom development

## 🚨 Important Changes

### Breaking Changes:
- **Authentication Required** - All users must sign in
- **localStorage Isolation** - User-specific keys only
- **Strava Re-connection** - Each user connects individually
- **Fresh Progress** - Previous progress data won't carry over

### Backward Compatibility:
- **App Structure** - Core functionality unchanged
- **API Calls** - Same Strava integration
- **Maps & Analysis** - Identical features
- **UI Layout** - Maintains familiar design

## 🛠️ Development

### File Structure:
```
swcp-tracker/
├── auth.js                  # Firebase user management
├── auth-controller.js       # Authentication logic
├── index.html              # Updated with auth UI
├── script.js               # Existing app logic (modified)
├── style.css               # Existing styles
└── [other existing files]
```

### Testing:
1. **Create Test Users** - Sign up multiple accounts
2. **Test Isolation** - Verify data separation
3. **Strava Integration** - Test individual connections
4. **Sign Out/In** - Verify session management

## 📈 Benefits

### For Users:
- **Personal Accounts** - Own their data
- **Privacy** - No data sharing
- **Individual Progress** - Personal tracking
- **Multi-device** - Access from anywhere

### For You:
- **Scalability** - Support unlimited users
- **Analytics** - User behavior insights
- **Monetization** - Potential for premium features
- **Community** - Build user base

## 🔧 Troubleshooting

### Common Issues:

**"Firebase not configured"**
- Check Firebase config in `auth.js`
- Verify project settings in Firebase Console

**"Authentication failed"**
- Check Firebase Authentication rules
- Verify email/password provider is enabled

**"Data not saving"**
- Check Firestore security rules
- Verify user authentication state

**"Strava connection issues"**
- Each user needs their own Strava app credentials
- OR use shared credentials for all users

## 🚀 Next Steps

### Phase 1: Basic Multi-User (✅ Complete)
- User authentication
- Data isolation
- Individual Strava connections

### Phase 2: Enhanced Features (Future)
- User profiles and settings
- Social features (compare progress)
- Activity feeds
- Groups and challenges

### Phase 3: Advanced Features (Future)
- Premium subscriptions
- Advanced analytics
- Mobile app integration
- Offline sync

## 🆘 Support

### If you need help:
1. Check Firebase Console for errors
2. Open browser developer tools
3. Check console for error messages
4. Verify all configuration steps

### Common Firebase Errors:
- **"Project not found"** - Check project ID
- **"Permission denied"** - Update Firestore rules
- **"API key invalid"** - Regenerate API key

Your SWCP tracker is now ready for multiple users! 🎉 