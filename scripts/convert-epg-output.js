// Converts the iptv-org/epg grabber's XMLTV output into the same
// { channelId: [{title, start, stop}] } JSON shape used for Pluto/Tubi EPG.
// Usage: node scripts/convert-epg-output.js <input-xml-path> <output-json-path>

import fs from "node:fs/promises";
import { parseXmltv } from "./lib/xmltv.js";

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error("Usage: node convert-epg-output.js <input-xml-path> <output-json-path>");
  }

  const xml = await fs.readFile(inputPath, "utf8");
  const byChannel = parseXmltv(xml);

  const output = Object.fromEntries(byChannel);
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`Converted EPG for ${byChannel.size} channels -> ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
