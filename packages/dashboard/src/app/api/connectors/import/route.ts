import {
  type ConnectorBundle,
  connectorBundleSchema,
  connectorSecretEnv,
} from "@ash/contract/connector-bundle";
import { ConnectorImportError } from "@ash/contract/connector-import";
import { z } from "zod";
import { connectorMcpRow } from "@/lib/connectors";
import { mcpServerSchema, scopeSchema } from "@/lib/schema";
import { CONNECTOR_FILE_MAX_BYTES, parseConnectorFile } from "@/lib/server/connectors";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { MASKED_ENV_VALUE, maskState } from "@/lib/server/present";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { stateAccessResponse } from "@/lib/server/state/access";
import { mutateState, newId, readState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    /** A file the operator chose: bundle, OpenAPI 3 or markdown-with-frontmatter. */
    file: z
      .object({
        name: z.string().min(1).max(200),
        content: z.string().max(CONNECTOR_FILE_MAX_BYTES),
      })
      .optional(),
    /** A bundle a model proposed (chat fence or canvas generator), already JSON. */
    bundle: z.unknown().optional(),
    scope: scopeSchema.default("global"),
    scopeName: z.string().max(80).nullable().default(null),
    /**
     * A file lands disabled, like an imported skill: it must not change what an agent does
     * until someone scopes it. Chat and canvas pass true — the operator already picked the
     * target when they clicked.
     */
    enabled: z.boolean().default(false),
  })
  .refine((body) => (body.file === undefined) !== (body.bundle === undefined), {
    message: "exactly one of file or bundle",
  });

/**
 * Turns a connector — imported from a file, or proposed by the chat or the canvas generator
 * — into an MCP row served by `services/connector-host`. This is the one write path for all
 * three, so the bundle schema's refusals (governance tool names, reserved env names, key
 * material) hold no matter who wrote the bundle. Nothing here can create a payment tool:
 * the host has no signer and the schema has no field for one.
 */
export async function POST(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const limited = checkFixedWindow("api");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 422 });
  }
  const { file, scope, enabled } = parsed.data;
  const scopeName = scope === "global" ? null : parsed.data.scopeName;
  if (scope !== "global" && !scopeName) {
    return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 422 });
  }

  let bundle: ConnectorBundle;
  let skipped: string[] = [];
  let format = "bundle";
  try {
    if (file) {
      const result = parseConnectorFile(file.name, file.content);
      bundle = result.bundle;
      skipped = result.skipped;
      format = result.format;
    } else {
      const checked = connectorBundleSchema.safeParse(parsed.data.bundle);
      if (!checked.success) {
        throw new ConnectorImportError(checked.error.issues.map((i) => i.message).join("; "));
      }
      bundle = checked.data;
    }
  } catch (error) {
    if (error instanceof ConnectorImportError) {
      return Response.json(
        {
          error: await serverT(
            error.unsupported ? "connectors.error.unsupported" : "connectors.error.invalid",
          ),
          detail: error.message,
        },
        { status: 422 },
      );
    }
    throw error;
  }

  try {
    const state = await readState();
    const exists =
      scope === "workflow"
        ? state.workflows.some((w) => w.name === scopeName)
        : scope === "agent"
          ? state.agents.some((a) => a.name === scopeName)
          : true;
    if (!exists) {
      return Response.json({ error: await serverT("api.error.notFound") }, { status: 404 });
    }

    const row = mcpServerSchema.parse({
      ...connectorMcpRow(bundle, { scope, scopeName, enabled }),
      id: newId("mcp"),
    });
    const { state: next } = await mutateState((draft) => {
      draft.mcps.push(row);
    });
    return Response.json(
      {
        created: {
          ...row,
          env: Object.fromEntries(
            Object.entries(row.env).map(([key, value]) => [key, value ? MASKED_ENV_VALUE : ""]),
          ),
        },
        format,
        skipped,
        // Names the operator still has to fill on the MCP card before the tools authenticate.
        missingEnv: connectorSecretEnv({ ...bundle, env: row.env }),
        state: maskState(next),
      },
      { status: 201 },
    );
  } catch (error) {
    const stateDenied = stateAccessResponse(error);
    if (stateDenied) return stateDenied;
    throw error;
  }
}
