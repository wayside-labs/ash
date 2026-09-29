-- Plan phase 3: the knowledge base. Document rows gain their indexing outcome; chunks live
-- in their own table, written by the server under the service role after extraction.

alter table public.rag_documents
  add column if not exists error text,
  add column if not exists chunk_count integer not null default 0,
  add column if not exists mode text check (mode is null or mode in ('vector', 'lexical')),
  add column if not exists bytes integer not null default 0,
  add column if not exists indexed_at timestamptz;

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  doc_id uuid not null references public.rag_documents (id) on delete cascade,
  idx integer not null,
  text text not null,
  -- Voyage embeddings when configured; null for lexically indexed documents. Scored in the
  -- application (see lib/server/knowledge), so a plain array is enough — no pgvector needed.
  embedding real[],
  unique (doc_id, idx)
);

create index knowledge_chunks_org_doc_idx on public.knowledge_chunks (org_id, doc_id);

alter table public.knowledge_chunks enable row level security;

-- Readable by members; written only by the server (service role) after extraction.
create policy knowledge_chunks_org_read on public.knowledge_chunks
  for select using (
    org_id in (
      select org_id from public.memberships
      where account_id in (
        select account_id from public.identities where auth_user_id = (select auth.uid())
      )
    )
  );
