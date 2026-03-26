import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import WoolworthsPanel from './WoolworthsPanel'
import { api } from '../lib/api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { plansApi, shoppingApi, pantryApi, ShoppingListItem } from '../lib/api'

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
  const [inStockModal, setInStockModal] = useState<ShoppingListItem | null>(null)
  const [mergeSource, setMergeSource] = useState<ShoppingListItem | null>(null)
  const [mergeTarget, setMergeTarget] = useState<ShoppingListItem | null>(null)
  const [showWoolworths, setShowWoolworths] = useState(false)

  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: plansApi.list })
  const { data: woolworthsStatus } = useQuery({
    queryKey: ['woolworths-status'],
    queryFn: () => api.get<{ linked: boolean }>('/woolworths/status').then(r => r.data),
  })
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

  const markInStock = useMutation({
    mutationFn: ({ itemId, quantity, unit }: { itemId: number; quantity: number; unit: string }) =>
      shoppingApi.markInStock(itemId, quantity, unit),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopping', activePlanId] })
      qc.invalidateQueries({ queryKey: ['pantry'] })
      setInStockModal(null)
    },
  })

  const markOutOfStock = useMutation({
    mutationFn: (itemId: number) => shoppingApi.markOutOfStock(itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopping', activePlanId] })
      qc.invalidateQueries({ queryKey: ['pantry'] })
    },
  })

  const mergeItems = useMutation({
    mutationFn: (body: { item_id_a: number; item_id_b: number; canonical_name: string; unit: string; permanent: boolean }) =>
      shoppingApi.mergeItems(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopping', activePlanId] })
      setMergeSource(null)
      setMergeTarget(null)
    },
  })

  const handleMergeClick = (item: ShoppingListItem) => {
    if (!mergeSource) {
      setMergeSource(item)
    } else if (mergeSource.id === item.id) {
      setMergeSource(null) // cancel
    } else {
      setMergeTarget(item) // open confirm dialog
    }
  }

  // Split items into three buckets
  const allItems = shoppingList?.items ?? []
  const pantryConfirm = allItems.filter(i => i.from_pantry)         // tracked in pantry — needs confirmation
  const toBuy = allItems.filter(i => !i.from_pantry && !i.checked)  // still need to buy
  const covered = allItems.filter(i => !i.from_pantry && i.checked) // ticked as already have

  // Group buy items by category
  const grouped = toBuy.reduce((acc, item) => {
    const cat = item.ingredient.category ?? 'other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {} as Record<string, ShoppingListItem[]>)

  const leftovers = allItems.filter(i => (i.leftover_quantity ?? 0) > 0)

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
          <button className="btn btn-primary" onClick={() => generate.mutate()}
            disabled={!activePlanId || generate.isPending}>
            {generate.isPending ? 'Generating...' : shoppingList ? 'Regenerate' : 'Generate list'}
          </button>
          {shoppingList && toBuy.length > 0 && (
            <button
              onClick={() => woolworthsStatus?.linked
                ? setShowWoolworths(true)
                : window.location.href = '/settings'
              }
              title={woolworthsStatus?.linked ? 'Match to Woolworths' : 'Link your Woolworths account in Settings'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 'var(--radius-md)',
                background: woolworthsStatus?.linked ? '#007837' : 'var(--color-surface-subtle)',
                color: woolworthsStatus?.linked ? '#fff' : 'var(--color-text-secondary)',
                border: woolworthsStatus?.linked ? 'none' : '1px solid var(--color-border-strong)',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"
                  stroke={woolworthsStatus?.linked ? 'white' : 'currentColor'} strokeWidth="2"/>
                <path d="M3 6h18M16 10a4 4 0 01-8 0"
                  stroke={woolworthsStatus?.linked ? 'white' : 'currentColor'} strokeWidth="2" strokeLinecap="round"/>
              </svg>
              Woolworths
              {!woolworthsStatus?.linked && (
                <span style={{ fontSize: 10, opacity: 0.7 }}>· not linked</span>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="page-body">
        {!activePlanId && (
          <div className="empty-state">
            <div className="empty-state-title">No meal plan found</div>
            <div className="empty-state-body">Create a plan in the Planner first.</div>
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
            {/* Stats */}
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-value">{toBuy.length}</div>
                <div className="stat-label">To buy</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: 'var(--color-brand)' }}>
                  {covered.length + pantryConfirm.length}
                </div>
                <div className="stat-label">Covered</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: pantryConfirm.length > 0 ? 'var(--color-amber)' : 'var(--color-text-tertiary)' }}>
                  {pantryConfirm.length}
                </div>
                <div className="stat-label">Confirm pantry</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: leftovers.length > 0 ? 'var(--color-amber)' : 'var(--color-text-tertiary)' }}>
                  {leftovers.length}
                </div>
                <div className="stat-label">Leftovers</div>
              </div>
            </div>

            {/* Pantry confirmation section */}
            {pantryConfirm.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)',
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8
                }}>
                  Confirm pantry stock
                </div>
                <div style={{
                  background: 'var(--color-amber-light)', border: '1px solid #FAC775',
                  borderRadius: 'var(--radius-md)', padding: '10px 14px',
                  fontSize: 12, color: 'var(--color-amber)', marginBottom: 10
                }}>
                  These items are tracked in your pantry. Confirm you still have them before shopping.
                </div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  {pantryConfirm.map((item, i) => (
                    <div key={item.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                      borderBottom: i < pantryConfirm.length - 1 ? '1px solid var(--color-border)' : 'none',
                      background: 'var(--color-surface)',
                    }}>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)' }}>
                        {item.ingredient.name}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginRight: 8 }}>
                        need {item.quantity_needed} {item.unit}
                      </span>
                      <span className="badge badge-green" style={{ marginRight: 8 }}>in pantry</span>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 10px', color: 'var(--color-brand)', borderColor: '#9FE1CB' }}
                        onClick={() => checkItem.mutate(item.id)}
                      >
                        Still have it
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 10px', color: 'var(--color-red)', borderColor: '#F09595' }}
                        onClick={() => markOutOfStock.mutate(item.id)}
                      >
                        Used up
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Leftover alert */}
            {leftovers.length > 0 && (
              <div style={{
                background: 'var(--color-amber-light)', border: '1px solid #FAC775',
                borderRadius: 'var(--radius-md)', padding: '10px 14px',
                fontSize: 12, color: 'var(--color-amber)', marginBottom: 16
              }}>
                <strong>Leftovers this week:</strong>{' '}
                {leftovers.map(i => `${i.leftover_quantity}${i.unit} ${i.ingredient.name}`).join(' · ')}
              </div>
            )}

            {/* Buy list grouped by category */}
            {toBuy.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {CATEGORY_ORDER.map(cat => {
                  const items = grouped[cat]
                  if (!items?.length) return null
                  return (
                    <CategorySection
                      key={cat}
                      label={CATEGORY_LABELS[cat]}
                      color={CATEGORY_COLORS[cat]}
                      items={items}
                      onCheck={id => checkItem.mutate(id)}
                      onMarkInStock={item => setInStockModal(item)}
                      onMerge={handleMergeClick}
                      mergeSourceId={mergeSource?.id ?? null}
                    />
                  )
                })}
              </div>
            )}

            {/* Covered items (already have / confirmed pantry) */}
            {covered.length > 0 && (
              <div>
                <div style={{
                  fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)',
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8
                }}>
                  Already have
                </div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  {covered.map((item, i) => (
                    <div key={item.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
                      borderBottom: i < covered.length - 1 ? '1px solid var(--color-border)' : 'none',
                      background: 'var(--color-surface-subtle)',
                    }}>
                      {/* Uncheck */}
                      <div onClick={() => checkItem.mutate(item.id)} style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
                        border: '1px solid #1D9E75', background: '#1D9E75',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                          <path d="M1 3l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-tertiary)', textDecoration: 'line-through' }}>
                        {item.ingredient.name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        {item.quantity_to_buy} {item.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Merge mode banner */}
            {mergeSource && (
              <div style={{
                background: '#FAEEDA', border: '1px solid #FAC775',
                borderRadius: 'var(--radius-md)', padding: '10px 14px',
                fontSize: 12, color: '#854F0B', display: 'flex', alignItems: 'center', gap: 10
              }}>
                <span style={{ flex: 1 }}>
                  Merging <strong>{mergeSource.ingredient.name}</strong> — tap another item to merge with it
                </span>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}
                  onClick={() => setMergeSource(null)}>
                  Cancel
                </button>
              </div>
            )}

            {toBuy.length === 0 && pantryConfirm.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-title">All done!</div>
                <div className="empty-state-body">Everything is covered for this week.</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Merge confirm modal */}
      {mergeSource && mergeTarget && (
        <MergeModal
          itemA={mergeSource}
          itemB={mergeTarget}
          onConfirm={(canonicalName, unit, permanent) =>
            mergeItems.mutate({ item_id_a: mergeSource.id, item_id_b: mergeTarget.id, canonical_name: canonicalName, unit, permanent })
          }
          onClose={() => setMergeTarget(null)}
          isPending={mergeItems.isPending}
        />
      )}

      {/* Mark in stock modal */}
      {inStockModal && (
        <InStockModal
          item={inStockModal}
          onConfirm={(quantity, unit) => markInStock.mutate({ itemId: inStockModal.id, quantity, unit })}
          onClose={() => setInStockModal(null)}
          isPending={markInStock.isPending}
        />
      )}
    {showWoolworths && shoppingList && (
      <WoolworthsPanel
        shoppingList={shoppingList}
        onClose={() => setShowWoolworths(false)}
      />
    )}
    </div>
  )
}

function CategorySection({ label, color, items, onCheck, onMarkInStock, onMerge, mergeSourceId }: {
  label: string
  color: string
  items: ShoppingListItem[]
  onCheck: (id: number) => void
  onMarkInStock: (item: ShoppingListItem) => void
  onMerge: (item: ShoppingListItem) => void
  mergeSourceId: number | null
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div onClick={() => setCollapsed(c => !c)} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        cursor: 'pointer', background: 'var(--color-surface-subtle)',
        borderBottom: collapsed ? 'none' : '1px solid var(--color-border)',
      }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && items.map((item, i) => (
        <div key={item.id} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
          borderBottom: i < items.length - 1 ? '1px solid var(--color-border)' : 'none',
          background: mergeSourceId === item.id ? '#FAEEDA' : mergeSourceId ? '#fdfcfb' : 'var(--color-surface)',
          outline: mergeSourceId && mergeSourceId !== item.id ? '1px dashed #FAC775' : 'none',
          outlineOffset: -1,
        }}>
          {/* Buy-list tick */}
          <div onClick={() => onCheck(item.id)} style={{
            width: 16, height: 16, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
            border: '1px solid var(--color-border-strong)', background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} />

          <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)' }}>
            {item.ingredient.name}
          </span>

          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', minWidth: 80, textAlign: 'right' }}>
            {item.quantity_to_buy} {item.unit}
          </span>

          {item.packs_to_buy && (
            <span className="badge badge-gray" style={{ fontSize: 9, minWidth: 44, justifyContent: 'center' }}>
              ×{item.packs_to_buy}
            </span>
          )}

          {(item.leftover_quantity ?? 0) > 0 && (
            <span className="badge badge-amber" style={{ fontSize: 9 }}>
              {item.leftover_quantity}{item.unit} left
            </span>
          )}

          {/* Already have button */}
          <button
            onClick={() => onMarkInStock(item)}
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '3px 8px', color: 'var(--color-brand)', borderColor: '#9FE1CB', whiteSpace: 'nowrap' }}
          >
            I have this
          </button>

          {/* Merge button */}
          <button
            onClick={() => onMerge(item)}
            className="btn btn-ghost"
            style={{
              fontSize: 11, padding: '3px 8px', whiteSpace: 'nowrap',
              color: mergeSourceId === item.id ? '#854F0B' : 'var(--color-text-tertiary)',
              borderColor: mergeSourceId === item.id ? '#FAC775' : 'transparent',
              background: mergeSourceId === item.id ? '#FAEEDA' : 'transparent',
            }}
            title={mergeSourceId === item.id ? 'Cancel merge' : mergeSourceId ? 'Merge with selected' : 'Merge with another item'}
          >
            {mergeSourceId === item.id ? 'Merging...' : mergeSourceId ? 'Merge here' : 'Merge'}
          </button>
        </div>
      ))}
    </div>
  )
}

function InStockModal({ item, onConfirm, onClose, isPending }: {
  item: ShoppingListItem
  onConfirm: (quantity: number, unit: string) => void
  onClose: () => void
  isPending: boolean
}) {
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState(item.unit)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
    }} onClick={onClose}>
      <div style={{
        background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
        padding: 28, width: 360, display: 'flex', flexDirection: 'column', gap: 16
      }} onClick={e => e.stopPropagation()}>
        <div>
          <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 4 }}>
            {item.ingredient.name}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Recipe needs {item.quantity_needed} {item.unit}. How much do you have?
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Quantity</label>
            <input
              type="number"
              className="input"
              placeholder="e.g. 500"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Unit</label>
            <input
              className="input"
              value={unit}
              onChange={e => setUnit(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!quantity || isPending}
            onClick={() => onConfirm(parseFloat(quantity), unit)}
          >
            {isPending ? 'Saving...' : 'Add to pantry'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MergeModal({ itemA, itemB, onConfirm, onClose, isPending }: {
  itemA: ShoppingListItem
  itemB: ShoppingListItem
  onConfirm: (canonicalName: string, unit: string, permanent: boolean) => void
  onClose: () => void
  isPending: boolean
}) {
  const unitsMatch = itemA.unit === itemB.unit
  const [canonicalName, setCanonicalName] = useState(itemA.ingredient.name)
  const [unit, setUnit] = useState(itemA.unit)
  const [permanent, setPermanent] = useState(false)

  const combinedQty = unitsMatch
    ? `${Math.round((itemA.quantity_to_buy + itemB.quantity_to_buy) * 100) / 100} ${unit}`
    : 'units differ — set manually'

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16
    }} onClick={onClose}>
      <div style={{
        background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
        padding: 24, width: 400, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 16
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 500, fontSize: 15 }}>Merge ingredients</div>

        {/* Items being merged */}
        <div className="card" style={{ background: 'var(--color-surface-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--color-text-primary)' }}>{itemA.ingredient.name}</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>{itemA.quantity_to_buy} {itemA.unit}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center' }}>+ merge with</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--color-text-primary)' }}>{itemB.ingredient.name}</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>{itemB.quantity_to_buy} {itemB.unit}</span>
          </div>
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 500 }}>
            <span>Combined</span>
            <span style={{ color: 'var(--color-brand-dark)' }}>{combinedQty}</span>
          </div>
        </div>

        {!unitsMatch && (
          <div style={{ fontSize: 12, color: 'var(--color-amber)', background: 'var(--color-amber-light)', padding: '8px 12px', borderRadius: 'var(--radius-md)' }}>
            These items have different units. Set the combined unit manually below.
          </div>
        )}

        {/* Canonical name */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Combined ingredient name</label>
          <input className="input" value={canonicalName} onChange={e => setCanonicalName(e.target.value)} />
        </div>

        {/* Unit — only editable if units differ */}
        {!unitsMatch && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Unit</label>
            <input className="input" value={unit} onChange={e => setUnit(e.target.value)} placeholder="e.g. g" />
          </div>
        )}

        {/* Permanent toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={permanent}
            onChange={e => setPermanent(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--color-brand)', cursor: 'pointer' }}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Save permanently</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
              Future imports will automatically merge these ingredients
            </div>
          </div>
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!canonicalName || isPending}
            onClick={() => onConfirm(canonicalName, unit, permanent)}
          >
            {isPending ? 'Merging...' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}
