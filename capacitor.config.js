const config = {
  appId: 'com.benmoore.swcp.tracker',
  appName: 'SWCP Tracker',
  webDir: '.',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#f5f1e8",
      showSpinner: true,
      spinnerColor: "#49614b"
    },
    StatusBar: {
      style: 'DEFAULT',
      backgroundColor: "#49614b"
    },
    Geolocation: {
      permissions: ['location']
    }
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true
  }
};

module.exports = config; 