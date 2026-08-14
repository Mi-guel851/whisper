import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.whisper.app',
  appName: 'Whisper',
  webDir: 'public',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    overrideUserAgent: "WhisperApp/1.0 Android",
    backgroundColor: "#000000",
  },
  server: {
    url: 'https://whisper-anonymous.vercel.app',
    cleartext: false,
    errorPath: 'offline.html',
    androidScheme: "https"
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    GoogleAuth: {
      scopes: ["profile", "email"],
      serverClientId: "226343458064-tq6nf31ekoos2h6r7dk4dc1o1cobaoh5.apps.googleusercontent.com",
      forceCodeForRefreshToken: true,
    },
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: "#634BFF",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
  },
};

export default config;