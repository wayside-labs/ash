import {
  ConnectorImportError,
  type ConnectorImportResult,
  detectConnectorFormat,
  importConnectorDocument,
  importMarkdownConnector,
  splitFrontmatter,
} from "@agent-rails/contract/connector-import";
import { parse as parseYaml } from "yaml";

/** Larger than any real OpenAPI subset worth mounting, small enough to parse inline. */
export const CONNECTOR_FILE_MAX_BYTES = 512 * 1024;

/**
 * An uploaded connector file → bundle. YAML is parsed with the `core` schema and no custom
 * tags, so a file cannot construct anything but plain data.
 */
export function parseConnectorFile(filename: string, content: string): ConnectorImportResult {
  const format = detectConnectorFormat(filename);
  if (format === "graphql") {
    throw new ConnectorImportError("GraphQL import is not supported yet", true);
  }
  try {
    if (format === "markdown") {
      const split = splitFrontmatter(content);
      if (!split) throw new ConnectorImportError("markdown connector needs YAML frontmatter");
      return importMarkdownConnector(parseYaml(split.frontmatter, { schema: "core" }), split.body);
    }
    const data = format === "json" ? JSON.parse(content) : parseYaml(content, { schema: "core" });
    return importConnectorDocument(data);
  } catch (error) {
    if (error instanceof ConnectorImportError) throw error;
    throw new ConnectorImportError(
      `could not parse ${filename}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
