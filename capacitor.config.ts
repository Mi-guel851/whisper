import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.whisper.app',
  appName: 'Whisper',
  webDir: 'public',
  android: {
    allowMixedContent: false,
    /*
     * `captureInput` must stay false.
     *
     * It routes hardware/IME key events straight into the WebView instead of
     * letting the Android input method own the field, and the IME's own features
     * go with it: the suggestion strip, autocorrect, and the emoji key are all
     * drawn by the keyboard for the field it thinks it is editing. With capture on,
     * the keyboard no longer believes it is editing anything, so it renders a bare
     * QWERTY with the emoji key greyed out — which is exactly the difference
     * between the app and the website, where nothing intercepts the field.
     *
     * It exists for games and canvas apps that need raw keys. A messaging app is
     * the opposite of that case.
     */
    captureInput: false,
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