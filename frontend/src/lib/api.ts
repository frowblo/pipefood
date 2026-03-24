import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// --- Types mirroring backend schemas ---

export type IngredientCategory =
  | 'produce' | 'meat' | 'seafood' | 'dairy'
  | 'dry_goods' | 'condiments' | 'frozen' | 'bakery' | 'other'

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface Ingredient {
  id: number
  name: string
  category: IngredientCategory
  default_unit: string
  pack_size?: number
  pack_unit?: string
  shelf_life_days?: number
}

export interface RecipeIngredient {
  id: number
  ingredient: Ingredient
  quantity: number
  unit: string
  notes?: string
}

export interface Recipe {
  id: number
  name: string
  description?: string
  source_url?: string
  prep_minutes?: number
  cook_minutes?: number
  base_servings: number
  instructions?: string
  created_at: string
  ingredients: RecipeIngredient[]
}

export interface PlannedMeal {
  id: number
  recipe_id: number
  recipe: Recipe
  planned_date: string
  meal_type: MealType
  servings: number
  cooked: boolean
}

export interface MealPlan {
  id: number
  name: string
  week_start: string
  created_at: string
  meals: PlannedMeal[]
}

export interface PantryItem {
  id: number
  ingredient: Ingredient
  quantity: number
  unit: string
  expiry_date?: string
  updated_at: string
}

export interface ShoppingListItem {
  id: number
  ingredient: Ingredient
  quantity_needed: number
  quantity_to_buy: number
  unit: string
  packs_to_buy?: number
  leftover_quantity?: number
  checked: boolean
  from_pantry: boolean
}

export interface ShoppingList {
  id: number
  plan_id: number
  generated_at: string
  items: ShoppingListItem[]
}

// --- API calls ---

export interface AliasSuggestion {
  raw_name: string
  canonical_name: string
  reason: string
}

export interface ConsolidationSuggestion {
  source_names: string[]
  consolidated_name: string
  reason: string
}

export interface RecipePreview {
  parsed: any
  alias_suggestions: AliasSuggestion[]
  consolidation_suggestions: ConsolidationSuggestion[]
  auto_applied_aliases: string[]
}

export interface AliasDecision {
  raw_name: string
  canonical_name: string
  confirmed: boolean
}

export interface ConsolidationDecision {
  source_names: string[]
  consolidated_name: string
  confirmed: boolean
}

export interface ConfirmImportRequest {
  parsed: any
  alias_decisions: AliasDecision[]
  consolidation_decisions: ConsolidationDecision[]
}

export const recipesApi = {
  list: () => api.get<Recipe[]>('/recipes').then(r => r.data),
  get: (id: number) => api.get<Recipe>(`/recipes/${id}`).then(r => r.data),
  create: (data: object) => api.post<Recipe>('/recipes', data).then(r => r.data),
  delete: (id: number) => api.delete(`/recipes/${id}`),
  importPreview: (url: string) => api.post<RecipePreview>('/recipes/import/preview', { url }).then(r => r.data),
  importConfirm: (body: ConfirmImportRequest) => api.post<Recipe>('/recipes/import/confirm', body).then(r => r.data),
}

export const plansApi = {
  list: () => api.get<MealPlan[]>('/plans').then(r => r.data),
  get: (id: number) => api.get<MealPlan>(`/plans/${id}`).then(r => r.data),
  create: (data: { name: string; week_start: string }) =>
    api.post<MealPlan>('/plans', data).then(r => r.data),
  addMeal: (planId: number, data: object) =>
    api.post<PlannedMeal>(`/plans/${planId}/meals`, data).then(r => r.data),
  removeMeal: (planId: number, mealId: number) =>
    api.delete(`/plans/${planId}/meals/${mealId}`),
  markCooked: (planId: number, mealId: number) =>
    api.patch<PlannedMeal>(`/plans/${planId}/meals/${mealId}/cooked`).then(r => r.data),
  updateMealServings: (planId: number, mealId: number, servings: number) =>
    api.patch<PlannedMeal>(`/plans/${planId}/meals/${mealId}`, { servings }).then(r => r.data),
}

export const shoppingApi = {
  generate: (planId: number) =>
    api.post<ShoppingList>(`/shopping/generate/${planId}`).then(r => r.data),
  get: (planId: number) =>
    api.get<ShoppingList>(`/shopping/${planId}`).then(r => r.data),
  checkItem: (itemId: number) =>
    api.patch<{ id: number; checked: boolean }>(`/shopping/items/${itemId}/check`).then(r => r.data),
  markInStock: (itemId: number, quantity: number, unit: string, expiry_date?: string) =>
    api.post<{ id: number; checked: boolean; from_pantry: boolean }>(
      `/shopping/items/${itemId}/mark-in-stock`,
      { quantity, unit, expiry_date }
    ).then(r => r.data),
  markOutOfStock: (itemId: number) =>
    api.post<{ id: number; checked: boolean; from_pantry: boolean }>(
      `/shopping/items/${itemId}/mark-out-of-stock`
    ).then(r => r.data),
}

export const pantryApi = {
  list: () => api.get<PantryItem[]>('/pantry').then(r => r.data),
  upsert: (data: object) => api.put<PantryItem>('/pantry', data).then(r => r.data),
  delete: (id: number) => api.delete(`/pantry/${id}`),
}
