// One-off, manually-run snapshot (not part of the recurring build) that
// confirms which categorized LG/TCL/Rakuten channels actually play from a
// Latin America vantage point - run wherever this script happens to execute
// (a non-US IP), not from the US-based GitHub Actions runner. Existing
// checks (build.js's Amagi hostname pass) only detect what's geolocked OUT;
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
  // LG/TCL's whole catalog is inherently US-based, so every categorized
  // channel from them is a fair USA-geolock candidate. Rakuten TV España is
  // Spain-market content otherwise - only its Amagi-hosted channels (a small
  // subset shared with US-distributed feeds, e.g. its "Deportes" Canela.TV/
  // ITV Deportes channels) are even plausibly USA-geolocked, so the rest of
  // its Spain catalog is deliberately excluded here (failing from a Panama
  // test there would just mean Spain/EU geofencing, unrelated to "USA").
  const channels = await fetchFastChannels();
  const candidates = channels.filter(
    (c) =>
      c.category &&
      (c.provider === "lg" || c.provider === "tcl" || (c.provider === "rakuten" && /amagi\.tv/i.test(c.url)))
  );
  const movies = candidates.filter((c) => c.category === "Movies Eng");
  const rest = candidates.filter((c) => c.category !== "Movies Eng");

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
