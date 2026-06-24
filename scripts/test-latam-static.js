// One-off, manually-run snapshot (not part of the recurring build) that
// confirms which categorized LG/TCL channels actually play from a Latin
// America vantage point - run wherever this script happens to execute (a
// non-US IP), not from the US-based GitHub Actions runner. Existing checks
// (build.js's Amagi/check-host.net pass) only detect what's geolocked OUT;
// this records the positive confirmation instead: channels seen live from
// here. Re-run by hand and commit the two output files whenever a fresh
// snapshot is wanted - it intentionally doesn't auto-update.
import fs from "node:fs/promises";
import path from "node:path";
import { fetchFastChannels } from "./fastchannels.js";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1");
const STATIC_DIR = path.join(ROOT, "static");

function toEntry(channel) {
  return {
    id: channel.id,
    name: channel.name,
    provider: channel.provider,
    category: channel.category,
    url: channel.url,
    logo: channel.logo,
  };
}

async function main() {
  const channels = await fetchFastChannels();
  const lgTcl = channels.filter((c) => (c.provider === "lg" || c.provider === "tcl") && c.category);
  const movies = lgTcl.filter((c) => c.category === "Movies Eng");
  const rest = lgTcl.filter((c) => c.category !== "Movies Eng");

  await fs.mkdir(STATIC_DIR, { recursive: true });

  const meta = { label: "Latin Geo", tested_at: new Date().toISOString() };
  await fs.writeFile(
    path.join(STATIC_DIR, "static-us-movie-tested.json"),
    JSON.stringify({ ...meta, channels: movies.map(toEntry) }, null, 2)
  );
  await fs.writeFile(
    path.join(STATIC_DIR, "static-us-tested.json"),
    JSON.stringify({ ...meta, channels: rest.map(toEntry) }, null, 2)
  );

  console.log(`Wrote static/static-us-movie-tested.json (${movies.length} channels).`);
  console.log(`Wrote static/static-us-tested.json (${rest.length} channels).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
