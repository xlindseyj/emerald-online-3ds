const BUNDLE_IDENTIFIER = "com.emeraldonline3ds.mobile";
const SOURCE_IDENTIFIER = "com.emeraldonline3ds.sidestore";

export function createSideStoreSource({
  publicBase,
  version,
  releasedAt,
  releaseSummary,
  ipaSize = null,
}) {
  const sourceURL = `${publicBase}/sidecommunity.json`;
  const source = {
    name: "Emerald Online 3DS",
    identifier: SOURCE_IDENTIFIER,
    sourceURL,
    apps: [],
    news: [],
  };

  if (!Number.isSafeInteger(ipaSize) || ipaSize <= 0) return source;

  const downloadURL = `${publicBase}/download/ios`;
  source.apps.push({
    name: "Emerald Online 3DS",
    bundleIdentifier: BUNDLE_IDENTIFIER,
    developerName: "Emerald Online 3DS",
    subtitle: "Single-game Emerald Online launcher for iOS.",
    localizedDescription:
      "Play a legally obtained supported Pokémon Emerald cartridge dump through the dedicated Emerald Online 3DS launcher. The app includes no ROM, save, Nintendo system file, game library, or general-purpose emulator browser. Your imported ROM and save remain in the iOS app sandbox.",
    iconURL: `${publicBase}/favicon.png`,
    tintColor: "#087f55",
    permissions: [
      {
        type: "network",
        usageDescription:
          "Connects to the public Emerald Online 3DS multiplayer and release services.",
      },
    ],
    versions: [
      {
        version,
        date: releasedAt,
        downloadURL,
        localizedDescription: releaseSummary,
        size: ipaSize,
        minOSVersion: "15.0",
      },
    ],
  });
  source.news.push({
    title: `Emerald Online 3DS ${version} for iOS`,
    identifier: `emerald-online-3ds-ios-${version}`,
    caption:
      "The dedicated, ROM-free iOS launcher is available for SideStore installation.",
    date: releasedAt,
    appID: BUNDLE_IDENTIFIER,
    tintColor: "#087f55",
    imageURL: `${publicBase}/logo.png`,
    notify: false,
  });
  return source;
}

export const sideStoreIdentifiers = Object.freeze({
  bundle: BUNDLE_IDENTIFIER,
  source: SOURCE_IDENTIFIER,
});
