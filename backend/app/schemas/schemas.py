from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel

from app.models.models import IngredientCategory, MealType


# --- Ingredient ---

class IngredientBase(BaseModel):
    name: str
    category: IngredientCategory = IngredientCategory.other
    default_unit: str = "g"
    pack_size: Optional[float] = None
    pack_unit: Optional[str] = None
    shelf_life_days: Optional[int] = None

class IngredientCreate(IngredientBase):
    pass

class IngredientOut(IngredientBase):
    id: int
    model_config = {"from_attributes": True}


# --- Recipe ---

class RecipeIngredientIn(BaseModel):
    # Claude returns 'name'; manual creation uses 'ingredient_name' — accept both
    ingredient_name: str
    quantity: float
    unit: str
    notes: Optional[str] = None

    group: Optional[str] = None
    category: Optional[str] = None  # passed through to Ingredient on save

    model_config = {"populate_by_name": True}

    def __init__(self, **data):
        # Remap 'name' -> 'ingredient_name' if coming from AI extraction
        if "name" in data and "ingredient_name" not in data:
            data["ingredient_name"] = data.pop("name")
        super().__init__(**data)

class RecipeIngredientOut(BaseModel):
    id: int
    ingredient: IngredientOut
    quantity: float
    unit: str
    notes: Optional[str]
    group: Optional[str] = None
    model_config = {"from_attributes": True}

class RecipeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    source_url: Optional[str] = None
    prep_minutes: Optional[int] = None
    cook_minutes: Optional[int] = None
    base_servings: int = 2
    instructions: Optional[str] = None
    ingredients: list[RecipeIngredientIn] = []
    calories: Optional[int] = None
    protein_g: Optional[float] = None
    fibre_g: Optional[float] = None

class RecipeOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    source_url: Optional[str]
    prep_minutes: Optional[int]
    cook_minutes: Optional[int]
    base_servings: int
    instructions: Optional[str]
    created_at: datetime
    ingredients: list[RecipeIngredientOut] = []
    calories: Optional[int] = None
    protein_g: Optional[float] = None
    fibre_g: Optional[float] = None
    model_config = {"from_attributes": True}


# --- Meal Plan ---

class PlannedMealCreate(BaseModel):
    recipe_id: int
    planned_date: date
    meal_type: MealType = MealType.dinner
    servings: int = 2

class PlannedMealOut(BaseModel):
    id: int
    recipe_id: int
    recipe: RecipeOut
    planned_date: date
    meal_type: MealType
    servings: int
    cooked: bool
    model_config = {"from_attributes": True}

class MealPlanCreate(BaseModel):
    name: str
    week_start: date

class MealPlanOut(BaseModel):
    id: int
    name: str
    week_start: date
    created_at: datetime
    meals: list[PlannedMealOut] = []
    model_config = {"from_attributes": True}


# --- Pantry ---

class PantryItemCreate(BaseModel):
    ingredient_id: int
    quantity: float
    unit: str
    expiry_date: Optional[date] = None

class PantryItemOut(BaseModel):
    id: int
    ingredient: IngredientOut
    quantity: float
    unit: str
    expiry_date: Optional[date]
    updated_at: datetime
    model_config = {"from_attributes": True}


# --- Shopping List ---

class ShoppingListItemOut(BaseModel):
    id: int
    ingredient: IngredientOut
    quantity_needed: float
    quantity_to_buy: float
    unit: str
    packs_to_buy: Optional[int]
    leftover_quantity: Optional[float]
    checked: bool
    from_pantry: bool
    model_config = {"from_attributes": True}

class ShoppingListOut(BaseModel):
    id: int
    plan_id: int
    generated_at: datetime
    items: list[ShoppingListItemOut] = []
    model_config = {"from_attributes": True}


# --- AI Import ---

class ImportUrlRequest(BaseModel):
    url: str


class AliasSuggestion(BaseModel):
    raw_name: str
    canonical_name: str
    reason: str


class ConsolidationSuggestion(BaseModel):
    source_names: list[str]
    consolidated_name: str
    reason: str


class RecipePreview(BaseModel):
    parsed: dict
    alias_suggestions: list[AliasSuggestion] = []
    consolidation_suggestions: list[ConsolidationSuggestion] = []
    auto_applied_aliases: list[str] = []


class AliasDecision(BaseModel):
    raw_name: str
    canonical_name: str
    confirmed: bool


class ConsolidationDecision(BaseModel):
    source_names: list[str]
    consolidated_name: str
    confirmed: bool


class ConfirmImportRequest(BaseModel):
    parsed: dict
    alias_decisions: list[AliasDecision] = []
    consolidation_decisions: list[ConsolidationDecision] = []


# --- Woolworths matching ---

class WoolworthsProduct(BaseModel):
    stockcode: str
    name: str
    brand: Optional[str] = None
    price: Optional[float] = None
    pack_description: Optional[str] = None
    pack_size_g: Optional[float] = None
    pack_size_ml: Optional[float] = None
    display_name: str


class ShoppingItemMatch(BaseModel):
    shopping_list_item_id: int
    ingredient_name: str
    quantity_to_buy: float
    unit: str
    best_match: Optional[WoolworthsProduct] = None
    alternatives: list[WoolworthsProduct] = []
    packs_to_buy: int = 1
    confirmed: bool = False
    existing_mapping: bool = False  # True if loaded from saved mapping


class ListMatchResult(BaseModel):
    list_id: int
    matches: list[ShoppingItemMatch]


class ConfirmMappingRequest(BaseModel):
    ingredient_id: int
    stockcode: str
    product_name: str
    product_brand: Optional[str] = None
    pack_description: Optional[str] = None
    pack_size_g: Optional[float] = None
    pack_size_ml: Optional[float] = None
    price_aud: Optional[float] = None
    packs_to_buy: int


class CartItem(BaseModel):
    stockcode: str
    quantity: int
    product_name: str
