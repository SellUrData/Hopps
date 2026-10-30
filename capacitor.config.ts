import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sellurdata.hopps',
  appName: 'Hopps',
  webDir: 'dist',
  backgroundColor: '#0b0f17',
  android: {
    backgroundColor: '#0b0f17',
  },
  ios: {
    backgroundColor: '#0b0f17',
    contentInset: 'never',
  },
};

export default config;
