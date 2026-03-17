// Template for generating Info.plist

export interface InfoPlistConfig {
  appName: string;
  bundleId: string;
  version: string;
  buildNumber: string;
  minimumOSVersion: string;
  supportedOrientations: string[];
  requiresFullScreen: boolean;
  urlSchemes?: string[];
  associatedDomains?: string[];
}

export function generateInfoPlist(config: InfoPlistConfig): string {
  const orientations = config.supportedOrientations
    .map(o => `\t\t<string>${o}</string>`)
    .join('\n');

  const urlSchemes = config.urlSchemes && config.urlSchemes.length > 0
    ? `\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
${config.urlSchemes.map(s => `\t\t\t\t<string>${s}</string>`).join('\n')}
\t\t\t</array>
\t\t</dict>
\t</array>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDevelopmentRegion</key>
\t<string>$(DEVELOPMENT_LANGUAGE)</string>
\t<key>CFBundleDisplayName</key>
\t<string>${config.appName}</string>
\t<key>CFBundleExecutable</key>
\t<string>$(EXECUTABLE_NAME)</string>
\t<key>CFBundleIdentifier</key>
\t<string>${config.bundleId}</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleName</key>
\t<string>$(PRODUCT_NAME)</string>
\t<key>CFBundlePackageType</key>
\t<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
\t<key>CFBundleShortVersionString</key>
\t<string>${config.version}</string>
\t<key>CFBundleVersion</key>
\t<string>${config.buildNumber}</string>
\t<key>LSRequiresIPhoneOS</key>
\t<true/>
\t<key>MinimumOSVersion</key>
\t<string>${config.minimumOSVersion}</string>
\t<key>UIRequiresFullScreen</key>
\t<${config.requiresFullScreen}/>
\t<key>UISupportedInterfaceOrientations</key>
\t<array>
${orientations}
\t</array>
\t<key>UILaunchScreen</key>
\t<dict/>
${urlSchemes}
</dict>
</plist>
`;
}

export function generatePrivacyManifest(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>NSPrivacyTracking</key>
\t<false/>
\t<key>NSPrivacyTrackingDomains</key>
\t<array/>
\t<key>NSPrivacyCollectedDataTypes</key>
\t<array/>
\t<key>NSPrivacyAccessedAPITypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>NSPrivacyAccessedAPIType</key>
\t\t\t<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>
\t\t\t<array>
\t\t\t\t<string>CA92.1</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>
`;
}

export function generateEntitlements(config: { associatedDomains?: string[] }): string {
  const domains = config.associatedDomains && config.associatedDomains.length > 0
    ? `\t<key>com.apple.developer.associated-domains</key>
\t<array>
${config.associatedDomains.map(d => `\t\t<string>applinks:${d}</string>`).join('\n')}
\t</array>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${domains}
</dict>
</plist>
`;
}
