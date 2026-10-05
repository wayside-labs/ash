// Reached by the worker bundle (publish-due.ts): nothing imported here may pull in sharp or
// sanitize-html.
import { type SQL, sql } from "drizzle-orm";
import { blogPosts } from "@/db/schema";

// updated_at is the token updatePost compares (see posts.ts), so every write to a post has to
// move it, by a whole millisecond: `now`, unless the row is already there or past it (two writes
// in the same millisecond, a clock that stepped back, a worker whose `now` was read before an
// admin's save), and then one millisecond after the row. Never backwards, never the same value.
//
// This is the one place the rule is written for a SQL UPDATE: status.ts and publish-due.ts both
// set `updatedAt` to it. updatePost keeps the same rule in JavaScript, because it has already
// read and locked the row and needs the new value in hand.
//
// ISO + cast: postgres-js cannot bind a raw Date inside a sql`` template (see jobs/queue.ts).
export function bumpedUpdatedAt(now: Date): SQL {
  return sql`greatest(${now.toISOString()}::timestamptz, date_trunc('milliseconds', ${blogPosts.updatedAt}) + interval '1 millisecond')`;
}
