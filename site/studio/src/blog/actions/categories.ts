"use server";

// See actions/posts.ts for the rule every export here follows.
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/admin";
import * as core from "../categories";
import { toResult } from "../result";

export async function upsertCategory(input: unknown) {
  const { email } = await requireAdmin();
  return toResult(() => core.upsertCategory(db(), input, email));
}

export async function deleteCategory(id: string) {
  const { email } = await requireAdmin();
  return toResult(() => core.deleteCategory(db(), id, email));
}
