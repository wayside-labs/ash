import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Pinned so the build never adopts a parent directory's lockfile as workspace root (ash-web has
// its own): standalone output must be .next/standalone/server.js, as the Dockerfile expects.
const root = fileURLToPath(new URL(".", import.meta.url));

// standalone: the VPS image carries only the traced server, not node_modules.
// unoptimized: we serve our own /media, and the _next/image endpoint would be one more surface.
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  images: { unoptimized: true },
  outputFileTracingRoot: root,
  turbopack: { root },
  // The proxy buffers every request body in memory before the route sees it, on the public host
  // too, up to 10 MB by default. The largest body any route accepts is one image of 5 MB plus the
  // multipart envelope (MAX_IMAGE_BYTES in src/blog/lib/image-rules.ts); beyond the limit the
  // body is cut and the upload route answers 400.
  //
  // Saving a post is a server action, and an action's own limit is 1 MB by default. The body may
  // be 300 000 characters (MAX_BODY_HTML_LENGTH), which is up to 900 kB in UTF-8 before the rest
  // of the document, so a long post in an accented language would be refused by the framework
  // with no readable message. The two limits are independent and both apply: the proxy buffers
  // first, the action checks after, so the action's limit must stay under the proxy's.
  experimental: {
    proxyClientMaxBodySize: "6mb",
    serverActions: { bodySizeLimit: "2mb" },
  },
  // Belt and braces next to the meta robots tag: the admin must never be indexed.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};
export default config;
