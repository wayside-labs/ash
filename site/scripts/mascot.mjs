// Derives every mascot file the site serves from the three masters in src/assets/mascot/source/.
// Run by hand after a master or a size changes (`node scripts/mascot.mjs`) and commit the result:
// the build never calls sharp for these, so what a visitor downloads is exactly what is in git.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SRC = path.resolve("src/assets/mascot/source");
const OUT = path.resolve("src/assets/mascot");
const PUB = path.resolve("public");

// Widths are the CSS size and its 2x. The body is cut to the hero's 4:5 frame first (the page
// shows only that middle slice of the 16:9 picture), so its 2x is the tallest the master allows.
const SETS = [
  { name: "face", widths: [22, 34, 44, 68], avif: 60, webp: 82 },
  { name: "closeup", widths: [388, 700], avif: 52, webp: 76 },
  { name: "body", widths: [480, 753], crop: 4 / 5, avif: 50, webp: 74 },
];

async function master(set) {
  const img = sharp(path.join(SRC, `${set.name}.webp`));
  if (!set.crop) return img;
  const { width, height } = await img.metadata();
  const w = Math.round(height * set.crop);
  return img.extract({ left: Math.round((width - w) / 2), top: 0, width: w, height });
}

let total = 0;
for (const set of SETS) {
  for (const width of set.widths) {
    for (const format of ["avif", "webp"]) {
      const file = path.join(OUT, `${set.name}-${width}.${format}`);
      const img = (await master(set)).resize({ width });
      await (format === "avif" ? img.avif({ quality: set.avif, effort: 9 }) : img.webp({ quality: set.webp, effort: 6 })).toFile(file);
      const bytes = fs.statSync(file).size;
      total += bytes;
      console.log(`${path.basename(file).padEnd(18)} ${String(bytes).padStart(7)} B`);
    }
  }
}
console.log(`${"all variants".padEnd(18)} ${String(total).padStart(7)} B`);

// Favicons, from the face. An .ico may hold a PNG as is: a 6-byte header, one 16-byte entry, the
// file. /favicon.ico is what a browser asks for when a page names no icon.
const face = () => sharp(path.join(SRC, "face.webp"));
const ico = await face().resize(32, 32).png({ compressionLevel: 9, palette: true }).toBuffer();
const head = Buffer.alloc(22);
head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head.writeUInt8(32, 6); head.writeUInt8(32, 7);
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(ico.length, 14); head.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(PUB, "favicon.ico"), Buffer.concat([head, ico]));
await face().resize(96, 96).png({ compressionLevel: 9, palette: true }).toFile(path.join(PUB, "favicon.png"));
await face().resize(180, 180).png({ compressionLevel: 9, palette: true }).toFile(path.join(PUB, "apple-touch-icon.png"));
for (const f of ["favicon.ico", "favicon.png", "apple-touch-icon.png"]) {
  console.log(`${f.padEnd(22)} ${String(fs.statSync(path.join(PUB, f)).size).padStart(7)} B`);
}
