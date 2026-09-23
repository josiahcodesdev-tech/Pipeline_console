import { supabase } from './client'
import type { KnowledgeArticleRow } from './database.types'
import { currentUserId, unwrap } from './internal'

/**
 * The firm's proposal-writing knowledge base. See migration 0046.
 *
 * Read by everyone; written by admins and the super user, which the database
 * enforces — a member's save is refused there, not just hidden here.
 */
export interface KnowledgeArticle {
  id: string
  title: string
  category: string
  body: string
  /** Handed to the proposal drafter on every draft. */
  forDrafter: boolean
  position: number
  /** Written from the built-in doctrine by the migration, not by a person. */
  seeded: boolean
  /** Which seeded row this is, if any — `further-instructions` is the editor. */
  seedKey: string | null
  updatedBy: string | null
  updatedAt: string
}

export type KnowledgeDraft = Pick<
  KnowledgeArticle,
  'title' | 'category' | 'body' | 'forDrafter' | 'position'
>

function toArticle(row: KnowledgeArticleRow): KnowledgeArticle {
  return {
    id: row.id,
    title: row.title,
    category: row.category || 'General',
    body: row.body ?? '',
    forDrafter: row.for_drafter,
    position: row.position ?? 0,
    seeded: row.seed_key !== null,
    seedKey: row.seed_key,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

export async function fetchKnowledge(): Promise<KnowledgeArticle[]> {
  const { data, error } = await supabase
    .from('knowledge_articles')
    .select('*')
    .order('category', { ascending: true })
    .order('position', { ascending: true })
    .order('title', { ascending: true })
  if (error) {
    // Not run yet: say which migration, rather than a schema-cache error.
    if (error.code === 'PGRST205' || error.code === '42P01') {
      throw new Error('The knowledge base table does not exist yet — run migration 0046.')
    }
    throw new Error(error.message)
  }
  return (data ?? []).map(toArticle)
}

export async function saveKnowledge(
  draft: KnowledgeDraft,
  id?: string,
): Promise<KnowledgeArticle> {
  const fields = {
    title: draft.title.trim(),
    category: draft.category.trim() || 'General',
    body: draft.body,
    for_drafter: draft.forDrafter,
    position: draft.position,
    updated_by: await currentUserId(),
  }
  const row = id
    ? unwrap(await supabase.from('knowledge_articles').update(fields).eq('id', id).select().single())
    : unwrap(await supabase.from('knowledge_articles').insert(fields).select().single())
  return toArticle(row)
}

/** The blank space the firm writes its own standing instructions into. */
export const FURTHER_INSTRUCTIONS = 'further-instructions'

export async function removeKnowledge(id: string): Promise<void> {
  const { error } = await supabase.from('knowledge_articles').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
