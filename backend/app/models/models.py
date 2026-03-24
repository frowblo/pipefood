from datetime import datetime, date
from typing import Optional
from sqlalchemy import (
    String, Integer, Float, Boolean, Text, Date, DateTime,
    ForeignKey, Enum as SAEnum
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.db.session import Base


class IngredientCategory(str, enum.Enum):
    produce = "produce"
    meat = "meat"
    seafood = "seafood"
    dairy = "dairy"
    dry_goods = "dry_goods"
    condiments = "condiments"
    frozen = "frozen"
    bakery = "bakery"
    other = "other"


class MealType(str, enum.Enum):
    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"


class Ingredient(Base):
    """Canonical ingredient — e.g. 'chicken thigh', 'garlic'."""
    __tablename__ = "ingredients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    category: Mapped[IngredientCategory] = mapped_column(
        SAEnum(IngredientCategory), default=IngredientCategory.other
    )
    default_unit: Mapped[str] = mapped_column(String(20), default="g")
    # Pack size for wastage calculation — e.g. spinach sold in 500g bags
    pack_size: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pack_unit: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    shelf_life_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    recipe_ingredients: Mapped[list["RecipeIngredient"]] = relationship(back_populates="ingredient")
    pantry_items: Mapped[list["PantryItem"]] = relationship(back_populates="ingredient")


class Recipe(Base):
    """A single recipe."""
    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    prep_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cook_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    base_servings: Mapped[int] = mapped_column(Integer, default=2)
    instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Nutritional info per serving (as stated on the recipe page)
    calories: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    protein_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fibre_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="recipe", cascade="all, delete-orphan"
    )
    planned_meals: Mapped[list["PlannedMeal"]] = relationship(back_populates="recipe")


class RecipeIngredient(Base):
    """How much of an ingredient a recipe needs at base_servings."""
    __tablename__ = "recipe_ingredients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id"))
    ingredient_id: Mapped[int] = mapped_column(ForeignKey("ingredients.id"))
    quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(20))
    notes: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    # Ingredient group label from recipe (e.g. "Marinade", "For the sauce")
    group: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    recipe: Mapped["Recipe"] = relationship(back_populates="ingredients")
    ingredient: Mapped["Ingredient"] = relationship(back_populates="recipe_ingredients")


class MealPlan(Base):
    """A named week-based meal plan."""
    __tablename__ = "meal_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    week_start: Mapped[date] = mapped_column(Date, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    meals: Mapped[list["PlannedMeal"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan"
    )


class PlannedMeal(Base):
    """A recipe scheduled on a specific date in a plan."""
    __tablename__ = "planned_meals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("meal_plans.id"))
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id"))
    planned_date: Mapped[date] = mapped_column(Date)
    meal_type: Mapped[MealType] = mapped_column(SAEnum(MealType), default=MealType.dinner)
    servings: Mapped[int] = mapped_column(Integer, default=2)
    cooked: Mapped[bool] = mapped_column(Boolean, default=False)

    plan: Mapped["MealPlan"] = relationship(back_populates="meals")
    recipe: Mapped["Recipe"] = relationship(back_populates="planned_meals")


class PantryItem(Base):
    """Current stock of an ingredient in the pantry."""
    __tablename__ = "pantry_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ingredient_id: Mapped[int] = mapped_column(ForeignKey("ingredients.id"), unique=True)
    quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(20))
    expiry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    ingredient: Mapped["Ingredient"] = relationship(back_populates="pantry_items")


class ShoppingList(Base):
    """A generated shopping list for a meal plan."""
    __tablename__ = "shopping_lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("meal_plans.id"))
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    items: Mapped[list["ShoppingListItem"]] = relationship(
        back_populates="list", cascade="all, delete-orphan"
    )


class ShoppingListItem(Base):
    """One line on a shopping list, after pantry deduction."""
    __tablename__ = "shopping_list_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("shopping_lists.id"))
    ingredient_id: Mapped[int] = mapped_column(ForeignKey("ingredients.id"))
    quantity_needed: Mapped[float] = mapped_column(Float)   # after pantry deduction
    quantity_to_buy: Mapped[float] = mapped_column(Float)   # rounded to pack size
    unit: Mapped[str] = mapped_column(String(20))
    packs_to_buy: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    leftover_quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    from_pantry: Mapped[bool] = mapped_column(Boolean, default=False)

    list: Mapped["ShoppingList"] = relationship(back_populates="items")
    ingredient: Mapped["Ingredient"] = relationship()


class IngredientAlias(Base):
    """
    Maps a raw parsed name to a canonical ingredient name.
    e.g. "cooking salt" -> "Salt", "canola oil" -> "Oil"
    confirmed=True means auto-apply silently on future imports.
    confirmed=False means it was rejected by the user — never suggest again.
    pending aliases (suggested but not yet seen) are not stored here,
    they exist only in the review modal response.
    """
    __tablename__ = "ingredient_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    raw_name: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    canonical_name: Mapped[str] = mapped_column(String(200))
    confirmed: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class IngredientConsolidation(Base):
    """
    Records that two ingredient names share a physical source.
    e.g. "Lemon juice" + "Lemon zest" -> consolidated_name="Lemon (juice and zest)"
    Used to avoid asking the same consolidation question twice.
    """
    __tablename__ = "ingredient_consolidations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Comma-separated sorted list of ingredient names that were consolidated
    source_names: Mapped[str] = mapped_column(String(500), index=True)
    consolidated_name: Mapped[str] = mapped_column(String(200))
    confirmed: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
