"use server";

// See actions/posts.ts for the rule every export here follows.
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/admin";
import { toResult } from "../result";
import * as core from "../status";

export async function setPostStatus(input: unknown) {
  const { email } = await requireAdmin();
  return toResult(() => core.setPostStatus(db(), input, email));
}

export async function rejectPost(input: unknown) {
  const { email } = await requireAdmin();
  return toResult(() => core.rejectPost(db(), input, email));
}
