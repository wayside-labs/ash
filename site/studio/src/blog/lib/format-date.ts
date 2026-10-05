// Dates on the admin screens, always in the editorial zone (PUBLISH_TZ, read on the server and
// passed down): the VPS runs in UTC and each admin's browser in its own zone, and neither is the
// clock the schedule was written in. The input is an instant as Date.toISOString writes it; a
// datetime-local value never comes here (that is local-time.ts).

const formatters = new Map<string, Intl.DateTimeFormat>();

// Throws RangeError on an unknown zone, as local-time.ts does: a configuration mistake.
function formatterFor(tz: string): Intl.DateTimeFormat {
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(tz, formatter);
  }
  return formatter;
}

// Assembled from the parts, not taken from format(): the separators Intl writes between date and
// time (a comma, a narrow no-break space) change between ICU versions, and the server and the
// browser must render the same text.
function parts(iso: string | null, tz: string): Record<string, string> | null {
  const formatter = formatterFor(tz);
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(ms)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out;
}

export function formatDateTime(iso: string | null, tz: string): string {
  const p = parts(iso, tz);
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : "";
}

export function formatDate(iso: string | null, tz: string): string {
  const p = parts(iso, tz);
  return p ? `${p.day}/${p.month}/${p.year}` : "";
}

// "Horário de Brasília (America/Sao_Paulo)": the name a person knows and the one the
// configuration uses. Computed on the server and passed down as text, so the browser's own
// naming data never changes it.
export function zoneLabel(tz: string): string {
  const named = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, timeZoneName: "longGeneric" })
    .formatToParts(0)
    .find((part) => part.type === "timeZoneName")?.value;
  return named && named !== tz ? `${named} (${tz})` : `(${tz})`;
}
