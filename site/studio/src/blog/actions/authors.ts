"use server";

// See actions/posts.ts for the rule every export here follows.
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/admin";
import * as core from "../authors";
import { toResult } from "../result";

export async function upsertAuthor(input: unknown) {
  const { email } = await requireAdmin();
  return toResult(() => core.upsertAuthor(db(), input, email));
}

export async function deleteAuthor(id: string) {
  const { email } = await requireAdmin();
  return toResult(() => core.deleteAuthor(db(), id, email));
}
