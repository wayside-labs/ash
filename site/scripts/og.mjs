// Renders public/og.png (1200x630) from the hero copy with the same tokens as the site.
// Run once after copy changes: `node scripts/og.mjs`. Needs `pnpm exec playwright install chromium`.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { en } from "../src/content/copy.en.ts";

const file = (p) => path.resolve("node_modules/@fontsource", p);
const display = file("chakra-petch/files/chakra-petch-latin-700-normal.woff2");
const mono = file("ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2");
const robot = path.resolve("src/assets/mascot/body-753.webp");
const toUrl = (p) => "file:///" + p.replace(/\\/g, "/");

// The title is split where the hero splits it: the sentence after the first full stop is the
// green one. Values are tokens.css's (--bg, --ink, --settle, --muted, --glow-title).
const cut = en.hero.title.indexOf(". ");
const [lead, punch] = cut < 0 ? [en.hero.title, ""] : [en.hero.title.slice(0, cut + 1), en.hero.title.slice(cut + 2)];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: D; src: url("${toUrl(display)}") format("woff2"); font-weight: 700; }
@font-face { font-family: M; src: url("${toUrl(mono)}") format("woff2"); font-weight: 400; }
html, body { margin: 0; width: 1200px; height: 630px; background: #070908; color: #e6ebe7; overflow: hidden; }
body { background: radial-gradient(ellipse 50% 70% at 82% 50%, rgb(61 255 110 / .09), transparent 70%), #070908; }
.text { position: absolute; left: 72px; top: 64px; bottom: 60px; width: 700px; display: flex; flex-direction: column; justify-content: space-between; }
.eyebrow, .foot { font-family: M, monospace; font-size: 20px; letter-spacing: .08em; text-transform: uppercase; }
.eyebrow { color: #3dff6e; display: flex; align-items: center; gap: 14px; }
.eyebrow::before { content: ""; width: 12px; height: 12px; background: #3dff6e; }
h1 { margin: 0; font-family: D, sans-serif; font-weight: 700; font-size: 68px; line-height: 1.02; }
h1 span { display: block; color: #3dff6e; text-shadow: 0 0 28px rgb(61 255 110 / .45); }
.foot { color: #a8b3ac; }
/* Same treatment as the hero: mirrored so it looks at the words, black backdrop melted away. */
.robot { position: absolute; right: 24px; top: 30px; width: 456px; height: 570px; object-fit: cover; transform: scaleX(-1); mix-blend-mode: lighten;
  -webkit-mask-image: radial-gradient(ellipse 50% 50% at 50% 48%, #000 50%, transparent 97%); }
</style></head><body>
<img class="robot" src="${toUrl(robot)}" alt="">
<div class="text">
<div class="eyebrow">${en.hero.eyebrow}</div>
<h1>${lead}${punch ? ` <span>${punch}</span>` : ""}</h1>
<div class="foot">ash.app.br · devnet only, unaudited</div>
</div></body></html>`;

const tmp = path.resolve("dist/_og.html");
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(toUrl(tmp));
await page.evaluate(() => document.fonts.ready);
await page.locator(".robot").evaluate((img) => img.decode());
await page.screenshot({ path: "public/og.png", type: "png" });
await browser.close();
fs.unlinkSync(tmp);
console.log("public/og.png written");
