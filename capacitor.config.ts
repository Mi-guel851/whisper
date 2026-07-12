import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.whisper.app',
  appName: 'Whisper',
  webDir: 'public',
  server: {
    url: 'https://whisper-anonymous.vercel.app',
    cleartext: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;