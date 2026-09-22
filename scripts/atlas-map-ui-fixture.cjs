// Synthetic map UI fixture: local database, no platform accounts or model credentials.
const { buildSync } = require("esbuild"),
  fs = require("fs"),
  os = require("os"),
  path = require("path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-map-ui-"));
process.env.ATLAS_DATA_ROOT = path.join(root, "data");
const bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents:
      ["atlas-store", "atlas-server", "atlas-policy"]
        .map((n) => `export * from './packages/ui/src/main/features/${n}'`)
        .join("\n") + "\nexport * from './packages/ui/src/common/career'",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
const a = require(bundle),
  state = a.emptyCareerState();
state.profile.preferredCities = ["上海"];
state.profile.targetRoles = ["产品经理"];
state.opportunities = [
  ["上海", "上海市徐汇区漕溪北路", "已沟通"],
  ["上海", "上海市浦东新区张江路", "计划联系"],
  ["北京", "北京市海淀区中关村", "面试中"],
  ["上海", "上海市徐汇区", "Offer"],
  ["", "", "待评估"],
].map(([city, address, stage], i) => ({
  id: "map-" + i,
  stage,
  nextDate: "",
  note: "",
  job: {
    companyName: [
      "青禾科技",
      "远舟产品",
      "京城软件",
      "星辰平台",
      "地址待核实企业",
    ][i],
    jobName: "产品经理",
    description: "负责产品规划与需求分析。".repeat(10),
    cityName: city,
    address,
    salaryLow: 40,
    salaryHigh: 60,
  },
  createdAt: new Date().toISOString(),
}));
a.validateCareerState(state);
a.atlasWrite("career-workspace.json", state);
a.atlasWrite("career-dashboard.json", {
  version: 1,
  overrides: { "manual:map-3": { lat: 31.19, lng: 121.43, crs: "wgs84" } },
});
a.initializePolicy();
a.setAllAutomationPaused(true);
let web = path.resolve("packages/ui/web-dist");
if (process.argv.includes("--offline")) {
  web = path.join(root, "web");
  fs.cpSync(path.resolve("packages/ui/web-dist"), web, { recursive: true });
  for (const file of fs
    .readdirSync(path.join(web, "assets"))
    .filter((n) => n.endsWith(".js"))) {
    const p = path.join(web, "assets", file),
      s = fs.readFileSync(p, "utf8");
    if (s.includes("https://webrd03.is.autonavi.com"))
      fs.writeFileSync(
        p,
        s.replaceAll(
          "https://webrd03.is.autonavi.com",
          "/fixture-missing-tiles",
        ),
      );
  }
}
a.startAtlasServer(web, Number(process.argv[2]) || 5195).then((server) => {
  console.log("Map fixture ready", server.address().port);
  process.on("SIGTERM", () =>
    server.close(() => {
      a.closeAtlas();
      fs.rmSync(root, { recursive: true, force: true });
      process.exit(0);
    }),
  );
});
