// Tiny static server for dist/, used by the Playwright smoke and by scripts/og.mjs.
// No dependencies, no directory listing, index.html fallback for clean URLs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("dist");
const port = Number(process.argv[2] ?? 4321);
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain", ".png": "image/png",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".avif": "image/avif", ".ico": "image/x-icon",
};

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  let file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`dist/ on http://127.0.0.1:${port}`));
