import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { addDays, startOfWeek, format, isSameDay, parseISO } from 'date-fns'
import { plansApi, recipesApi, MealPlan, Recipe, MealType } from '../lib/api'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner']

export default function PlannerPage() {
  const qc = useQueryClient()
  const [weekOffset, setWeekOffset] = useState(0)
  const [showAddMeal, setShowAddMeal] = useState<{ date: Date; type: MealType } | null>(null)

  // Week start (Monday)
  const weekStart = addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset * 7)
  const weekDays = DAYS.map((_, i) => addDays(weekStart, i))

  // Fetch or create plan for this week
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: plansApi.list })
  const currentPlan = plans?.find(p => p.week_start === format(weekStart, 'yyyy-MM-dd'))

  const createPlan = useMutation({
    mutationFn: () => plansApi.create({
      name: `Week of ${format(weekStart, 'MMM d, yyyy')}`,
      week_start: format(weekStart, 'yyyy-MM-dd'),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  })

  const removeMeal = useMutation({
    mutationFn: ({ mealId }: { mealId: number }) =>
      plansApi.removeMeal(currentPlan!.id, mealId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  })

  const updateServings = useMutation({
    mutationFn: ({ mealId, servings }: { mealId: number; servings: number }) =>
      plansApi.updateMealServings(currentPlan!.id, mealId, servings),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  })

  const mealsOnDay = (day: Date, type: MealType) =>
    currentPlan?.meals.filter(
      m => isSameDay(parseISO(m.planned_date), day) && m.meal_type === type
    ) ?? []

  const dayNutrition = (day: Date) => {
    const meals = currentPlan?.meals.filter(m => isSameDay(parseISO(m.planned_date), day)) ?? []
    if (meals.length === 0) return null
    const hasMissing = meals.some(m => m.recipe.calories == null)
    const calories = meals.reduce((sum, m) => sum + (m.recipe.calories ?? 0), 0)
    const protein = meals.reduce((sum, m) => sum + (m.recipe.protein_g ?? 0), 0)
    const fibre = meals.reduce((sum, m) => sum + (m.recipe.fibre_g ?? 0), 0)
    return { calories, protein, fibre, hasMissing, hasSomeData: meals.some(m => m.recipe.calories != null) }
  }

  const totalMeals = currentPlan?.meals.length ?? 0
  const uniqueIngredients = new Set(
    currentPlan?.meals.flatMap(m => m.recipe.ingredients.map(i => i.ingredient.id))
  ).size

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Meal planner</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost" onClick={() => setWeekOffset(w => w - 1)}>‹</button>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', minWidth: 160, textAlign: 'center' }}>
            {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
          </span>
          <button className="btn btn-ghost" onClick={() => setWeekOffset(w => w + 1)}>›</button>
          <button className="btn btn-ghost" onClick={() => setWeekOffset(0)}>Today</button>
        </div>
      </div>

      <div className="page-body">
        {/* Stats */}
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-value">{totalMeals}</div>
            <div className="stat-label">Meals planned</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{uniqueIngredients}</div>
            <div className="stat-label">Unique ingredients</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--color-brand)' }}>
              {7 - (currentPlan?.meals.filter(m => m.meal_type === 'dinner').length ?? 0)}
            </div>
            <div className="stat-label">Dinners to fill</div>
          </div>
        </div>

        {/* Week grid */}
        {!currentPlan && (
          <div className="empty-state">
            <div className="empty-state-title">No plan for this week yet</div>
            <div className="empty-state-body">Create a plan to start adding meals.</div>
            <button className="btn btn-primary" onClick={() => createPlan.mutate()}>
              Create plan
            </button>
          </div>
        )}

        {currentPlan && (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(7, minmax(90px, 1fr))`, gap: 4, minWidth: 700 }}>
              {/* Header row */}
              <div />
              {weekDays.map((day, i) => (
                <div key={i} style={{
                  textAlign: 'center', fontSize: 11, fontWeight: 500,
                  color: isSameDay(day, new Date()) ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                  paddingBottom: 6, borderBottom: '1px solid var(--color-border)'
                }}>
                  {DAYS[i]}<br />
                  <span style={{ fontSize: 13, fontWeight: isSameDay(day, new Date()) ? 500 : 400, color: 'var(--color-text-primary)' }}>
                    {format(day, 'd')}
                  </span>
                </div>
              ))}

              {/* Rows per meal type */}
              {MEAL_TYPES.map(type => (
                <>
                  <div key={`label-${type}`} style={{
                    fontSize: 10, fontWeight: 500, color: 'var(--color-text-tertiary)',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    display: 'flex', alignItems: 'flex-start', paddingTop: 8
                  }}>
                    {type}
                  </div>
                  {weekDays.map((day, di) => {
                    const meals = mealsOnDay(day, type)
                    return (
                      <div key={`${type}-${di}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
                        {meals.map(meal => (
                          <div key={meal.id} style={{
                            background: meal.cooked ? 'var(--color-surface-subtle)' : 'var(--color-brand-light)',
                            border: `1px solid ${meal.cooked ? 'var(--color-border)' : '#9FE1CB'}`,
                            borderRadius: 'var(--radius-md)',
                            padding: '5px 8px',
                            fontSize: 11,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
                              <div style={{ fontWeight: 500, color: meal.cooked ? 'var(--color-text-secondary)' : '#085041', lineHeight: 1.3, flex: 1 }}>
                                {meal.recipe.name}
                              </div>
                              <button
                                onClick={() => removeMeal.mutate({ mealId: meal.id })}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0F6E56', fontSize: 10, padding: 0, lineHeight: 1, flexShrink: 0 }}
                                title="Remove meal"
                              >
                                ✕
                              </button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                              <button
                                onClick={() => updateServings.mutate({ mealId: meal.id, servings: Math.max(1, meal.servings - 1) })}
                                style={{ background: 'none', border: '1px solid #9FE1CB', borderRadius: 3, cursor: 'pointer', color: '#0F6E56', fontSize: 10, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                              >−</button>
                              <span style={{ color: '#0F6E56', fontSize: 10, minWidth: 40, textAlign: 'center' }}>
                                {meal.servings} srv
                              </span>
                              <button
                                onClick={() => updateServings.mutate({ mealId: meal.id, servings: meal.servings + 1 })}
                                style={{ background: 'none', border: '1px solid #9FE1CB', borderRadius: 3, cursor: 'pointer', color: '#0F6E56', fontSize: 10, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                              >+</button>
                            </div>
                          </div>
                        ))}
                        <button
                          onClick={() => setShowAddMeal({ date: day, type })}
                          style={{
                            border: '1px dashed var(--color-border-strong)',
                            borderRadius: 'var(--radius-md)',
                            background: 'transparent',
                            padding: '5px 8px',
                            fontSize: 11,
                            color: 'var(--color-text-tertiary)',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          + add
                        </button>
                      </div>
                    )
                  })}
                </>
              ))}
              {/* Nutrition row */}
              <>
                <div style={{
                  fontSize: 9, fontWeight: 500, color: 'var(--color-text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  display: 'flex', alignItems: 'center', paddingTop: 8
                }}>
                  Nutrition
                </div>
                {weekDays.map((day, di) => {
                  const n = dayNutrition(day)
                  if (!n || !n.hasSomeData) return (
                    <div key={`nutr-${di}`} style={{ paddingTop: 6 }} />
                  )
                  return (
                    <div key={`nutr-${di}`} style={{
                      paddingTop: 6, fontSize: 10,
                      color: 'var(--color-text-secondary)',
                      display: 'flex', flexDirection: 'column', gap: 1,
                    }}>
                      <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
                        {n.calories} kcal
                      </div>
                      <div>{n.protein.toFixed(1)}g protein</div>
                      <div>{n.fibre.toFixed(1)}g fibre</div>
                      {n.hasMissing && (
                        <div title="One or more recipes are missing nutritional data"
                          style={{ color: 'var(--color-amber)', fontSize: 9, marginTop: 2, cursor: 'default' }}>
                          ⚠ incomplete
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            </div>
          </div>
        )}
      </div>

      {/* Add meal modal */}
      {showAddMeal && currentPlan && (
        <AddMealModal
          plan={currentPlan}
          date={showAddMeal.date}
          mealType={showAddMeal.type}
          onClose={() => setShowAddMeal(null)}
        />
      )}
    </div>
  )
}

function AddMealModal({ plan, date, mealType, onClose }: {
  plan: MealPlan; date: Date; mealType: MealType; onClose: () => void
}) {
  const qc = useQueryClient()
  const [servings, setServings] = useState(2)
  const [search, setSearch] = useState('')

  const { data: recipes } = useQuery({ queryKey: ['recipes'], queryFn: recipesApi.list })

  const filtered = recipes?.filter(r => r.name.toLowerCase().includes(search.toLowerCase())) ?? []

  const addMeal = useMutation({
    mutationFn: (recipe: Recipe) => plansApi.addMeal(plan.id, {
      recipe_id: recipe.id,
      planned_date: format(date, 'yyyy-MM-dd'),
      meal_type: mealType,
      servings,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plans'] })
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
        padding: 24, width: 420, maxHeight: '70vh', display: 'flex', flexDirection: 'column', gap: 16
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 500 }}>
            Add {mealType} — {format(date, 'EEE, MMM d')}
          </div>
          <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Search recipes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Servings</span>
            <input
              type="number" min={1} max={12} value={servings}
              onChange={e => setServings(+e.target.value)}
              className="input" style={{ width: 56 }}
            />
          </div>
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.length === 0 && (
            <div style={{ color: 'var(--color-text-tertiary)', fontSize: 13, padding: '12px 0' }}>
              No recipes found. Add some in the Recipes tab.
            </div>
          )}
          {filtered.map(recipe => (
            <button key={recipe.id} onClick={() => addMeal.mutate(recipe)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 12px', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', background: 'var(--color-surface)',
                cursor: 'pointer', textAlign: 'left',
              }}
              className="btn"
            >
              <span style={{ fontWeight: 500, fontSize: 13 }}>{recipe.name}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                {recipe.ingredients.length} ingredients · {recipe.base_servings} srv base
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
