/**
 * WoolworthsPanel
 *
 * Two-phase component:
 * 1. Match phase — show each shopping list item alongside its best Woolworths
 *    product match. User can accept, change, or manually search per item.
 * 2. Cart phase — all items confirmed. Desktop: inject cart. Mobile: download image.
 */
import { useState, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  woolworthsApi, WoolworthsProduct, ShoppingItemMatch, ListMatchResult, ShoppingList
} from '../lib/api'

interface Props {
  shoppingList: ShoppingList
  onClose: () => void
}

export default function WoolworthsPanel({ shoppingList, onClose }: Props) {
  const [phase, setPhase] = useState<'matching' | 'review' | 'ready'>('matching')
  const [matchResult, setMatchResult] = useState<ListMatchResult | null>(null)
  // Per-item decisions: item_id -> { confirmed product, packs }
  const [decisions, setDecisions] = useState<Record<number, { product: WoolworthsProduct; packs: number } | null>>({})
  const [searchingFor, setSearchingFor] = useState<number | null>(null) // item_id being manually searched
  const [searchQuery, setSearchQuery] = useState('')
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  // Step 1: run matching
  const matchMutation = useMutation({
    mutationFn: () => woolworthsApi.matchList(shoppingList.id),
    onSuccess: (data) => {
      setMatchResult(data)
      // Pre-populate decisions from confirmed/existing mappings
      const initial: Record<number, { product: WoolworthsProduct; packs: number } | null> = {}
      for (const m of data.matches) {
        if (m.best_match && m.confirmed) {
          initial[m.shopping_list_item_id] = { product: m.best_match, packs: m.packs_to_buy }
        } else if (m.best_match) {
          initial[m.shopping_list_item_id] = { product: m.best_match, packs: m.packs_to_buy }
        } else {
          initial[m.shopping_list_item_id] = null
        }
      }
      setDecisions(initial)
      setPhase('review')
    },
  })

  // Step 2: save confirmed mappings
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!matchResult) return Promise.resolve()
      const mappings = matchResult.matches
        .filter(m => decisions[m.shopping_list_item_id] != null)
        .map(m => {
          const d = decisions[m.shopping_list_item_id]!
          // Find ingredient_id from shopping list items
          const listItem = shoppingList.items.find(i => i.id === m.shopping_list_item_id)
          return {
            ingredient_id: listItem?.ingredient.id,
            stockcode: d.product.stockcode,
            product_name: d.product.name,
            product_brand: d.product.brand,
            pack_description: d.product.pack_description,
            pack_size_g: d.product.pack_size_g,
            pack_size_ml: d.product.pack_size_ml,
            price_aud: d.product.price,
            packs_to_buy: d.packs,
          }
        })
        .filter(m => m.ingredient_id != null)
      return woolworthsApi.saveMappings(mappings)
    },
    onSuccess: () => setPhase('ready'),
  })

  // Manual search
  const { data: searchResults, isFetching: searching } = useQuery({
    queryKey: ['woolworths-search', searchQuery],
    queryFn: () => woolworthsApi.search(searchQuery),
    enabled: searchQuery.length >= 2,
  })

  const allConfirmed = matchResult
    ? matchResult.matches.every(m => decisions[m.shopping_list_item_id] != null)
    : false

  const confirmedItems = matchResult
    ? matchResult.matches
        .filter(m => decisions[m.shopping_list_item_id] != null)
        .map(m => ({ match: m, decision: decisions[m.shopping_list_item_id]! }))
    : []

  // Desktop: generate and open cart injection page
  const handleDesktopCart = () => {
    const cartItems = confirmedItems.map(({ decision }) => ({
      Stockcode: parseInt(decision.product.stockcode),
      Quantity: decision.packs,
    }))

    const html = `<!DOCTYPE html>
<html>
<head><title>Adding to Woolworths cart...</title>
<style>
  body { font-family: sans-serif; padding: 40px; max-width: 500px; margin: 0 auto; }
  h2 { color: #007837; }
  .item { padding: 6px 0; border-bottom: 1px solid #eee; font-size: 14px; }
  .status { margin-top: 20px; padding: 12px; border-radius: 8px; font-size: 14px; }
  .loading { background: #f0f9f4; color: #007837; }
  .done { background: #e8f5e9; color: #2e7d32; }
  .error { background: #fff3e0; color: #e65100; }
</style>
</head>
<body>
<h2>Adding items to your Woolworths cart</h2>
<p style="color:#666;font-size:13px;">Make sure you're logged in to Woolworths. This page will close automatically when done.</p>
${cartItems.map(i => `<div class="item">Stockcode ${i.Stockcode} &times; ${i.Quantity}</div>`).join('')}
<div class="status loading" id="status">Adding items...</div>
<script>
async function addToCart() {
  const items = ${JSON.stringify(cartItems)};
  const status = document.getElementById('status');
  try {
    const resp = await fetch('https://www.woolworths.com.au/api/2/ui/page/cart', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://www.woolworths.com.au',
        'Referer': 'https://www.woolworths.com.au/',
      },
      body: JSON.stringify({ items })
    });
    if (resp.ok) {
      status.className = 'status done';
      status.textContent = 'Done! Redirecting to your cart...';
      setTimeout(() => {
        window.location.href = 'https://www.woolworths.com.au/shop/cart';
      }, 1500);
    } else {
      const err = await resp.text();
      status.className = 'status error';
      status.textContent = 'Cart update failed (status ' + resp.status + '). Are you logged in to Woolworths? Try opening woolworths.com.au first, then come back to this page.';
      console.error(err);
    }
  } catch(e) {
    status.className = 'status error';
    status.textContent = 'Network error: ' + e.message + '. Make sure you are logged in to woolworths.com.au in this browser.';
  }
}
addToCart();
</script>
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
  }

  // Mobile: generate and download shopping list image
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const handleDownloadImage = () => {
    const canvas = document.createElement('canvas')
    const scale = 2 // retina
    const width = 600
    const lineH = 44
    const padX = 40
    const headerH = 140
    const footerH = 60
    const items = confirmedItems

    canvas.width = width * scale
    canvas.height = (headerH + items.length * lineH + footerH) * scale
    canvas.style.width = `${width}px`
    canvas.style.height = `${headerH + items.length * lineH + footerH}px`

    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)

    // White background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, canvas.height / scale)

    // Header
    ctx.fillStyle = '#007837'
    ctx.fillRect(0, 0, width, 8)

    ctx.fillStyle = '#007837'
    ctx.font = 'bold 28px Arial'
    ctx.fillText('Woolworths Shopping List', padX, 55)

    ctx.fillStyle = '#444'
    ctx.font = '16px Arial'
    const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    ctx.fillText(date, padX, 85)

    ctx.fillStyle = '#ccc'
    ctx.fillRect(padX, 105, width - padX * 2, 1)

    // Items
    items.forEach(({ match, decision }, i) => {
      const y = headerH + i * lineH
      const isEven = i % 2 === 0
      if (isEven) {
        ctx.fillStyle = '#f9f9f9'
        ctx.fillRect(0, y, width, lineH)
      }

      // Product name
      ctx.fillStyle = '#111'
      ctx.font = '15px Arial'
      const productName = decision.product.display_name
      // Truncate if too long
      const maxWidth = width - padX * 2 - 80
      let name = productName
      while (ctx.measureText(name).width > maxWidth && name.length > 10) {
        name = name.slice(0, -1)
      }
      if (name !== productName) name += '…'
      ctx.fillText(name, padX, y + 27)

      // Pack count
      ctx.fillStyle = '#007837'
      ctx.font = 'bold 15px Arial'
      ctx.textAlign = 'right'
      ctx.fillText(`× ${decision.packs}`, width - padX, y + 27)
      ctx.textAlign = 'left'
    })

    // Footer
    const footerY = headerH + items.length * lineH + 20
    ctx.fillStyle = '#999'
    ctx.font = '12px Arial'
    ctx.fillText(`Generated by PipeFood · ${items.length} items`, padX, footerY)

    ctx.fillStyle = '#007837'
    ctx.fillRect(0, canvas.height / scale - 8, width, 8)

    // Download
    const link = document.createElement('a')
    link.download = `woolworths-list-${new Date().toISOString().slice(0, 10)}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
        width: '100%', maxWidth: 640, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: '#007837',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="white" strokeWidth="1.8"/>
              <path d="M3 6h18M16 10a4 4 0 01-8 0" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 15 }}>
              {phase === 'matching' ? 'Match to Woolworths' :
               phase === 'review' ? 'Review matches' : 'Ready to shop'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
              {phase === 'matching' ? 'Find Woolworths products for each item on your list' :
               phase === 'review' ? `${Object.values(decisions).filter(Boolean).length} of ${matchResult?.matches.length} matched` :
               `${confirmedItems.length} items confirmed`}
            </div>
          </div>
          <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 13 }} onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Phase: matching */}
          {phase === 'matching' && (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state-title">Match to Woolworths catalogue</div>
              <div className="empty-state-body">
                We'll search Woolworths for the best product match for each item on your list.
                Previously matched items will load instantly.
              </div>
              <button className="btn btn-primary" onClick={() => matchMutation.mutate()}
                disabled={matchMutation.isPending}>
                {matchMutation.isPending ? 'Searching...' : 'Find products'}
              </button>
              {matchMutation.isError && (
                <div style={{ fontSize: 12, color: 'var(--color-red)', marginTop: 12 }}>
                  Search failed. Check your connection and try again.
                </div>
              )}
            </div>
          )}

          {/* Phase: review */}
          {phase === 'review' && matchResult && (
            <>
              {matchResult.matches.map(match => {
                const decision = decisions[match.shopping_list_item_id]
                const isSearching = searchingFor === match.shopping_list_item_id

                return (
                  <div key={match.shopping_list_item_id} style={{
                    border: `1px solid ${decision ? 'var(--color-border)' : 'var(--color-border-strong)'}`,
                    borderRadius: 'var(--radius-lg)', overflow: 'hidden',
                    background: decision ? 'var(--color-surface)' : 'var(--color-surface-subtle)',
                  }}>
                    {/* Item header */}
                    <div style={{
                      padding: '8px 12px', background: 'var(--color-surface-subtle)',
                      borderBottom: '1px solid var(--color-border)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
                        {match.ingredient_name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                        need {match.quantity_to_buy} {match.unit}
                      </span>
                      {match.existing_mapping && (
                        <span className="badge badge-green" style={{ fontSize: 9 }}>saved</span>
                      )}
                    </div>

                    {/* Matched product */}
                    {decision && !isSearching && (
                      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                            {decision.product.display_name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                            {decision.product.pack_description}
                            {decision.product.price && ` · $${decision.product.price.toFixed(2)}`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button style={{
                            border: '1px solid var(--color-border-strong)', background: 'none',
                            borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 12,
                          }} onClick={() => {
                            const newPacks = Math.max(1, decision.packs - 1)
                            setDecisions(d => ({ ...d, [match.shopping_list_item_id]: { ...decision, packs: newPacks } }))
                          }}>−</button>
                          <span style={{ fontSize: 13, minWidth: 30, textAlign: 'center' }}>
                            ×{decision.packs}
                          </span>
                          <button style={{
                            border: '1px solid var(--color-border-strong)', background: 'none',
                            borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 12,
                          }} onClick={() => {
                            setDecisions(d => ({ ...d, [match.shopping_list_item_id]: { ...decision, packs: decision.packs + 1 } }))
                          }}>+</button>
                        </div>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() => { setSearchingFor(match.shopping_list_item_id); setSearchQuery(match.ingredient_name) }}>
                          Change
                        </button>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--color-text-tertiary)' }}
                          onClick={() => setDecisions(d => ({ ...d, [match.shopping_list_item_id]: null }))}>
                          Skip
                        </button>
                      </div>
                    )}

                    {/* No match found */}
                    {!decision && !isSearching && (
                      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-tertiary)' }}>No match found</span>
                        <button className="btn btn-ghost" style={{ fontSize: 11 }}
                          onClick={() => { setSearchingFor(match.shopping_list_item_id); setSearchQuery(match.ingredient_name) }}>
                          Search manually
                        </button>
                      </div>
                    )}

                    {/* Manual search */}
                    {isSearching && (
                      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <input className="input" value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          placeholder="Search Woolworths..." autoFocus />
                        {searching && <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Searching...</div>}
                        {searchResults?.map(product => (
                          <div key={product.stockcode}
                            onClick={() => {
                              // Calculate packs for this product
                              const { _calculate_packs_js } = { _calculate_packs_js: (qty: number, unit: string, g?: number, ml?: number) => {
                                const CUPS_TO_ML = 250, TSP_TO_ML = 5, TBSP_TO_ML = 15
                                let neededG, neededMl
                                if (unit === 'g') neededG = qty
                                else if (unit === 'kg') neededG = qty * 1000
                                else if (unit === 'ml') neededMl = qty
                                else if (unit === 'l') neededMl = qty * 1000
                                else if (unit === 'cups') neededMl = qty * CUPS_TO_ML
                                else if (unit === 'tsp') neededMl = qty * TSP_TO_ML
                                else if (unit === 'tbsp') neededMl = qty * TBSP_TO_ML
                                if (neededG && g) return Math.max(1, Math.ceil(neededG / g))
                                if (neededMl && ml) return Math.max(1, Math.ceil(neededMl / ml))
                                return 1
                              }}
                              const packs = _calculate_packs_js(match.quantity_to_buy, match.unit, product.pack_size_g, product.pack_size_ml)
                              setDecisions(d => ({ ...d, [match.shopping_list_item_id]: { product, packs } }))
                              setSearchingFor(null)
                            }}
                            style={{
                              padding: '8px 10px', border: '1px solid var(--color-border)',
                              borderRadius: 'var(--radius-md)', cursor: 'pointer',
                              background: 'var(--color-surface)',
                            }}
                          >
                            <div style={{ fontSize: 13 }}>{product.display_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                              {product.pack_description}
                              {product.price && ` · $${product.price.toFixed(2)}`}
                            </div>
                          </div>
                        ))}
                        <button className="btn btn-ghost" style={{ fontSize: 11, alignSelf: 'flex-start' }}
                          onClick={() => setSearchingFor(null)}>
                          Cancel
                        </button>
                      </div>
                    )}

                    {/* Alternatives */}
                    {!isSearching && decision && match.alternatives.length > 0 && !match.existing_mapping && (
                      <div style={{ padding: '4px 12px 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {match.alternatives.slice(0, 3).map(alt => (
                          <button key={alt.stockcode}
                            onClick={() => {
                              const packs = 1
                              setDecisions(d => ({ ...d, [match.shopping_list_item_id]: { product: alt, packs } }))
                            }}
                            style={{
                              fontSize: 10, padding: '3px 8px', border: '1px solid var(--color-border)',
                              borderRadius: 20, background: 'transparent', cursor: 'pointer',
                              color: 'var(--color-text-secondary)',
                            }}>
                            {alt.display_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {/* Phase: ready */}
          {phase === 'ready' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {confirmedItems.map(({ match, decision }) => (
                <div key={match.shopping_list_item_id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)', fontSize: 13,
                }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: 'var(--color-text-primary)' }}>{decision.product.display_name}</span>
                    {decision.product.pack_description && (
                      <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginLeft: 6 }}>
                        {decision.product.pack_description}
                      </span>
                    )}
                  </div>
                  <span style={{ fontWeight: 500, color: '#007837' }}>×{decision.packs}</span>
                  {decision.product.price && (
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      ${(decision.product.price * decision.packs).toFixed(2)}
                    </span>
                  )}
                </div>
              ))}

              {/* Estimated total */}
              {confirmedItems.some(({ decision }) => decision.product.price) && (
                <div style={{
                  padding: '10px 12px', background: 'var(--color-surface-subtle)',
                  borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between',
                  fontSize: 13, fontWeight: 500,
                }}>
                  <span>Estimated total</span>
                  <span style={{ color: '#007837' }}>
                    ${confirmedItems.reduce((sum, { decision }) =>
                      sum + (decision.product.price ?? 0) * decision.packs, 0
                    ).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--color-border)',
          display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0,
          flexWrap: 'wrap',
        }}>
          {phase === 'review' && (
            <>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!allConfirmed || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
                style={{ background: '#007837', borderColor: '#007837' }}
              >
                {saveMutation.isPending ? 'Saving...' : 'Confirm matches →'}
              </button>
            </>
          )}

          {phase === 'ready' && (
            <>
              <button className="btn" onClick={() => setPhase('review')}>← Back</button>
              {!isMobile && (
                <button
                  onClick={handleDesktopCart}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '8px 18px', borderRadius: 'var(--radius-md)',
                    background: '#007837', color: '#fff', border: 'none',
                    fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  Open in Woolworths →
                </button>
              )}
              {isMobile && (
                <button
                  onClick={handleDownloadImage}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '8px 18px', borderRadius: 'var(--radius-md)',
                    background: '#007837', color: '#fff', border: 'none',
                    fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  Download shopping list image
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
