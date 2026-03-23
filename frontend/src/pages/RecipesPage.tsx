import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { recipesApi, Recipe } from '../lib/api'

const CATEGORY_LABELS: Record<string, string> = {
  produce: 'Produce', meat: 'Meat', seafood: 'Seafood', dairy: 'Dairy',
  dry_goods: 'Dry goods', condiments: 'Condiments', frozen: 'Frozen',
  bakery: 'Bakery', other: 'Other',
}

export default function RecipesPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Recipe | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importError, setImportError] = useState('')

  const { data: recipes, isLoading } = useQuery({
    queryKey: ['recipes'],
    queryFn: recipesApi.list,
  })

  const deleteRecipe = useMutation({
    mutationFn: (id: number) => recipesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      setSelected(null)
    },
  })

  const importMutation = useMutation({
    mutationFn: (url: string) => recipesApi.importUrl(url),
    onSuccess: (recipe) => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      setShowImport(false)
      setImportUrl('')
      setImportError('')
      setSelected(recipe)
    },
    onError: (e: any) => setImportError(e.response?.data?.detail || 'Import failed'),
  })

  const filtered = recipes?.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', height: '100%' }}>
      {/* Left: recipe list */}
      <div style={{ borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
        <div className="page-header" style={{ gap: 8, flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 className="page-title">Recipes</h1>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => setShowImport(true)}>
              + Import URL
            </button>
          </div>
          <input
            className="input"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {isLoading && (
            <div style={{ padding: 20, color: 'var(--color-text-tertiary)', fontSize: 13 }}>Loading...</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="empty-state" style={{ padding: 32 }}>
              <div className="empty-state-title">No recipes yet</div>
              <div className="empty-state-body">Import one from a URL to get started.</div>
            </div>
          )}
          {filtered.map(recipe => (
            <button key={recipe.id}
              onClick={() => setSelected(recipe)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '12px 20px',
                borderBottom: '1px solid var(--color-border)',
                background: selected?.id === recipe.id ? 'var(--color-brand-light)' : 'transparent',
                border: 'none',
                borderLeft: selected?.id === recipe.id ? '3px solid var(--color-brand)' : '3px solid transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--color-text-primary)' }}>
                {recipe.name}
              </div>
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
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                    {selected.description}
                  </div>
                )}
              </div>
              <button className="btn" style={{ color: 'var(--color-red)', fontSize: 12 }}
                onClick={() => deleteRecipe.mutate(selected.id)}>
                Delete
              </button>
            </div>

            <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Meta */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {selected.prep_minutes && (
                  <span className="badge badge-gray">Prep {selected.prep_minutes} min</span>
                )}
                {selected.cook_minutes && (
                  <span className="badge badge-gray">Cook {selected.cook_minutes} min</span>
                )}
                <span className="badge badge-gray">{selected.base_servings} servings base</span>
                {selected.source_url && (
                  <a href={selected.source_url} target="_blank" rel="noreferrer"
                    className="badge badge-gray" style={{ color: 'var(--color-brand)' }}>
                    Source ↗
                  </a>
                )}
              </div>

              {/* Ingredients */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                  Ingredients
                </div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  {selected.ingredients.map((ri, i) => (
                    <div key={ri.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 16px',
                      borderBottom: i < selected.ingredients.length - 1 ? '1px solid var(--color-border)' : 'none',
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
                        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                          {ri.notes}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Instructions */}
              {selected.instructions && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    Instructions
                  </div>
                  <div className="card" style={{ fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                    {selected.instructions}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Import URL modal */}
      {showImport && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }} onClick={() => setShowImport(false)}>
          <div style={{
            background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
            padding: 28, width: 460, display: 'flex', flexDirection: 'column', gap: 16
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 500, fontSize: 16 }}>Import recipe from URL</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              Paste any recipe page URL — Claude will extract the ingredients and instructions automatically.
            </div>
            <input
              className="input"
              placeholder="https://..."
              value={importUrl}
              onChange={e => setImportUrl(e.target.value)}
              autoFocus
            />
            {importError && (
              <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{importError}</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowImport(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!importUrl || importMutation.isPending}
                onClick={() => importMutation.mutate(importUrl)}
              >
                {importMutation.isPending ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
