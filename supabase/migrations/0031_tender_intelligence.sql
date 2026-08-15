-- Layout-aware tender ingestion, structured analysis, enrichment and RAG.
create extension if not exists vector with schema extensions;

alter table public.rfps
  add column if not exists ingestion jsonb not null default '{}'::jsonb,
  add column if not exists analysis_json jsonb not null default '{}'::jsonb,
  add column if not exists enrichment jsonb not null default '{}'::jsonb,
  add column if not exists intelligence_updated_at timestamptz;

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('proposal','case_study','consultant_cv','methodology','company_fact')),
  source_id text not null default '',
  title text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_owner_idx on public.knowledge_chunks(user_id, source_type);
create index if not exists knowledge_chunks_embedding_idx on public.knowledge_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.knowledge_chunks enable row level security;
drop policy if exists knowledge_chunks_select_own on public.knowledge_chunks;
drop policy if exists knowledge_chunks_insert_own on public.knowledge_chunks;
drop policy if exists knowledge_chunks_update_own on public.knowledge_chunks;
drop policy if exists knowledge_chunks_delete_own on public.knowledge_chunks;
create policy knowledge_chunks_select_own on public.knowledge_chunks for select to authenticated using (auth.uid() = user_id);
create policy knowledge_chunks_insert_own on public.knowledge_chunks for insert to authenticated with check (auth.uid() = user_id);
create policy knowledge_chunks_update_own on public.knowledge_chunks for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy knowledge_chunks_delete_own on public.knowledge_chunks for delete to authenticated using (auth.uid() = user_id);

create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 12,
  minimum_similarity double precision default 0.35
)
returns table (id uuid, source_type text, source_id text, title text, content text, metadata jsonb, similarity double precision)
language sql stable security invoker set search_path = public, extensions
as $$
  select k.id, k.source_type, k.source_id, k.title, k.content, k.metadata,
         1 - (k.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks k
  where k.user_id = auth.uid()
    and 1 - (k.embedding <=> query_embedding) >= minimum_similarity
  order by k.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

notify pgrst, 'reload schema';
