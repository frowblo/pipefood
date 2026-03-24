import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { plansApi, MealPlan, PlannedMeal } from '../lib/api'
import { format, startOfWeek, addDays, parseISO, isSameDay } from 'date-fns'

const CATEGORY_LABELS: Record<string, string> = {
  produce: 'Produce', meat: 'Meat', seafood: 'Seafood', dairy: 'Dairy',
  dry_goods: 'Dry goods', condiments: 'Condiments', frozen: 'Frozen',
  bakery: 'Bakery', other: 'Other',
}

const MEAL_TYPE_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']

function scaleQty(qty: number, servings: number, baseServings: number): string {
  const scaled = qty * (servings / baseServings)
  // Format nicely — avoid ugly floats like 0.6666
  if (scaled === Math.floor(scaled)) return String(scaled)
  // Round to 1 decimal for most things, but show fractions for small amounts
  const rounded = Math.round(scaled * 4) / 4  // nearest 0.25
  if (rounded === Math.floor(rounded)) return String(rounded)
  return rounded.toFixed(2).replace(/\.?0+$/, '')
}

export default function ThisWeekPage() {
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedMealId, setSelectedMealId] = useState<number | null>(null)

  const weekStart = addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset * 7)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: plansApi.list })

  const currentPlan = plans?.find(p => p.week_start === format(weekStart, 'yyyy-MM-dd'))

  // Collect all meals for the week sorted by date then meal type
  const meals: PlannedMeal[] = currentPlan?.meals.slice().sort((a, b) => {
    const dateDiff = parseISO(a.planned_date).getTime() - parseISO(b.planned_date).getTime()
    if (dateDiff !== 0) return dateDiff
    return MEAL_TYPE_ORDER.indexOf(a.meal_type) - MEAL_TYPE_ORDER.indexOf(b.meal_type)
  }) ?? []

  const selectedMeal = meals.find(m => m.id === selectedMealId) ?? meals[0] ?? null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: '100%' }}>
      {/* Left: meal list */}
      <div style={{ borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
        <div className="page-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h1 className="page-title">This week</h1>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setWeekOffset(w => w - 1)}>‹</button>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setWeekOffset(w => w + 1)}>›</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!currentPlan && (
            <div style={{ padding: 24, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              No meal plan for this week.
            </div>
          )}

          {meals.length > 0 && (() => {
            // Group by day for display
            let lastDate = ''
            return meals.map(meal => {
              const dateKey = meal.planned_date
              const showDateHeader = dateKey !== lastDate
              lastDate = dateKey
              const day = parseISO(meal.planned_date)
              const isSelected = meal.id === (selectedMeal?.id)

              return (
                <div key={meal.id}>
                  {showDateHeader && (
                    <div style={{
                      padding: '8px 16px 4px',
                      fontSize: 10, fontWeight: 500,
                      color: 'var(--color-text-tertiary)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      borderBottom: '1px solid var(--color-border)',
                      background: 'var(--color-surface-subtle)',
                    }}>
                      {format(day, 'EEEE d MMM')}
                    </div>
                  )}
                  <button
                    onClick={() => setSelectedMealId(meal.id)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '10px 16px',
                      background: isSelected ? 'var(--color-brand-light)' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--color-brand)' : '3px solid transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--color-border)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'capitalize', marginBottom: 2 }}>
                      {meal.meal_type}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                      {meal.recipe.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                      {meal.servings} serving{meal.servings !== 1 ? 's' : ''}
                      {meal.recipe.base_servings !== meal.servings && (
                        <span style={{ color: 'var(--color-brand)', marginLeft: 4 }}>
                          (base {meal.recipe.base_servings})
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              )
            })
          })()}
        </div>
      </div>

      {/* Right: scaled recipe card */}
      <div style={{ overflowY: 'auto' }}>
        {!selectedMeal && (
          <div className="empty-state" style={{ paddingTop: 80 }}>
            <div className="empty-state-title">No meals planned</div>
            <div className="empty-state-body">Add meals in the Planner to see scaled recipes here.</div>
          </div>
        )}

        {selectedMeal && (
          <RecipeCard meal={selectedMeal} />
        )}
      </div>
    </div>
  )
}

function RecipeCard({ meal }: { meal: PlannedMeal }) {
  const { recipe, servings } = meal
  const scale = servings / recipe.base_servings
  const isScaled = scale !== 1

  return (
    <div>
      <div className="page-header">
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{recipe.name}</h1>
          {recipe.description && (
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              {recipe.description}
            </div>
          )}
        </div>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Meta row */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {recipe.prep_minutes && (
            <span className="badge badge-gray">Prep {recipe.prep_minutes} min</span>
          )}
          {recipe.cook_minutes && (
            <span className="badge badge-gray">Cook {recipe.cook_minutes} min</span>
          )}
          <span className="badge badge-green">
            {servings} serving{servings !== 1 ? 's' : ''}
          </span>
          {isScaled && (
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              scaled from {recipe.base_servings}
            </span>
          )}
          {recipe.source_url && (
            <a href={recipe.source_url} target="_blank" rel="noreferrer"
              className="badge badge-gray" style={{ color: 'var(--color-brand)' }}>
              Source ↗
            </a>
          )}
        </div>

        {/* Scaled ingredients */}
        <div>
          <div style={{
            fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10
          }}>
            Ingredients
            {isScaled && (
              <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-brand)', marginLeft: 8, textTransform: 'none' }}>
                scaled to {servings} serving{servings !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {recipe.ingredients.map((ri, i) => {
              const scaledQty = scaleQty(ri.quantity, servings, recipe.base_servings)
              const changed = scale !== 1

              return (
                <div key={ri.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 16px',
                  borderBottom: i < recipe.ingredients.length - 1 ? '1px solid var(--color-border)' : 'none',
                }}>
                  <span className="badge badge-gray" style={{ fontSize: 9, minWidth: 64, justifyContent: 'center' }}>
                    {CATEGORY_LABELS[ri.ingredient.category] ?? ri.ingredient.category}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)' }}>
                    {ri.ingredient.name}
                    {ri.notes && (
                      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11, marginLeft: 6 }}>
                        {ri.notes}
                      </span>
                    )}
                  </span>
                  <span style={{
                    fontSize: 13,
                    color: changed ? 'var(--color-brand-dark)' : 'var(--color-text-secondary)',
                    fontWeight: changed ? 500 : 400,
                    minWidth: 80, textAlign: 'right',
                  }}>
                    {scaledQty} {ri.unit}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Instructions */}
        {recipe.instructions && (
          <div>
            <div style={{
              fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10
            }}>
              Method
            </div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {recipe.instructions.split('\n').filter(Boolean).map((step, i) => {
                const text = step.replace(/^\d+\.\s*/, '')
                const totalSteps = recipe.instructions!.split('\n').filter(Boolean).length
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
                    }}>
                      {i + 1}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--color-text-primary)', paddingTop: 2 }}>
                      {text}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
