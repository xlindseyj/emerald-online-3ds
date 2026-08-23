import test from "node:test";
import assert from "node:assert/strict";
import {
  createSideStoreSource,
  sideStoreIdentifiers,
} from "./sidestore-source.mjs";

test("SideStore source uses the app bundle identifier and exact IPA metadata", () => {
  const source = createSideStoreSource({
    publicBase: "https://emeraldonline3ds.com",
    version: "0.9.0",
    releasedAt: "2026-08-24T00:00:00Z",
    releaseSummary: "Dedicated iOS sideload test build.",
    ipaSize: 42_424_242,
  });
  assert.equal(source.identifier, sideStoreIdentifiers.source);
  assert.equal(
    source.sourceURL,
    "https://emeraldonline3ds.com/source.json",
  );
  assert.equal(source.apps.length, 1);
  const app = source.apps[0];
  assert.equal(app.bundleIdentifier, sideStoreIdentifiers.bundle);
  assert.equal(app.versions.length, 1);
  assert.deepEqual(app.versions[0], {
    version: "0.9.0",
    date: "2026-08-24T00:00:00Z",
    downloadURL: "https://emeraldonline3ds.com/download/ios",
    localizedDescription: "Dedicated iOS sideload test build.",
    size: 42_424_242,
    minOSVersion: "15.0",
  });
  assert.equal(source.news[0].appID, sideStoreIdentifiers.bundle);
});

test("SideStore source stays valid and empty until an IPA is staged", () => {
  const source = createSideStoreSource({
    publicBase: "https://emeraldonline3ds.com",
    version: "0.9.0",
    releasedAt: "2026-08-24T00:00:00Z",
    releaseSummary: "Dedicated iOS sideload test build.",
  });
  assert.deepEqual(source.apps, []);
  assert.deepEqual(source.news, []);
});
