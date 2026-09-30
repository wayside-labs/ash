import type { VendorId } from "../config.js";
import type { VendorModule } from "../vendor.js";
import { compute } from "./compute.js";
import { notary } from "./notary.js";
import { oracle } from "./oracle.js";

// biome-ignore lint/suspicious/noExplicitAny: each vendor carries its own state shape
export const VENDORS: Record<VendorId, VendorModule<any>> = { oracle, notary, compute };
