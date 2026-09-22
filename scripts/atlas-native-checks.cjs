// Repeatable integration suite; platform traffic is handled by local Electron protocol fixtures.
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process"),
  { buildSync } = require("esbuild");
const output = path.resolve(process.argv[2] || "artifacts/native-checks");
fs.mkdirSync(output, { recursive: true });
const names = [
  "atlas-boss-browser",
  "atlas-boss-sync",
  "atlas-boss-account-state",
  "atlas-store",
  "atlas-tasks",
  "career-boss-data",
  "atlas-boss-reply",
  "career-auto-reply",
  "career-reply-store",
  "atlas-contact-native",
  "atlas-contact",
  "career-workspace-service",
  "atlas-discovery",
  "atlas-discovery-collector",
  "atlas-profile",
  "atlas-discovery-state",
  "atlas-ai",
  "atlas-policy",
  "atlas-portfolio",
  "atlas-task-queue",
];
const bundle = path.join(output, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: names
      .map((s) => `export * from './packages/ui/src/main/features/${s}'`)
      .concat("export * from './packages/ui/src/common/career'")
      .join("\n"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: bundle,
});
for (const [script, key] of [
  ["atlas-boss-native-check", "ATLAS_BOSS_CHECK_OUTPUT"],
  ["atlas-boss-native-flow-check", "ATLAS_BOSS_CHECK_OUTPUT"],
  ["atlas-contact-native-check", "ATLAS_CONTACT_CHECK_OUTPUT"],
  ["atlas-discovery-native-check", "ATLAS_DISCOVERY_CHECK_OUTPUT"],
]) {
  const fd = fs.openSync(path.join(output, script + ".log"), "w"),
    result = spawnSync(
      require("electron"),
      [
        path.resolve("scripts/" + script + ".cjs"),
        bundle,
        "--ozone-platform=x11",
      ],
      {
        env: { ...process.env, [key]: path.join(output, script + ".json") },
        stdio: ["ignore", fd, fd],
        timeout: 60000,
      },
    );
  fs.closeSync(fd);
  if (result.status !== 0) {
    console.error(script + " failed: " + (result.error?.message || "see log"));
    process.exit(1);
  }
  console.log(script + " passed");
}
