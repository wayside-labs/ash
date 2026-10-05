"use server";

// Every export here is a public POST endpoint: each one starts with requireAdmin(), and
// tests/blog-actions.test.ts fails the build if one does not. Reads live in ../posts.ts and are
// called from pages that did their own requireAdmin().
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/admin";
import * as core from "../posts";
import { toResult } from "../result";

export async function createPost(input: unknown) {
  const { email } = await requireAdmin();
  return toResult(() => core.createPost(db(), input, email));
}

export async function updatePost(id: string, input: unknown) {
  const { email } = await requireAdmin();
  return toResult(() => core.updatePost(db(), id, input, email));
}

export async function createTranslation(sourceId: string, input: unknown) {
  const { email } = await requireAdmin();
  return toResult(() => core.createTranslation(db(), sourceId, input, email));
}
