type ToolJsonResult = {
  message?: string;
};

export function toolJsonResult(result: unknown) {
  const payload = result as ToolJsonResult;
  const text =
    typeof payload.message === "string"
      ? `${payload.message}\n\n${JSON.stringify(result, null, 2)}`
      : JSON.stringify(result, null, 2);

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: result as Record<string, unknown>,
  };
}
