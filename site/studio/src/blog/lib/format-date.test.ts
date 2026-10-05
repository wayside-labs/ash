import { formatDate, formatDateTime, zoneLabel } from "./format-date";

const SP = "America/Sao_Paulo";

describe("formatDateTime", () => {
  const cases: [string, string, string, string][] = [
    ["meio-dia UTC em São Paulo", "2026-10-05T12:30:00.000Z", SP, "05/10/2026 09:30"],
    // The day itself changes with the zone: 01:00 UTC is still the day before in São Paulo.
    ["virada do dia", "2026-10-05T01:00:00.000Z", SP, "04/10/2026 22:00"],
    ["virada do ano", "2027-01-01T02:59:00.000Z", SP, "31/12/2026 23:59"],
    ["meia-noite é 00, não 24", "2026-10-05T03:00:00.000Z", SP, "05/10/2026 00:00"],
    ["o mesmo instante em UTC", "2026-10-05T12:30:00.000Z", "UTC", "05/10/2026 12:30"],
    ["fuso com horário de verão, no inverno", "2026-01-15T17:00:00.000Z", "America/New_York", "15/01/2026 12:00"],
    ["fuso com horário de verão, no verão", "2026-07-15T17:00:00.000Z", "America/New_York", "15/07/2026 13:00"],
    ["fuso de meia hora", "2026-10-05T12:00:00.000Z", "Asia/Kolkata", "05/10/2026 17:30"],
    ["segundos e milissegundos são descartados", "2026-10-05T12:30:59.999Z", SP, "05/10/2026 09:30"],
  ];
  for (const [label, iso, tz, expected] of cases) {
    it(label, () => {
      expect(formatDateTime(iso, tz)).toBe(expected);
    });
  }

  it("sem data, ou com uma data que não é data, devolve vazio", () => {
    expect(formatDateTime(null, SP)).toBe("");
    expect(formatDateTime("", SP)).toBe("");
    expect(formatDateTime("ontem", SP)).toBe("");
    expect(formatDate(null, SP)).toBe("");
  });

  it("não depende do fuso da máquina", () => {
    const before = process.env.TZ;
    try {
      for (const machine of ["Asia/Tokyo", "America/Los_Angeles", "UTC"]) {
        process.env.TZ = machine;
        expect(formatDateTime("2026-10-05T12:30:00.000Z", SP), machine).toBe("05/10/2026 09:30");
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("fuso que não existe é erro de configuração, não uma data errada", () => {
    expect(() => formatDateTime("2026-10-05T12:30:00.000Z", "Marte/Olympus")).toThrow(RangeError);
  });
});

describe("formatDate", () => {
  it("só o dia, no fuso pedido", () => {
    expect(formatDate("2026-10-05T01:00:00.000Z", SP)).toBe("04/10/2026");
    expect(formatDate("2026-10-05T01:00:00.000Z", "UTC")).toBe("05/10/2026");
  });
});

describe("zoneLabel", () => {
  it("escreve o fuso por extenso, com o nome IANA ao lado", () => {
    const label = zoneLabel(SP);
    expect(label).toContain("Brasília");
    expect(label).toContain("(America/Sao_Paulo)");
  });

  it("vale para qualquer fuso que o Intl conheça", () => {
    expect(zoneLabel("UTC")).toContain("(UTC)");
    expect(zoneLabel("Europe/Lisbon")).toContain("(Europe/Lisbon)");
  });
});
