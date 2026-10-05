-- "Yes, let's talk" from the end of the investor pitch: when, and through which channel.
ALTER TABLE leads ADD COLUMN interested_at TEXT;
ALTER TABLE leads ADD COLUMN interest_channel TEXT CHECK (interest_channel IN ('booking', 'whatsapp', 'email'));
