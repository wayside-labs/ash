import {
  CONNECTOR_API_VERSION,
  CONNECTOR_MAX_TOOLS,
  CONNECTOR_PARAM_NAME,
  type ConnectorBundle,
  connectorBundleSchema,
  forbiddenConnectorName,
} from "./connector-bundle.js";

/**
 * Parsed import document → connector bundle. Pure: the caller parses YAML/JSON and splits
 * markdown frontmatter, so this module needs nothing beyond zod and runs in the browser.
 *
 * Mirrors `services/connector-host/src/ash_connector/loaders.py`;
 * `examples/connectors/fixtures/import/*.expected.json` is the output both must produce.
 */

export type ConnectorImportFormat = "bundle" | "openapi" | "markdown";

export interface ConnectorImportResult {
  bundle: ConnectorBundle;
  format: ConnectorImportFormat;
  /** Operations left out, with why — shown to the operator rather than failing the import. */
  skipped: string[];
}

export class ConnectorImportError extends Error {
  constructor(
    message: string,
    /** Recognised but not supported yet (Postman, GraphQL, Swagger 2). */
    readonly unsupported = false,
  ) {
    super(message);
  }
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
const JSON_TYPES = new Set(["string", "integer", "number", "boolean", "array", "object"]);

type Doc = Record<string, unknown>;

function isRecord(value: unknown): value is Doc {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function connectorSlug(text: string, sep = "_"): string {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  const escaped = sep.replace(/[-_]/g, "\\$&");
  let out = spaced
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^${escaped}+|${escaped}+$`, "g"), "");
  if (!out || !/^[a-z]/.test(out)) out = out ? `x${sep}${out}` : "x";
  return out.slice(0, 64).replace(new RegExp(`${escaped}+$`), "");
}

/** Splits `---\n<yaml>\n---\n<body>`. Returns null when there is no frontmatter. */
export function splitFrontmatter(text: string): { frontmatter: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return null;
  return { frontmatter: match[1] ?? "", body: (match[2] ?? "").trim() };
}

export function detectConnectorFormat(filename: string): "json" | "yaml" | "markdown" | "graphql" {
  const lower = filename.toLowerCase();
  if (/\.(graphql|gql)$/.test(lower)) return "graphql";
  if (/\.(md|mdx|markdown)$/.test(lower)) return "markdown";
  if (lower.endsWith(".json")) return "json";
  return "yaml";
}

function parseBundle(data: unknown): ConnectorBundle {
  const parsed = connectorBundleSchema.safeParse(data);
  if (!parsed.success) {
    throw new ConnectorImportError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}

export function importMarkdownConnector(frontmatter: unknown, body: string): ConnectorImportResult {
  if (!isRecord(frontmatter)) throw new ConnectorImportError("frontmatter must be a mapping");
  const data: Doc = { apiVersion: CONNECTOR_API_VERSION, ...frontmatter };
  if (body) data.instructions = body;
  return { bundle: parseBundle(data), format: "markdown", skipped: [] };
}

/** A parsed JSON/YAML document: an OpenAPI 3 description or a bundle. */
export function importConnectorDocument(data: unknown): ConnectorImportResult {
  if (!isRecord(data)) throw new ConnectorImportError("connector file root must be a mapping");
  if ("openapi" in data) return importOpenApi(data);
  if ("swagger" in data) {
    throw new ConnectorImportError("Swagger 2.0 is not supported; convert to OpenAPI 3", true);
  }
  if (isRecord(data.info) && "item" in data) {
    throw new ConnectorImportError("Postman collections are not supported yet", true);
  }
  return { bundle: parseBundle(data), format: "bundle", skipped: [] };
}

function deref(node: unknown, doc: Doc): unknown {
  let current = node;
  for (let hops = 0; isRecord(current) && "$ref" in current; hops += 1) {
    if (hops >= 16) throw new ConnectorImportError("$ref chain too deep");
    const ref = current.$ref;
    // Local refs only: a remote one would mean fetching during import.
    if (typeof ref !== "string" || !ref.startsWith("#/")) {
      throw new ConnectorImportError(`only local $ref is supported, got ${String(ref)}`);
    }
    let target: unknown = doc;
    for (const part of ref.slice(2).split("/"))
      target = isRecord(target) ? target[part] : undefined;
    if (target === undefined) throw new ConnectorImportError(`unresolved $ref ${ref}`);
    current = target;
  }
  return current;
}

function paramSchema(schema: unknown, description: unknown): Doc {
  const out: Doc = {};
  const kind = isRecord(schema) ? schema.type : undefined;
  out.type = typeof kind === "string" && JSON_TYPES.has(kind) ? kind : "string";
  if (isRecord(schema) && Array.isArray(schema.enum)) out.enum = schema.enum;
  if (typeof description === "string" && description) out.description = description;
  return out;
}

function securityHeaders(doc: Doc, env: Record<string, string>): Record<string, string> {
  const components = isRecord(doc.components) ? doc.components : {};
  const schemes = isRecord(components.securitySchemes) ? components.securitySchemes : {};
  for (const [schemeName, raw] of Object.entries(schemes)) {
    const scheme = deref(raw, doc);
    if (!isRecord(scheme)) continue;
    const variable = `${connectorSlug(schemeName).toUpperCase()}_TOKEN`;
    if (scheme.type === "apiKey" && scheme.in === "header" && typeof scheme.name === "string") {
      env[variable] = "";
      return { [scheme.name]: `{{ENV:${variable}}}` };
    }
    if (scheme.type === "http" && String(scheme.scheme ?? "").toLowerCase() === "bearer") {
      env[variable] = "";
      return { Authorization: `Bearer {{ENV:${variable}}}` };
    }
  }
  return {};
}

export function importOpenApi(doc: Doc): ConnectorImportResult {
  if (!String(doc.openapi ?? "").startsWith("3.")) {
    throw new ConnectorImportError("only OpenAPI 3.x is supported", true);
  }
  const info = isRecord(doc.info) ? doc.info : {};
  const servers = Array.isArray(doc.servers) ? doc.servers : [];
  const first = servers[0];
  const baseUrl = isRecord(first) && typeof first.url === "string" ? first.url : "";
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new ConnectorImportError("OpenAPI document needs an absolute servers[0].url");
  }

  const env: Record<string, string> = {};
  const headers = securityHeaders(doc, env);
  const tools: Doc[] = [];
  const skipped: string[] = [];
  const paths = isRecord(doc.paths) ? doc.paths : {};

  for (const [path, rawItem] of Object.entries(paths)) {
    const item = deref(rawItem, doc);
    if (!isRecord(item)) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!isRecord(op)) continue;
      const name = connectorSlug(String(op.operationId ?? `${method}_${path}`));
      const term = forbiddenConnectorName(name);
      if (term) {
        skipped.push(`${name}: forbidden term '${term}'`);
        continue;
      }
      if (tools.length >= CONNECTOR_MAX_TOOLS) {
        skipped.push(`${name}: bundle is limited to ${CONNECTOR_MAX_TOOLS} tools`);
        continue;
      }

      const properties: Record<string, Doc> = {};
      const required: string[] = [];
      let hasQuery = false;
      let bad: string | null = null;
      const own = Array.isArray(op.parameters) ? op.parameters : [];
      for (const raw of [...shared, ...own]) {
        const param = deref(raw, doc);
        if (!isRecord(param)) continue;
        const where = param.in;
        const pname = String(param.name ?? "");
        if (where !== "path" && where !== "query") continue;
        if (!CONNECTOR_PARAM_NAME.test(pname)) {
          bad = `parameter '${pname}' is not a valid identifier`;
          break;
        }
        hasQuery ||= where === "query";
        properties[pname] = paramSchema(deref(param.schema, doc), param.description);
        if (param.required || where === "path") required.push(pname);
      }
      if (bad) {
        skipped.push(`${name}: ${bad}`);
        continue;
      }

      let argumentsIn: "body" | null = null;
      const requestBody = op.requestBody ? deref(op.requestBody, doc) : null;
      const content =
        isRecord(requestBody) && isRecord(requestBody.content) ? requestBody.content : {};
      const jsonBody = content["application/json"];
      if (isRecord(jsonBody)) {
        if (hasQuery) {
          skipped.push(`${name}: mixes query parameters with a JSON body`);
          continue;
        }
        const schema = deref(jsonBody.schema ?? {}, doc);
        const props = isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
        for (const [pname, pschema] of Object.entries(props)) {
          if (!CONNECTOR_PARAM_NAME.test(pname)) {
            bad = `body field '${pname}' is not a valid identifier`;
            break;
          }
          const resolved = deref(pschema, doc);
          properties[pname] = paramSchema(
            resolved,
            isRecord(resolved) ? resolved.description : null,
          );
        }
        if (bad) {
          skipped.push(`${name}: ${bad}`);
          continue;
        }
        const req = isRecord(schema) && Array.isArray(schema.required) ? schema.required : [];
        required.push(...req.filter((r): r is string => typeof r === "string" && r in properties));
        argumentsIn = "body";
      }

      const tool: Doc = {
        name,
        description: String(op.summary ?? op.description ?? "").slice(0, 1024),
        method: method.toUpperCase(),
        url: path,
        parameters: { type: "object", properties, required },
      };
      if (Object.keys(headers).length > 0) tool.headers = { ...headers };
      if (argumentsIn) tool.argumentsIn = argumentsIn;
      tools.push(tool);
    }
  }

  if (tools.length === 0) {
    throw new ConnectorImportError("OpenAPI document yielded no importable operations");
  }
  const bundle = parseBundle({
    apiVersion: CONNECTOR_API_VERSION,
    name: connectorSlug(String(info.title ?? "openapi"), "-"),
    description: String(info.description ?? info.title ?? "").slice(0, 2048),
    baseUrl: baseUrl.replace(/\/+$/, ""),
    env,
    tools,
  });
  return { bundle, format: "openapi", skipped };
}
