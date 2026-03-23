import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { plansApi, shoppingApi, ShoppingListItem } from '../lib/api'
import { format, parseISO, startOfWeek, addDays } from 'date-fns'

const CATEGORY_ORDER = ['meat', 'seafood', 'produce', 'dairy', 'dry_goods', 'condiments', 'frozen', 'bakery', 'other']
const CATEGORY_LABELS: Record<string, string> = {
  produce: 'Produce', meat: 'Meat & poultry', seafood: 'Seafood', dairy: 'Dairy & eggs',
  dry_goods: 'Dry goods & pantry', condiments: 'Condiments & sauces',
  frozen: 'Frozen', bakery: 'Bakery', other: 'Other',
}
const CATEGORY_COLORS: Record<string, string> = {
  meat: '#D85A30', seafood: '#378ADD', produce: '#639922',
  dairy: '#7F77DD', dry_goods: '#888780', condiments: '#BA7517',
  frozen: '#1D9E75', bakery: '#D4537E', other: '#888780',
}

export default function ShoppingPage() {
  const qc = useQueryClient()
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null)

  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: plansApi.list })

  // Default to most recent plan
  const activePlanId = selectedPlanId ?? plans?.[0]?.id ?? null

  const { data: shoppingList, isLoading } = useQuery({
    queryKey: ['shopping', activePlanId],
    queryFn: () => shoppingApi.get(activePlanId!),
    enabled: !!activePlanId,
    retry: false,
  })

  const generate = useMutation({
    mutationFn: () => shoppingApi.generate(activePlanId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shopping', activePlanId] }),
  })

  const checkItem = useMutation({
    mutationFn: (itemId: number) => shoppingApi.checkItem(itemId),
    onMutate: async (itemId) => {
      // Optimistic update
      await qc.cancelQueries({ queryKey: ['shopping', activePlanId] })
      qc.setQueryData(['shopping', activePlanId], (old: any) => ({
        ...old,
        items: old.items.map((i: ShoppingListItem) =>
          i.id === itemId ? { ...i, checked: !i.checked } : i
        ),
      }))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['shopping', activePlanId] }),
  })

  // Group items by category, pantry items last
  const grouped = shoppingList?.items.reduce((acc, item) => {
    const cat = item.from_pantry ? '_pantry' : (item.ingredient.category ?? 'other')
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {} as Record<string, ShoppingListItem[]>) ?? {}

  const toBuy = shoppingList?.items.filter(i => !i.from_pantry) ?? []
  const checked = toBuy.filter(i => i.checked).length
  const leftovers = shoppingList?.items.filter(i => (i.leftover_quantity ?? 0) > 0) ?? []

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Shopping list</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {plans && plans.length > 1 && (
            <select className="input select" style={{ width: 'auto' }}
              value={activePlanId ?? ''}
              onChange={e => setSelectedPlanId(+e.target.value)}>
              {plans.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <button className="btn btn-primary" onClick={() => generate.mutate()} disabled={!activePlanId || generate.isPending}>
            {generate.isPending ? 'Generating...' : shoppingList ? 'Regenerate' : 'Generate list'}
          </button>
        </div>
      </div>

      <div className="page-body">
        {!activePlanId && (
          <div className="empty-state">
            <div className="empty-state-title">No meal plan found</div>
            <div className="empty-state-body">Create a plan in the Planner first, then generate a shopping list here.</div>
          </div>
        )}

        {activePlanId && !shoppingList && !isLoading && (
          <div className="empty-state">
            <div className="empty-state-title">No shopping list yet</div>
            <div className="empty-state-body">Hit Generate to build a grouped list from your meal plan.</div>
          </div>
        )}

        {shoppingList && (
          <>
            {/* Summary stats */}
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-value">{toBuy.length}</div>
                <div className="stat-label">Items to buy</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{checked}/{toBuy.length}</div>
                <div className="stat-label">Checked off</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: grouped['_pantry'] ? 'var(--color-brand)' : 'var(--color-text-tertiary)' }}>
                  {grouped['_pantry']?.length ?? 0}
                </div>
                <div className="stat-label">From pantry</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: leftovers.length > 0 ? 'var(--color-amber)' : 'var(--color-brand)' }}>
                  {leftovers.length}
                </div>
                <div className="stat-label">Leftover items</div>
              </div>
            </div>

            {/* Leftover alert */}
            {leftovers.length > 0 && (
              <div style={{
                background: 'var(--color-amber-light)', border: '1px solid #FAC775',
                borderRadius: 'var(--radius-md)', padding: '10px 14px',
                fontSize: 12, color: 'var(--color-amber)', marginBottom: 20
              }}>
                <strong>Leftovers this week:</strong>{' '}
                {leftovers.map(i => `${i.leftover_quantity}${i.unit} ${i.ingredient.name}`).join(' · ')}
              </div>
            )}

            {/* Grouped items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {CATEGORY_ORDER.map(cat => {
                const items = grouped[cat]
                if (!items?.length) return null
                return (
                  <CategorySection
                    key={cat}
                    category={cat}
                    label={CATEGORY_LABELS[cat]}
                    color={CATEGORY_COLORS[cat]}
                    items={items}
                    onCheck={id => checkItem.mutate(id)}
                  />
                )
              })}

              {/* Pantry section */}
              {grouped['_pantry']?.length > 0 && (
                <CategorySection
                  key="_pantry"
                  category="_pantry"
                  label="Already in pantry"
                  color="#1D9E75"
                  items={grouped['_pantry']}
                  onCheck={id => checkItem.mutate(id)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CategorySection({ category, label, color, items, onCheck }: {
  category: string
  label: string
  color: string
  items: ShoppingListItem[]
  onCheck: (id: number) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const isPantry = category === '_pantry'

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', cursor: 'pointer',
          background: 'var(--color-surface-subtle)',
          borderBottom: collapsed ? 'none' : '1px solid var(--color-border)',
        }}
      >
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {collapsed ? '▸' : '▾'}
        </span>
      </div>

      {!collapsed && items.map((item, i) => (
        <div key={item.id} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
          borderBottom: i < items.length - 1 ? '1px solid var(--color-border)' : 'none',
          background: item.checked || isPantry ? 'var(--color-surface-subtle)' : 'var(--color-surface)',
        }}>
          {/* Checkbox */}
          <div
            onClick={() => onCheck(item.id)}
            style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
              border: `1px solid ${item.checked || isPantry ? '#1D9E75' : 'var(--color-border-strong)'}`,
              background: item.checked || isPantry ? '#1D9E75' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {(item.checked || isPantry) && (
              <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                <path d="M1 3l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>

          <span style={{
            flex: 1, fontSize: 13,
            color: item.checked || isPantry ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
            textDecoration: item.checked || isPantry ? 'line-through' : 'none',
          }}>
            {item.ingredient.name}
          </span>

          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', minWidth: 80, textAlign: 'right' }}>
            {item.quantity_to_buy} {item.unit}
          </span>

          {item.packs_to_buy && (
            <span className="badge badge-gray" style={{ fontSize: 9, minWidth: 44, justifyContent: 'center' }}>
              ×{item.packs_to_buy} pack
            </span>
          )}

          {(item.leftover_quantity ?? 0) > 0 && (
            <span className="badge badge-amber" style={{ fontSize: 9 }}>
              {item.leftover_quantity}{item.unit} left
            </span>
          )}

          {isPantry && <span className="badge badge-green" style={{ fontSize: 9 }}>in pantry</span>}
        </div>
      ))}
    </div>
  )
}
