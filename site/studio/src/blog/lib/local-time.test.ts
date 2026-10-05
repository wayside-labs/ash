import { DEFAULT_TZ, isoToLocal, localToIso } from "./local-time";

describe("localToIso", () => {
  it("o padrão é o horário de São Paulo (UTC-3)", () => {
    expect(DEFAULT_TZ).toBe("America/Sao_Paulo");
    expect(localToIso("2026-10-05T09:30")).toBe("2026-10-05T12:30:00.000Z");
  });

  it("aceita segundos, que o input manda quando tem step", () => {
    expect(localToIso("2026-10-05T09:30:15")).toBe("2026-10-05T12:30:15.000Z");
  });

  it("meia-noite e virada de dia, mês e ano", () => {
    expect(localToIso("2026-10-05T00:00")).toBe("2026-10-05T03:00:00.000Z");
    expect(localToIso("2026-12-31T23:30")).toBe("2027-01-01T02:30:00.000Z");
    expect(localToIso("2028-02-29T21:00")).toBe("2028-03-01T00:00:00.000Z");
  });

  it("usa o fuso pedido, com o horário de verão dele", () => {
    expect(localToIso("2026-01-15T09:00", "America/New_York")).toBe("2026-01-15T14:00:00.000Z");
    expect(localToIso("2026-07-15T09:00", "America/New_York")).toBe("2026-07-15T13:00:00.000Z");
    expect(localToIso("2026-07-15T09:00", "UTC")).toBe("2026-07-15T09:00:00.000Z");
    expect(localToIso("2026-07-15T09:00", "Asia/Kolkata")).toBe("2026-07-15T03:30:00.000Z");
  });

  it("usa o deslocamento da data pedida, não o de hoje", () => {
    // São Paulo still had daylight saving time in 2018 (UTC-2 in December).
    expect(localToIso("2018-12-01T12:00")).toBe("2018-12-01T14:00:00.000Z");
  });

  it("não depende do fuso da máquina", () => {
    const before = process.env.TZ;
    try {
      for (const tz of ["Asia/Tokyo", "America/Los_Angeles", "UTC"]) {
        process.env.TZ = tz;
        expect(localToIso("2026-10-05T09:30"), tz).toBe("2026-10-05T12:30:00.000Z");
        expect(isoToLocal("2026-10-05T12:30:00.000Z"), tz).toBe("2026-10-05T09:30");
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("hora que não existe (salto do horário de verão) é recusada", () => {
    // In New York the clocks jump from 02:00 to 03:00 on 2026-03-08.
    expect(localToIso("2026-03-08T02:30", "America/New_York")).toBeNull();
    expect(localToIso("2026-03-08T03:00", "America/New_York")).toBe("2026-03-08T07:00:00.000Z");
    expect(localToIso("2026-03-08T01:59", "America/New_York")).toBe("2026-03-08T06:59:00.000Z");
  });

  it("hora que acontece duas vezes fica com a primeira", () => {
    // 2026-11-01 01:30 happens in EDT (05:30Z) and again in EST (06:30Z).
    expect(localToIso("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });

  it("recusa o que não é um datetime-local", () => {
    for (const value of [
      "",
      "2026-10-05",
      "09:30",
      "2026-10-05 09:30",
      "2026-10-05T09:30Z",
      "2026-10-05T09:30-03:00",
      "2026-10-05T9:30",
      "05/10/2026 09:30",
      "2026-10-05T09:30:00.000",
      " 2026-10-05T09:30",
    ]) {
      expect(localToIso(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("recusa data ou hora que não existe no calendário", () => {
    for (const value of [
      "2026-13-01T00:00",
      "2026-00-10T00:00",
      "2026-02-30T10:00",
      "2027-02-29T10:00",
      "2026-04-31T10:00",
      "2026-10-05T24:00",
      "2026-10-05T23:60",
      "2026-10-05T23:59:60",
    ]) {
      expect(localToIso(value), value).toBeNull();
    }
  });

  it("fuso inválido é erro de configuração, não entrada ruim", () => {
    expect(() => localToIso("2026-10-05T09:30", "Marte/Olympus")).toThrow(RangeError);
  });
});

describe("isoToLocal", () => {
  it("devolve o formato do datetime-local, no fuso padrão", () => {
    expect(isoToLocal("2026-10-05T12:30:00.000Z")).toBe("2026-10-05T09:30");
  });

  it("aceita Date, que é como o Drizzle devolve a coluna", () => {
    expect(isoToLocal(new Date("2027-01-01T02:30:00.000Z"))).toBe("2026-12-31T23:30");
  });

  it("meia-noite sai como 00:00, nunca 24:00", () => {
    expect(isoToLocal("2026-10-05T03:00:00.000Z")).toBe("2026-10-05T00:00");
  });

  it("usa o fuso pedido", () => {
    expect(isoToLocal("2026-07-15T13:00:00.000Z", "America/New_York")).toBe("2026-07-15T09:00");
    expect(isoToLocal("2026-07-15T13:00:00.000Z", "UTC")).toBe("2026-07-15T13:00");
  });

  it("descarta os segundos", () => {
    expect(isoToLocal("2026-10-05T12:30:59.999Z")).toBe("2026-10-05T09:30");
  });

  it("é o inverso do localToIso", () => {
    for (const tz of ["America/Sao_Paulo", "America/New_York", "Europe/Lisbon", "Asia/Kolkata"]) {
      for (const local of ["2026-01-01T00:00", "2026-06-15T12:34", "2026-12-31T23:59"]) {
        const iso = localToIso(local, tz);
        expect(iso, `${local} ${tz}`).not.toBeNull();
        expect(isoToLocal(iso as string, tz), `${local} ${tz}`).toBe(local);
      }
    }
  });

  it("aceita instante com deslocamento explícito", () => {
    expect(isoToLocal("2026-10-05T09:30:00-03:00")).toBe("2026-10-05T09:30");
    expect(isoToLocal("2026-10-05T12:30Z")).toBe("2026-10-05T09:30");
    expect(isoToLocal("2026-10-05T14:30:00.5+02:00")).toBe("2026-10-05T09:30");
  });

  it("data pura não é um instante: new Date() a leria como meia-noite UTC", () => {
    expect(() => isoToLocal("2026-10-05")).toThrow(RangeError);
  });

  it("data e hora sem fuso não é um instante: new Date() usaria o fuso da máquina", () => {
    for (const value of ["2026-10-05T09:30", "2026-10-05T09:30:00", "2026-10-05 09:30:00Z", ""]) {
      expect(() => isoToLocal(value), JSON.stringify(value)).toThrow(RangeError);
    }
  });

  it("instante impossível estoura em vez de rolar para o dia seguinte", () => {
    for (const value of [
      "2026-02-30T10:00:00Z",
      "2027-02-29T10:00:00Z",
      "2026-04-31T10:00:00Z",
      "2026-10-05T24:00:00Z",
      "2026-10-05T23:60:00Z",
      "2026-10-05T23:59:60Z",
      "2026-00-10T10:00:00Z",
      "2026-10-00T10:00:00Z",
      "2026-10-05T10:00:00+24:00",
      "2026-10-05T10:00:00+02:60",
    ]) {
      expect(() => isoToLocal(value), value).toThrow(RangeError);
    }
    expect(isoToLocal("2028-02-29T12:00:00Z")).toBe("2028-02-29T09:00");
    expect(isoToLocal("2026-10-05T23:59:59.999+14:00")).toBe("2026-10-05T06:59");
  });

  it("instante inválido estoura em vez de devolver lixo", () => {
    expect(() => isoToLocal("2026-13-45T99:99:00Z")).toThrow(RangeError);
    expect(() => isoToLocal("ontem")).toThrow(RangeError);
    expect(() => isoToLocal(new Date(Number.NaN))).toThrow(RangeError);
  });
});
