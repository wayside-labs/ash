import { describe, it, expect } from "vitest";
import { bookingUrl, contactEmail, contactLinks } from "../../src/lib/contact";

const texts = { whatsappText: "Hi, I saw the Ash pitch.", emailSubject: "Ash — after the pitch" };

describe("contactLinks", () => {
  it("builds the three channels in a fixed order", () => {
    const links = contactLinks({ booking: "https://cal.com/ash/20min", whatsapp: "+55 (11) 90000-0000", email: "oi@ash.app.br" }, texts);
    expect(links).toEqual([
      { channel: "booking", href: "https://cal.com/ash/20min" },
      { channel: "whatsapp", href: "https://wa.me/5511900000000?text=Hi%2C%20I%20saw%20the%20Ash%20pitch." },
      { channel: "email", href: "mailto:oi@ash.app.br?subject=Ash%20%E2%80%94%20after%20the%20pitch" },
    ]);
  });
  it("leaves out anything empty or malformed", () => {
    expect(contactLinks({ booking: "", whatsapp: "123", email: "nope" }, texts)).toEqual([]);
    expect(contactLinks({ booking: "http://cal.com/x", whatsapp: "", email: "" }, texts)).toEqual([]);
  });
  // 29/09: a placeholder from .env.example went live on every button. Never again.
  it("refuses placeholder values", () => {
    expect(contactLinks({ booking: "https://cal.com/exemplo/20min", whatsapp: "", email: "contato@example.com" }, texts)).toEqual([]);
  });
});

// What the home's buttons and its printed address use: one value at a time, same rules.
describe("bookingUrl and contactEmail", () => {
  it("return the value when it is real, trimmed", () => {
    expect(bookingUrl(" https://cal.com/ash/20min ")).toBe("https://cal.com/ash/20min");
    expect(contactEmail(" oi@ash.app.br ")).toBe("oi@ash.app.br");
  });
  it.each(["", "   ", undefined, "http://cal.com/x", "cal.com/x", "https://cal.com/exemplo/20min", "https://example.com/book", "https://cal.com/a b", "javascript:alert(1)"])(
    "bookingUrl refuses %j", (value) => {
      expect(bookingUrl(value)).toBeNull();
    });
  it.each(["", undefined, "nope", "a@b", "contato@example.com", "seu-email@exemplo.com.br", "a b@c.de"])("contactEmail refuses %j", (value) => {
    expect(contactEmail(value)).toBeNull();
  });
});
