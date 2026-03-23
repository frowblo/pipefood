import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pantryApi, recipesApi, PantryItem } from '../lib/api'
import { format, parseISO, isPast, isWithinInterval, addDays } from 'date-fns'

export default function PantryPage() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)

  const { data: pantry, isLoading } = useQuery({
    queryKey: ['pantry'],
    queryFn: pantryApi.list,
  })

  const deleteItem = useMutation({
    mutationFn: pantryApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pantry'] }),
  })

  const expiringSoon = pantry?.filter(p => {
    if (!p.expiry_date) return false
    const exp = parseISO(p.expiry_date)
    return isWithinInterval(exp, { start: new Date(), end: addDays(new Date(), 3) })
  }) ?? []

  const expired = pantry?.filter(p => {
    if (!p.expiry_date) return false
    return isPast(parseISO(p.expiry_date))
  }) ?? []

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Pantry</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add item</button>
      </div>

      <div className="page-body">
        {/* Alerts */}
        {expired.length > 0 && (
          <div style={{
            background: 'var(--color-red-light)', border: '1px solid #F09595',
            borderRadius: 'var(--radius-md)', padding: '10px 14px',
            fontSize: 12, color: 'var(--color-red)', marginBottom: 16
          }}>
            <strong>Expired:</strong>{' '}
            {expired.map(p => p.ingredient.name).join(', ')}
          </div>
        )}
        {expiringSoon.length > 0 && (
          <div style={{
            background: 'var(--color-amber-light)', border: '1px solid #FAC775',
            borderRadius: 'var(--radius-md)', padding: '10px 14px',
            fontSize: 12, color: 'var(--color-amber)', marginBottom: 16
          }}>
            <strong>Expiring within 3 days:</strong>{' '}
            {expiringSoon.map(p => `${p.ingredient.name} (${format(parseISO(p.expiry_date!), 'MMM d')})`).join(', ')}
          </div>
        )}

        {/* Stats */}
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-value">{pantry?.length ?? 0}</div>
            <div className="stat-label">Items tracked</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: expired.length > 0 ? 'var(--color-red)' : 'var(--color-text-tertiary)' }}>
              {expired.length}
            </div>
            <div className="stat-label">Expired</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: expiringSoon.length > 0 ? 'var(--color-amber)' : 'var(--color-text-tertiary)' }}>
              {expiringSoon.length}
            </div>
            <div className="stat-label">Expiring soon</div>
          </div>
        </div>

        {/* Pantry table */}
        {isLoading && (
          <div style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>Loading...</div>
        )}
        {!isLoading && (!pantry || pantry.length === 0) && (
          <div className="empty-state">
            <div className="empty-state-title">Pantry is empty</div>
            <div className="empty-state-body">
              Track what you have on hand — the shopping list will deduct pantry stock automatically.
            </div>
          </div>
        )}
        {pantry && pantry.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {pantry.map((item, i) => {
              const isExpired = item.expiry_date && isPast(parseISO(item.expiry_date))
              const isExpiring = item.expiry_date && !isExpired &&
                isWithinInterval(parseISO(item.expiry_date), { start: new Date(), end: addDays(new Date(), 3) })

              return (
                <div key={item.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                  borderBottom: i < pantry.length - 1 ? '1px solid var(--color-border)' : 'none',
                  background: isExpired ? 'var(--color-red-light)' : 'var(--color-surface)',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                      {item.ingredient.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 1 }}>
                      {item.ingredient.category}
                    </div>
                  </div>

                  <div style={{ fontSize: 13, color: 'var(--color-text-primary)', minWidth: 80, textAlign: 'right' }}>
                    {item.quantity} {item.unit}
                  </div>

                  {item.expiry_date ? (
                    <span className={`badge ${isExpired ? 'badge-red' : isExpiring ? 'badge-amber' : 'badge-gray'}`}
                      style={{ minWidth: 70, justifyContent: 'center', fontSize: 10 }}>
                      {isExpired ? 'Expired' : format(parseISO(item.expiry_date), 'MMM d')}
                    </span>
                  ) : (
                    <span style={{ minWidth: 70 }} />
                  )}

                  <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--color-text-tertiary)' }}
                    onClick={() => deleteItem.mutate(item.id)}>
                    Remove
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add item modal */}
      {showAdd && (
        <AddPantryModal onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}

function AddPantryModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [ingredientId, setIngredientId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('g')
  const [expiry, setExpiry] = useState('')

  const { data: recipes } = useQuery({ queryKey: ['recipes'], queryFn: recipesApi.list })

  // Collect all known ingredients from recipes
  const knownIngredients = Object.values(
    (recipes ?? []).flatMap(r => r.ingredients.map(ri => ri.ingredient))
      .reduce((acc, ing) => { acc[ing.id] = ing; return acc }, {} as Record<number, any>)
  ).sort((a, b) => a.name.localeCompare(b.name))

  const upsert = useMutation({
    mutationFn: () => pantryApi.upsert({
      ingredient_id: +ingredientId,
      quantity: +quantity,
      unit,
      expiry_date: expiry || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pantry'] })
      onClose()
    },
  })

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
    }} onClick={onClose}>
      <div style={{
        background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
        padding: 28, width: 380, display: 'flex', flexDirection: 'column', gap: 14
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 500, fontSize: 15 }}>Add pantry item</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Ingredient</label>
          <select className="input select" value={ingredientId} onChange={e => setIngredientId(e.target.value)}>
            <option value="">Select an ingredient...</option>
            {knownIngredients.map((ing: any) => (
              <option key={ing.id} value={ing.id}>{ing.name}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Quantity</label>
            <input type="number" className="input" placeholder="0" value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Unit</label>
            <input className="input" placeholder="g" value={unit} onChange={e => setUnit(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Expiry date (optional)</label>
          <input type="date" className="input" value={expiry} onChange={e => setExpiry(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary"
            disabled={!ingredientId || !quantity || upsert.isPending}
            onClick={() => upsert.mutate()}>
            {upsert.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
