import { eq } from "drizzle-orm";
import { auditLog } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { describeDb, freshDb } from "./helpers/db";

describeDb("logAudit", () => {
  it("grava evento, autor e payload", async () => {
    const { db, close } = await freshDb();
    try {
      const id = await logAudit(db, {
        event: "post.published",
        actor: "lucas@example.com",
        payload: { slug: "a" },
      });
      const [row] = await db.select().from(auditLog).where(eq(auditLog.id, id));
      expect(row).toMatchObject({
        event: "post.published",
        actor: "lucas@example.com",
        payload: { slug: "a" },
      });
    } finally {
      await close();
    }
  });
});
