import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.emeraldonline3ds.mobile",
  appName: "Emerald Online 3DS",
  webDir: "dist",
  ios: {
    scheme: "EmeraldOnline3DS",
    contentInset: "always",
    preferredContentMode: "mobile",
  },
  plugins: {
    SplashScreen: {
      backgroundColor: "#0a1f17",
      launchShowDuration: 1200,
      launchAutoHide: true,
      launchFadeOutDuration: 300,
      iosSpinnerStyle: "small",
      spinnerColor: "#00a86b",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0a1f17",
      overlaysWebView: true,
    },
  },
};

export default config;
