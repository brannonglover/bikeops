import type { ExpoConfig, ConfigContext } from "expo/config";
import packageJson from "./package.json";

const IS_DEV = process.env.APP_VARIANT === "development";

const version = packageJson.version;

function getBuildNumber(): string {
  if (process.env.APP_BUILD_NUMBER) return process.env.APP_BUILD_NUMBER;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
}

// Android versionCode must be a positive 32-bit integer.
// Minutes since 2024-01-01 gives ~4,000 years of headroom.
function getVersionCode(): number {
  if (process.env.APP_BUILD_NUMBER) return parseInt(process.env.APP_BUILD_NUMBER, 10);
  const epoch = new Date("2024-01-01T00:00:00Z").getTime();
  return Math.floor((Date.now() - epoch) / 60_000);
}

const buildNumber = getBuildNumber();
const versionCode = getVersionCode();

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV ? "BikeOps (Dev)" : "BikeOps",
  slug: "bikeops",
  version,
  orientation: "default",
  icon: "./assets/icon.png",
  scheme: "bikeops",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  updates: {
    url: "https://u.expo.dev/dd40df73-ac62-42be-8a5c-921540bcc3b2",
  },
  runtimeVersion: {
    policy: "appVersion",
  },
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
    associatedDomains: ["applinks:bikeops.co", "applinks:*.bikeops.co"],
    infoPlist: {
      UIBackgroundModes: ["remote-notification", "fetch", "processing"],
      ITSAppUsesNonExemptEncryption: false,
      LSApplicationCategoryType: "public.app-category.utilities",
      BGTaskSchedulerPermittedIdentifiers: [
        IS_DEV
          ? "com.brannonglover.bikeops.app.dev.notifications"
          : "com.brannonglover.bikeops.app.notifications",
      ],
    },
    // Re-enable when the Apple Proximity Reader entitlement is approved.
    // entitlements: {
    //   "com.apple.developer.proximity-reader.payment.acceptance": true,
    // },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#1e1e1e",
    },
    userInterfaceStyle: "automatic",
    package: IS_DEV ? "com.brannonglover.bikeops.app.dev" : "com.brannonglover.bikeops.app",
    versionCode,
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          { scheme: "https", host: "bikeops.co", pathPrefix: "/staff/chat" },
          { scheme: "https", host: "*.bikeops.co", pathPrefix: "/staff/chat" },
          { scheme: "https", host: "bikeops.co", pathPrefix: "/open/staff/chat" },
          { scheme: "https", host: "*.bikeops.co", pathPrefix: "/open/staff/chat" },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    "expo-system-ui",
    ["expo-notifications", { sounds: [], mode: IS_DEV ? "development" : "production" }],
    "./plugins/withDynamicVersioning",
    ["@stripe/stripe-terminal-react-native", {
      bluetoothBackgroundMode: false,
      locationWhenInUsePermission: "Location access is required in order to accept payments.",
      bluetoothPeripheralPermission: "Bluetooth access is required in order to connect to supported card readers.",
      bluetoothAlwaysUsagePermission: "This app uses Bluetooth to connect to supported card readers.",
    }],
  ],
  extra: {
    eas: {
      // Find this at expo.dev → your project → Project settings, or run: eas project:info
      projectId: process.env.EAS_PROJECT_ID ?? "dd40df73-ac62-42be-8a5c-921540bcc3b2",
    },
  },
});
