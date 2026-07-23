import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mob.app',
  appName: 'MOB - Malhando os Bacons',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    buildOptions: {
      keystorePath: 'mob-release.keystore',
      keystoreAlias: 'mob',
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#18181b',
      showSpinner: false,
    },
  },
};

export default config;
