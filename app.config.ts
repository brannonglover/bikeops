import type { ExpoConfig, ConfigContext } from "expo/config";
import packageJson from "./package.json";

const IS_DEV = process.env.APP_VARIANT === "development";

const version = packageJson.version;
const buildNumber = process.env.APP_BUILD_NUMBER ?? "1";
const versionCode = parseInt(buildNumber, 10);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV ? "BikeOps (Dev)" : "BikeOps",
  slug: "bikeops",
  version,
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "bikeops",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#1e1e1e",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: IS_DEV ? "com.brannonglover.bikeops.app.dev" : "com.brannonglover.bikeops.app",
    buildNumber,
    userInterfaceStyle: "automatic",
    infoPlist: {
      UIBackgroundModes: ["remote-notification"],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#1e1e1e",
    },
    userInterfaceStyle: "automatic",
    package: IS_DEV ? "com.brannonglover.bikeops.app.dev" : "com.brannonglover.bikeops.app",
    versionCode,
  },
  web: {
    favicon: "./assets/favicon.png",
    bundler: "metro",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    "expo-system-ui",
    ["expo-notifications", { sounds: [], mode: IS_DEV ? "development" : "production" }],
  ],
});
