const { withInfoPlist, withXcodeProject } = require("expo/config-plugins");

/**
 * Replaces hardcoded version/build values in Info.plist with Xcode build
 * setting variables and sets MARKETING_VERSION / CURRENT_PROJECT_VERSION
 * in the xcodeproj so Xcode always drives version resolution.
 */
const withDynamicVersioning = (config) => {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.CFBundleShortVersionString = "$(MARKETING_VERSION)";
    mod.modResults.CFBundleVersion = "$(CURRENT_PROJECT_VERSION)";
    return mod;
  });

  config = withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();

    for (const key in configurations) {
      const buildSettings = configurations[key]?.buildSettings;
      if (!buildSettings) continue;

      if (buildSettings.PRODUCT_BUNDLE_IDENTIFIER) {
        buildSettings.MARKETING_VERSION = config.version ?? "1.0.0";
        buildSettings.CURRENT_PROJECT_VERSION = config.ios?.buildNumber ?? "1";
      }
    }

    return mod;
  });

  return config;
};

module.exports = withDynamicVersioning;
