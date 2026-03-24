import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  recipesApi, Recipe, RecipePreview,
  AliasDecision, ConsolidationDecision,
  AliasSuggestion, ConsolidationSuggestion
} from '../lib/api'

const CATEGORY_LABELS: Record<string, string> = {
  produce: 'Produce', meat: 'Meat', seafood: 'Seafood', dairy: 'Dairy',
  dry_goods: 'Dry goods', condiments: 'Condiments', frozen: 'Frozen',
  bakery: 'Bakery', other: 'Other',
}

export default function RecipesPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Recipe | null>(null)
  const [importStep, setImportStep] = useState<'idle' | 'url' | 'review'>('idle')
  const [importUrl, setImportUrl] = useState('')
  const [importError, setImportError] = useState('')
  const [preview, setPreview] = useState<RecipePreview | null>(null)

  const { data: recipes, isLoading } = useQuery({
    queryKey: ['recipes'],
    queryFn: recipesApi.list,
  })

  const deleteRecipe = useMutation({
    mutationFn: (id: number) => recipesApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recipes'] }); setSelected(null) },
    onError: (e: any) => alert(`Failed to delete: ${e?.response?.data?.detail ?? e.message}`),
  })

  const handleDelete = (id: number) => {
    if (!window.confirm('Delete this recipe? This cannot be undone.')) return
    deleteRecipe.mutate(id)
  }

  const previewMutation = useMutation({
    mutationFn: (url: string) => recipesApi.importPreview(url),
    onSuccess: (data) => { setPreview(data); setImportStep('review') },
    onError: (e: any) => setImportError(e.response?.data?.detail || 'Import failed'),
  })

  const confirmMutation = useMutation({
    mutationFn: recipesApi.importConfirm,
    onSuccess: (recipe) => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      setSelected(recipe)
      setImportStep('idle')
      setImportUrl('')
      setPreview(null)
    },
    onError: (e: any) => setImportError(e.response?.data?.detail || 'Save failed'),
  })

  const closeImport = () => { setImportStep('idle'); setImportUrl(''); setImportError(''); setPreview(null) }

  const filtered = recipes?.filter(r => r.name.toLowerCase().includes(search.toLowerCase())) ?? []

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', height: '100%' }}>
      {/* Left: recipe list */}
      <div style={{ borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
        <div className="page-header" style={{ gap: 8, flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 className="page-title">Recipes</h1>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => setImportStep('url')}>
              + Import URL
            </button>
          </div>
          <input className="input" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {isLoading && <div style={{ padding: 20, color: 'var(--color-text-tertiary)', fontSize: 13 }}>Loading...</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="empty-state" style={{ padding: 32 }}>
              <div className="empty-state-title">No recipes yet</div>
              <div className="empty-state-body">Import one from a URL to get started.</div>
            </div>
          )}
          {filtered.map(recipe => (
            <button key={recipe.id} onClick={() => setSelected(recipe)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '12px 20px',
              borderBottom: '1px solid var(--color-border)', background: selected?.id === recipe.id ? 'var(--color-brand-light)' : 'transparent',
              border: 'none', borderLeft: selected?.id === recipe.id ? '3px solid var(--color-brand)' : '3px solid transparent', cursor: 'pointer',
            }}>
              <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--color-text-primary)' }}>{recipe.name}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                {recipe.ingredients.length} ingredients · {recipe.base_servings} servings
                {recipe.prep_minutes && ` · ${recipe.prep_minutes + (recipe.cook_minutes ?? 0)} min`}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: recipe detail */}
      <div style={{ overflowY: 'auto' }}>
        {!selected && (
          <div className="empty-state" style={{ paddingTop: 80 }}>
            <div className="empty-state-title">Select a recipe</div>
            <div className="empty-state-body">Or import one from a URL using the button above.</div>
          </div>
        )}
        {selected && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">{selected.name}</h1>
                {selected.description && (
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>{selected.description}</div>
                )}
              </div>
              <button className="btn" style={{ color: 'var(--color-red)', fontSize: 12 }}
                disabled={deleteRecipe.isPending} onClick={() => handleDelete(selected.id)}>
                {deleteRecipe.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>

            <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {selected.prep_minutes && <span className="badge badge-gray">Prep {selected.prep_minutes} min</span>}
                {selected.cook_minutes && <span className="badge badge-gray">Cook {selected.cook_minutes} min</span>}
                <span className="badge badge-gray">{selected.base_servings} servings base</span>
                {selected.source_url && (
                  <a href={selected.source_url} target="_blank" rel="noreferrer"
                    className="badge badge-gray" style={{ color: 'var(--color-brand)' }}>Source ↗</a>
                )}
              </div>

              {/* Ingredients — grouped */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                  Ingredients
                </div>
                <IngredientList ingredients={selected.ingredients} />
              </div>

              {/* Instructions */}
              {selected.instructions && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    Method
                  </div>
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {selected.instructions.split('\n').filter(Boolean).map((step, i) => {
                      const text = step.replace(/^\d+\.\s*/, '')
                      const totalSteps = selected.instructions!.split('\n').filter(Boolean).length
                      return (
                        <div key={i} style={{
                          display: 'flex', gap: 14, padding: '12px 18px',
                          borderBottom: i < totalSteps - 1 ? '1px solid var(--color-border)' : 'none',
                          alignItems: 'flex-start',
                        }}>
                          <div style={{
                            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                            background: 'var(--color-brand-light)', color: 'var(--color-brand-dark)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 500, marginTop: 1,
                          }}>{i + 1}</div>
                          <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--color-text-primary)', paddingTop: 2 }}>{text}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Step 1: URL entry */}
      {importStep === 'url' && (
        <Modal onClose={closeImport} width={460}>
          <div style={{ fontWeight: 500, fontSize: 16 }}>Import recipe from URL</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Paste any recipe page URL — Claude will extract the ingredients and instructions automatically.
          </div>
          <input className="input" placeholder="https://..." value={importUrl}
            onChange={e => setImportUrl(e.target.value)} autoFocus
            onKeyDown={e => e.key === 'Enter' && importUrl && previewMutation.mutate(importUrl)} />
          {importError && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{importError}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={closeImport}>Cancel</button>
            <button className="btn btn-primary" disabled={!importUrl || previewMutation.isPending}
              onClick={() => previewMutation.mutate(importUrl)}>
              {previewMutation.isPending ? 'Fetching...' : 'Continue'}
            </button>
          </div>
        </Modal>
      )}

      {/* Step 2: Review suggestions */}
      {importStep === 'review' && preview && (
        <ReviewModal
          preview={preview}
          onConfirm={(aliasDecisions, consolidationDecisions) =>
            confirmMutation.mutate({ parsed: preview.parsed, alias_decisions: aliasDecisions, consolidation_decisions: consolidationDecisions })
          }
          onBack={() => setImportStep('url')}
          onClose={closeImport}
          isPending={confirmMutation.isPending}
          error={importError}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ingredient list with group headers
// ---------------------------------------------------------------------------

function IngredientList({ ingredients }: { ingredients: any[] }) {
  // Group ingredients preserving original order
  const groups: { label: string | null; items: any[] }[] = []
  for (const ri of ingredients) {
    const g = ri.group ?? null
    const last = groups[groups.length - 1]
    if (last && last.label === g) {
      last.items.push(ri)
    } else {
      groups.push({ label: g, items: [ri] })
    }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.label && (
            <div style={{
              padding: '6px 16px', fontSize: 10, fontWeight: 500,
              color: 'var(--color-brand-dark)', background: 'var(--color-brand-light)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              borderBottom: '1px solid var(--color-border)',
              borderTop: gi > 0 ? '1px solid var(--color-border)' : 'none',
            }}>
              {group.label}
            </div>
          )}
          {group.items.map((ri: any, i: number) => (
            <div key={ri.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px',
              borderBottom: (gi < groups.length - 1 || i < group.items.length - 1) ? '1px solid var(--color-border)' : 'none',
            }}>
              <span className="badge badge-gray" style={{ fontSize: 9, minWidth: 60, justifyContent: 'center' }}>
                {CATEGORY_LABELS[ri.ingredient.category] ?? ri.ingredient.category}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)' }}>
                {ri.ingredient.name}
              </span>
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                {ri.quantity} {ri.unit}
              </span>
              {ri.notes && (
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{ri.notes}</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Review modal
// ---------------------------------------------------------------------------

function ReviewModal({ preview, onConfirm, onBack, onClose, isPending, error }: {
  preview: RecipePreview
  onConfirm: (aliases: AliasDecision[], consolidations: ConsolidationDecision[]) => void
  onBack: () => void
  onClose: () => void
  isPending: boolean
  error: string
}) {
  const hasAliases = preview.alias_suggestions.length > 0
  const hasConsolidations = preview.consolidation_suggestions.length > 0
  const hasSuggestions = hasAliases || hasConsolidations

  // Decision state: 'accept' | 'reject' | null (undecided)
  const [aliasDecisions, setAliasDecisions] = useState<Record<string, 'accept' | 'reject'>>(
    () => Object.fromEntries(preview.alias_suggestions.map(a => [a.raw_name, 'accept']))
  )
  const [consolidationDecisions, setConsolidationDecisions] = useState<Record<string, 'accept' | 'reject'>>(
    () => Object.fromEntries(preview.consolidation_suggestions.map(c => [c.source_names.join(','), 'accept']))
  )

  const handleConfirm = () => {
    const aliasDecs: AliasDecision[] = preview.alias_suggestions.map(s => ({
      raw_name: s.raw_name,
      canonical_name: s.canonical_name,
      confirmed: aliasDecisions[s.raw_name] === 'accept',
    }))
    const consolidationDecs: ConsolidationDecision[] = preview.consolidation_suggestions.map(s => ({
      source_names: s.source_names,
      consolidated_name: s.consolidated_name,
      confirmed: consolidationDecisions[s.source_names.join(',')] === 'accept',
    }))
    onConfirm(aliasDecs, consolidationDecs)
  }

  const recipe = preview.parsed

  return (
    <Modal onClose={onClose} width={560}>
      <div style={{ fontWeight: 500, fontSize: 16 }}>Review import</div>

      {/* Recipe summary */}
      <div className="card" style={{ background: 'var(--color-surface-subtle)' }}>
        <div style={{ fontWeight: 500, fontSize: 14 }}>{recipe.name}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
          {recipe.base_servings} servings · {recipe.ingredients?.length ?? 0} ingredients
          {recipe.prep_minutes && ` · ${recipe.prep_minutes + (recipe.cook_minutes ?? 0)} min`}
        </div>
      </div>

      {/* Auto-applied aliases */}
      {preview.auto_applied_aliases.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Applied automatically
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {preview.auto_applied_aliases.map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="badge badge-green" style={{ fontSize: 9 }}>matched</span>
                {a}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alias suggestions */}
      {hasAliases && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Ingredient matches
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
            These ingredients may be the same thing. Accept to merge them in future imports.
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {preview.alias_suggestions.map((s, i) => (
              <SuggestionRow
                key={i}
                label={<><strong>{s.raw_name}</strong> → {s.canonical_name}</>}
                reason={s.reason}
                decision={aliasDecisions[s.raw_name]}
                onAccept={() => setAliasDecisions(d => ({ ...d, [s.raw_name]: 'accept' }))}
                onReject={() => setAliasDecisions(d => ({ ...d, [s.raw_name]: 'reject' }))}
                last={i === preview.alias_suggestions.length - 1}
              />
            ))}
          </div>
        </div>
      )}

      {/* Consolidation suggestions */}
      {hasConsolidations && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Combined ingredients
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
            These come from the same source ingredient. Accept to list them as one on the shopping list.
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {preview.consolidation_suggestions.map((s, i) => (
              <SuggestionRow
                key={i}
                label={<>{s.source_names.join(' + ')} → <strong>{s.consolidated_name}</strong></>}
                reason={s.reason}
                decision={consolidationDecisions[s.source_names.join(',')]}
                onAccept={() => setConsolidationDecisions(d => ({ ...d, [s.source_names.join(',')]: 'accept' }))}
                onReject={() => setConsolidationDecisions(d => ({ ...d, [s.source_names.join(',')]: 'reject' }))}
                last={i === preview.consolidation_suggestions.length - 1}
              />
            ))}
          </div>
        </div>
      )}

      {!hasSuggestions && preview.auto_applied_aliases.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', padding: '8px 0' }}>
          No suggestions — recipe looks clean.
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onBack}>Back</button>
        <button className="btn btn-primary" disabled={isPending} onClick={handleConfirm}>
          {isPending ? 'Saving...' : 'Save recipe'}
        </button>
      </div>
    </Modal>
  )
}

function SuggestionRow({ label, reason, decision, onAccept, onReject, last }: {
  label: React.ReactNode
  reason: string
  decision: 'accept' | 'reject'
  onAccept: () => void
  onReject: () => void
  last: boolean
}) {
  return (
    <div style={{
      padding: '10px 14px',
      borderBottom: last ? 'none' : '1px solid var(--color-border)',
      background: decision === 'accept' ? 'var(--color-brand-light)' : decision === 'reject' ? 'var(--color-surface-subtle)' : 'var(--color-surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, fontSize: 13 }}>{label}</div>
        <button
          onClick={onAccept}
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: '3px 10px', color: decision === 'accept' ? 'var(--color-brand-dark)' : 'var(--color-text-secondary)', borderColor: decision === 'accept' ? '#9FE1CB' : 'var(--color-border-strong)', background: decision === 'accept' ? 'var(--color-brand-light)' : 'transparent' }}
        >
          Accept
        </button>
        <button
          onClick={onReject}
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: '3px 10px', color: decision === 'reject' ? 'var(--color-red)' : 'var(--color-text-secondary)', borderColor: decision === 'reject' ? '#F09595' : 'var(--color-border-strong)' }}
        >
          Reject
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>{reason}</div>
    </div>
  )
}

function Modal({ children, onClose, width = 460 }: {
  children: React.ReactNode
  onClose: () => void
  width?: number
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
        padding: 28, width, maxWidth: '100%', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', gap: 16,
        overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
