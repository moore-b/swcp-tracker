# SWCP Tracker - Android App Setup Guide

This guide will help you convert your SWCP Tracker web app into an Android app using Capacitor.

## Prerequisites

1. **Node.js** (version 16 or higher)
2. **Android Studio** with Android SDK
3. **Java Development Kit (JDK)** 8 or 11

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Initialize Capacitor

```bash
npx cap init
```

## Step 3: Add Android Platform

```bash
npx cap add android
```

## Step 4: Sync Your Web App

```bash
npx cap sync android
```

## Step 5: Open in Android Studio

```bash
npx cap open android
```

## Step 6: Configure Android Permissions

The app needs these permissions. They'll be automatically added, but verify in `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

## Step 7: Build and Test

1. In Android Studio, click the green "Run" button
2. Select a device or emulator
3. The app will build and install

## Features Added for Mobile

### Progressive Web App (PWA) Features
- ✅ Web App Manifest with proper metadata
- ✅ Service Worker for offline functionality
- ✅ App icons for different sizes
- ✅ Splash screen configuration

### Native Mobile Features (via Capacitor)
- 📍 **Geolocation** - Access device GPS
- 📱 **Status Bar** - Native Android status bar styling
- 🎨 **Splash Screen** - Native loading screen
- 📶 **Network Status** - Detect online/offline status
- 📱 **Device Info** - Access device information

## Recommended Enhancements

### 1. Add GPS Integration
Update your JavaScript to use Capacitor's Geolocation:

```javascript
import { Geolocation } from '@capacitor/geolocation';

const getCurrentPosition = async () => {
  const coordinates = await Geolocation.getCurrentPosition();
  return coordinates;
};
```

### 2. Network Status Detection
```javascript
import { Network } from '@capacitor/network';

Network.addListener('networkStatusChange', status => {
  console.log('Network status changed', status);
});
```

### 3. Enable Background Sync
For syncing Strava data when the app comes back online.

## Building for Production

### Debug Build
```bash
npx cap run android
```

### Release Build
```bash
npx cap build android
```

Then in Android Studio:
1. Build → Generate Signed Bundle/APK
2. Choose "Android App Bundle"
3. Sign with your keystore
4. Upload to Google Play Store

## App Store Requirements

### Google Play Store
1. **Target API Level**: Android 13 (API 33) or higher
2. **64-bit Support**: Required (Capacitor handles this)
3. **Privacy Policy**: Required for apps accessing location
4. **App Signing**: Use Google Play App Signing

### App Information
- **Package Name**: `com.benmoore.swcp.tracker`
- **App Name**: SWCP Tracker
- **Category**: Health & Fitness
- **Content Rating**: Everyone

## Troubleshooting

### Common Issues

1. **Build Errors**: Make sure Android SDK is properly installed
2. **Permission Denied**: Check AndroidManifest.xml permissions
3. **Network Issues**: Verify HTTPS URLs in production

### Performance Tips

1. **Image Optimization**: Compress your background images
2. **Caching**: The service worker caches resources for offline use
3. **API Calls**: Implement proper error handling for Strava API

## File Structure After Setup

```
swcp-tracker/
├── android/                 # Native Android project
│   ├── app/
│   └── build.gradle
├── node_modules/            # Dependencies
├── package.json             # Project configuration
├── capacitor.config.js      # Capacitor configuration
├── sw.js                   # Service worker for PWA
├── site.webmanifest        # PWA manifest
└── [existing web files]    # Your current HTML/CSS/JS
```

## Next Steps

1. Test the app thoroughly on different Android devices
2. Add more native features as needed
3. Optimize for different screen sizes
4. Submit to Google Play Store

## Support

For issues with:
- **Capacitor**: https://capacitorjs.com/docs
- **Android Development**: https://developer.android.com
- **PWA Features**: https://web.dev/progressive-web-apps 