import type { CapacitorConfig } from '@capacitor/cli';

// The Android app: the same phone page (dist/) in a WebView. Like the WebApp: http://localhost (still a secure
// context for the motion sensors), and cleartext so the app can reach the audience server on the LAN
// (ws://<show PC>:5191/ws) during milestone 1; Azure Web PubSub (wss) later.
const config: CapacitorConfig = {
  appId: 'com.videodromm.reymenta',
  appName: 'Reymenta',
  webDir: 'dist',
  backgroundColor: '#000000',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
