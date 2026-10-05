import type { Channel } from "./interest-handler";

// Turns build-time settings into the contact links of the site. A value is used only when it
// looks real: an empty or placeholder value hides the channel instead of shipping a dead link
// (29/09: a placeholder from .env.example went live on every button). Every button and every
// printed address on the site goes through here; no component reads PUBLIC_BOOKING_URL or
// PUBLIC_CONTACT_EMAIL and uses it as it came.
export interface ContactConfig { booking: string; whatsapp: string; email: string }
export interface ContactLink { channel: Channel; href: string }

const PLACEHOLDER = /exemplo|example\.(com|org|net)/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The booking page's address, or null: https only, no spaces, not a placeholder.
export function bookingUrl(raw: string | undefined): string | null {
  const booking = (raw ?? "").trim();
  return /^https:\/\/\S+$/.test(booking) && !PLACEHOLDER.test(booking) ? booking : null;
}

// The contact address, or null.
export function contactEmail(raw: string | undefined): string | null {
  const email = (raw ?? "").trim();
  return EMAIL.test(email) && !PLACEHOLDER.test(email) ? email : null;
}

export function contactLinks(c: ContactConfig, t: { whatsappText: string; emailSubject: string }): ContactLink[] {
  const out: ContactLink[] = [];
  const booking = bookingUrl(c.booking);
  if (booking) out.push({ channel: "booking", href: booking });
  const digits = c.whatsapp.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 15) {
    out.push({ channel: "whatsapp", href: `https://wa.me/${digits}?text=${encodeURIComponent(t.whatsappText)}` });
  }
  const email = contactEmail(c.email);
  if (email) out.push({ channel: "email", href: `mailto:${email}?subject=${encodeURIComponent(t.emailSubject)}` });
  return out;
}
