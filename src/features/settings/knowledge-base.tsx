import { Fragment, useEffect, useMemo, useState } from 'react'
import { BookOpenIcon, PencilIcon, PlusIcon, SearchXIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { EmptyState, Panel } from '@/shared/components/panel'
import { Field } from '@/shared/components/field'
import { useAuth } from '@/shared/hooks/use-auth'
import { useMemberNames } from '@/shared/hooks/use-member-names'
import { formatDateWithYear } from '@/domain/dates'
import { boldRuns, parseProposal, type Block } from '@/documents/proposal-markdown'
import {
  FURTHER_INSTRUCTIONS,
  fetchKnowledge,
  removeKnowledge,
  saveKnowledge,
  type KnowledgeArticle,
  type KnowledgeDraft,
} from '@/data/knowledge'
import { cn } from '@/shared/utils'

/**
 * How much of the knowledge base the drafter is given. Must match
 * MAX_KNOWLEDGE_CHARS in the concept-note function, which is what enforces it.
 */
const DRAFTER_BUDGET = 12_000

/**
 * The seeded categories in reading order — getting started first, the
 * pre-submission checklist last. Categories anyone adds sort after these,
 * alphabetically.
 */
const CATEGORY_ORDER = [
  'Getting started',
  'Evidence and compliance',
  'Structure',
  'Writing style',
  'Review before submission',
]

function categoryRank(category: string): number {
  const at = CATEGORY_ORDER.indexOf(category)
  return at === -1 ? CATEGORY_ORDER.length : at
}

const FURTHER_PLACEHOLDER = `Write any further instructions for writing proposals here, and update them whenever you like.

e.g.
- Always include a one-page Assignment at a Glance table.
- For county government tenders, reference the County Integrated Development Plan.`

const EMPTY_DRAFT: KnowledgeDraft = {
  title: '',
  category: 'General',
  body: '',
  forDrafter: true,
  position: 100,
}

/** `**bold**` and `code`, which is all the articles use inline. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {boldRuns(text).map((run, index) => {
        const parts = run.split('`').map((part, at) =>
          at % 2 === 1 ? (
            <code key={at} className="rounded bg-surface-2 px-1 font-mono text-[11px]">
              {part}
            </code>
          ) : (
            <Fragment key={at}>{part}</Fragment>
          ),
        )
        return index % 2 === 1 ? (
          <strong key={index} className="font-semibold text-foreground">
            {parts}
          </strong>
        ) : (
          <Fragment key={index}>{parts}</Fragment>
        )
      })}
    </>
  )
}

function ArticleBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'blank':
      return null
    case 'heading':
      return <h4 className="mb-1.5 mt-3 text-[12.5px] font-semibold text-foreground">{block.text}</h4>
    case 'bullet':
      return (
        <li className="ml-4 list-disc">
          <Inline text={block.text} />
        </li>
      )
    case 'numbered':
      return (
        <li className="ml-4 list-none">
          <span className="mr-1.5 tabular-nums text-faint">{block.marker}</span>
          <Inline text={block.text} />
        </li>
      )
    case 'table': {
      const [head, ...rows] = block.rows
      return (
        <div className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr>
                {head?.map((cell, index) => (
                  <th
                    key={index}
                    className="border-b border-border px-2 py-1.5 text-left font-semibold text-foreground"
                  >
                    <Inline text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, at) => (
                <tr key={at} className="border-b border-border-soft last:border-b-0">
                  {row.map((cell, index) => (
                    <td key={index} className="px-2 py-1.5 align-top">
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'callout':
    case 'paragraph':
      return (
        <p className="my-1.5">
          <Inline text={block.text} />
        </p>
      )
  }
}

function ArticleBody({ body }: { body: string }) {
  const blocks = useMemo(() => parseProposal(body), [body])
  return (
    <div className="space-y-0.5 text-[12px] leading-relaxed text-muted-foreground">
      {blocks.map((block, index) => (
        <ArticleBlock key={index} block={block} />
      ))}
    </div>
  )
}

/**
 * The firm's proposal-writing knowledge base.
 *
 * One set of articles for everyone, unlike the house rules below it, which
 * are each member's own. See migration 0046 for who may write what, and
 * knowledgeBlock in the concept-note function for how the drafter reads it.
 */
export function KnowledgeBase() {
  const { can } = useAuth()
  const members = useMemberNames()
  const [articles, setArticles] = useState<KnowledgeArticle[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<KnowledgeArticle | null>(null)
  const [draft, setDraft] = useState<KnowledgeDraft>(EMPTY_DRAFT)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [further, setFurther] = useState('')
  const [savingFurther, setSavingFurther] = useState(false)

  useEffect(() => {
    let live = true
    fetchKnowledge()
      .then((rows) => {
        if (!live) return
        setArticles(rows)
        setFurther(rows.find((row) => row.seedKey === FURTHER_INSTRUCTIONS)?.body ?? '')
      })
      .catch((cause) => live && setProblem(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      live = false
    }
  }, [])

  /** The blank space, shown as an editor rather than in the list. */
  const furtherRow = articles?.find((row) => row.seedKey === FURTHER_INSTRUCTIONS) ?? null
  const furtherDirty = furtherRow !== null && further !== furtherRow.body

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matching = (articles ?? []).filter(
      (article) =>
        article.seedKey !== FURTHER_INSTRUCTIONS &&
        (!term ||
        article.title.toLowerCase().includes(term) ||
        article.body.toLowerCase().includes(term) ||
        article.category.toLowerCase().includes(term)),
    )
    const byCategory = new Map<string, KnowledgeArticle[]>()
    for (const article of matching) {
      const list = byCategory.get(article.category) ?? []
      list.push(article)
      byCategory.set(article.category, list)
    }
    return [...byCategory.entries()].sort(
      ([a], [b]) => categoryRank(a) - categoryRank(b) || a.localeCompare(b),
    )
  }, [articles, search])

  /** What the drafter is sent, in the order it reads it. */
  const drafterChars = useMemo(
    () =>
      (articles ?? [])
        .filter((article) => article.forDrafter && article.body.trim())
        .reduce((total, article) => total + article.title.length + article.body.length, 0),
    [articles],
  )

  const categories = useMemo(
    () => [...new Set((articles ?? []).map((article) => article.category))].sort(),
    [articles],
  )

  function open(article: KnowledgeArticle | null) {
    setEditing(article)
    setDraft(
      article
        ? {
            title: article.title,
            category: article.category,
            body: article.body,
            forDrafter: article.forDrafter,
            position: article.position,
          }
        : EMPTY_DRAFT,
    )
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!draft.title.trim()) {
      toast.error('Give the article a title.')
      return
    }
    setBusy(true)
    try {
      const saved = await saveKnowledge(draft, editing?.id)
      setArticles((current) =>
        editing
          ? (current ?? []).map((article) => (article.id === saved.id ? saved : article))
          : [...(current ?? []), saved],
      )
      setDialogOpen(false)
      toast.success(editing ? 'Article saved' : 'Article added')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function saveFurther() {
    if (!furtherRow) return
    setSavingFurther(true)
    try {
      const saved = await saveKnowledge(
        {
          title: furtherRow.title,
          category: furtherRow.category,
          body: further,
          forDrafter: furtherRow.forDrafter,
          position: furtherRow.position,
        },
        furtherRow.id,
      )
      setArticles((current) => (current ?? []).map((row) => (row.id === saved.id ? saved : row)))
      toast.success('Further instructions saved')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSavingFurther(false)
    }
  }

  async function handleDelete(article: KnowledgeArticle) {
    if (!window.confirm(`Delete "${article.title}"?\n\nIt cannot be undone.`)) return
    try {
      await removeKnowledge(article.id)
      setArticles((current) => (current ?? []).filter((row) => row.id !== article.id))
      setDialogOpen(false)
      toast.success('Article deleted')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <>
      <Panel
        title="Knowledge base"
        description="How the firm writes proposals, for everyone. Articles marked Sent to the drafter are also followed by the AI on every proposal anyone drafts."
        action={
          can.editKnowledge ? (
            <Button size="sm" onClick={() => open(null)}>
              <PlusIcon />
              Add article
            </Button>
          ) : null
        }
      >
        {problem ? (
          <p className="text-xs text-warning">{problem}</p>
        ) : articles === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            {furtherRow && (
              <div className="mb-5 rounded-lg border border-primary/30 bg-brand-soft/40 p-3.5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[12.5px] font-semibold text-foreground">Further instructions</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {can.editKnowledge
                        ? 'Your own standing instructions. The drafter reads these first, on every proposal anyone drafts.'
                        : 'Standing instructions from the firm. The drafter reads these first on every proposal.'}
                    </p>
                  </div>
                  {can.editKnowledge && (
                    <Button
                      size="sm"
                      onClick={() => void saveFurther()}
                      disabled={savingFurther || !furtherDirty}
                    >
                      {savingFurther ? 'Saving…' : furtherDirty ? 'Save' : 'Saved'}
                    </Button>
                  )}
                </div>
                {can.editKnowledge ? (
                  <Textarea
                    aria-label="Further instructions"
                    value={further}
                    onChange={(event) => setFurther(event.target.value)}
                    placeholder={FURTHER_PLACEHOLDER}
                    className="min-h-[220px] w-full bg-card font-mono text-[12px] leading-relaxed"
                  />
                ) : further.trim() ? (
                  <ArticleBody body={further} />
                ) : (
                  <p className="text-[11.5px] text-faint">None yet.</p>
                )}
                {furtherRow.updatedBy && further.trim() && (
                  <p className="mt-1.5 text-[10.5px] text-faint">
                    Updated {formatDateWithYear(furtherRow.updatedAt.slice(0, 10))}
                    {members.get(furtherRow.updatedBy) ? ` by ${members.get(furtherRow.updatedBy)}` : ''}
                  </p>
                )}
              </div>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Input
                placeholder="Search the knowledge base…"
                aria-label="Search the knowledge base"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="min-w-[220px] flex-1"
              />
              <span
                className={cn(
                  'text-[11px] tabular-nums',
                  drafterChars > DRAFTER_BUDGET ? 'text-warning' : 'text-faint',
                )}
                title="Characters of the articles sent to the drafter. Past the limit, the last ones in reading order are cut."
              >
                Sent to the drafter: {drafterChars.toLocaleString()} / {DRAFTER_BUDGET.toLocaleString()} characters
              </span>
            </div>

            {grouped.length === 0 ? (
              <EmptyState
                icon={articles.length === 0 ? <BookOpenIcon className="size-5" /> : <SearchXIcon className="size-5" />}
                hint={
                  articles.length === 0
                    ? 'Run migration 0046 to load the starter articles, or add one above.'
                    : 'Try a different word.'
                }
              >
                {articles.length === 0 ? 'No articles yet' : 'No articles match'}
              </EmptyState>
            ) : (
              grouped.map(([category, list]) => (
                <div key={category} className="mb-4 last:mb-0">
                  <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
                    {category}
                  </h3>
                  <div className="rounded-lg border border-border">
                    {list.map((article) => (
                      <details
                        key={article.id}
                        className="group border-b border-border-soft last:border-b-0"
                      >
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-[12.5px] font-medium text-foreground hover:bg-surface-2">
                          <span className="text-faint transition-transform group-open:rotate-90">›</span>
                          <span className="min-w-0 flex-1">{article.title}</span>
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                              article.forDrafter
                                ? 'bg-brand-soft text-primary'
                                : 'bg-surface-2 text-muted-foreground',
                            )}
                          >
                            {article.forDrafter
                              ? 'Sent to the drafter'
                              : article.seeded
                                ? 'Built into the drafter'
                                : 'Reference only'}
                          </span>
                        </summary>
                        <div className="px-3.5 pb-3.5 pl-8">
                          <ArticleBody body={article.body} />
                          <div className="mt-3 flex items-center gap-3 text-[10.5px] text-faint">
                            <span>
                              Updated {formatDateWithYear(article.updatedAt.slice(0, 10))}
                              {article.updatedBy && members.get(article.updatedBy)
                                ? ` by ${members.get(article.updatedBy)}`
                                : ''}
                            </span>
                            {can.editKnowledge && (
                              <button
                                type="button"
                                onClick={() => open(article)}
                                className="inline-flex cursor-pointer items-center gap-1 text-primary hover:underline"
                              >
                                <PencilIcon className="size-3" />
                                Edit
                              </button>
                            )}
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </Panel>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editing ? 'Edit article' : 'Add article'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Field label="Title" htmlFor="kb-title">
              <Input
                id="kb-title"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder="e.g. Always propose a validation workshop for evaluations"
              />
            </Field>
            <div className="flex gap-3">
              <Field label="Category" htmlFor="kb-category">
                <Input
                  id="kb-category"
                  list="kb-categories"
                  value={draft.category}
                  onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                />
                <datalist id="kb-categories">
                  {categories.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </Field>
              <Field label="Order" htmlFor="kb-position">
                <Input
                  id="kb-position"
                  type="number"
                  value={draft.position}
                  onChange={(event) =>
                    setDraft({ ...draft, position: Number(event.target.value) || 0 })
                  }
                  className="w-24"
                />
              </Field>
            </div>
            <Field label="Instructions" htmlFor="kb-body">
              <Textarea
                id="kb-body"
                value={draft.body}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                placeholder={'Write it as you would brief a colleague. Markdown works: **bold**, - bullets, 1. numbered steps, | tables |.'}
                className="min-h-[240px] w-full font-mono text-[12px] leading-relaxed"
              />
            </Field>
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted-foreground">
              <input
                type="checkbox"
                checked={draft.forDrafter}
                onChange={(event) => setDraft({ ...draft, forDrafter: event.target.checked })}
                className="mt-0.5 size-3.5 accent-[var(--primary)]"
              />
              <span>
                <span className="font-medium text-foreground">Send to the drafter.</span> The AI
                follows this on every proposal anyone drafts. Leave it off for reference material.
                {editing?.seeded &&
                  ' This article summarises the doctrine the drafter already has, so sending it too repeats it.'}
              </span>
            </label>
          </div>

          <DialogFooter className="mt-2">
            {editing && can.remove && (
              <Button
                variant="ghost"
                onClick={() => void handleDelete(editing)}
                className="mr-auto text-danger"
              >
                <Trash2Icon />
                Delete
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
