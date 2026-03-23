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
