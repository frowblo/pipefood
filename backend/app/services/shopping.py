"""
Shopping list aggregation service.

This is the core logic of the app:
1. Collect all ingredients across every planned meal, scaled to servings
2. Aggregate duplicates (same ingredient used in multiple meals → one line)
3. Deduct what's already in the pantry
4. Round up to pack sizes to determine how many packs to buy
5. Calculate leftover quantities for waste tracking
"""
import math
from collections import defaultdict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.models import (
    MealPlan, PlannedMeal, RecipeIngredient,
    PantryItem, ShoppingList, ShoppingListItem, Ingredient
)


async def generate_shopping_list(plan_id: int, db: AsyncSession) -> ShoppingList:
    """Generate an aggregated shopping list for a meal plan."""

    # Load plan with all nested relations in one query
    result = await db.execute(
        select(MealPlan)
        .options(
            selectinload(MealPlan.meals)
            .selectinload(PlannedMeal.recipe)
            .selectinload(Recipe.ingredients)
            .selectinload(RecipeIngredient.ingredient)
        )
        .where(MealPlan.id == plan_id)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise ValueError(f"Plan {plan_id} not found")

    # Step 1: aggregate ingredient quantities across all meals
    # key: ingredient_id  value: {qty, unit, meal_names}
    aggregated: dict[int, dict] = defaultdict(lambda: {"qty": 0.0, "unit": "", "meals": []})

    for meal in plan.meals:
        scale = meal.servings / meal.recipe.base_servings
        for ri in meal.recipe.ingredients:
            agg = aggregated[ri.ingredient_id]
            agg["qty"] += ri.quantity * scale
            agg["unit"] = ri.unit  # assume consistent units per ingredient
            agg["ingredient"] = ri.ingredient
            agg["meals"].append(meal.recipe.name)

    # Step 2: load current pantry stock
    pantry_result = await db.execute(
        select(PantryItem).where(
            PantryItem.ingredient_id.in_(aggregated.keys())
        )
    )
    pantry_by_ingredient = {p.ingredient_id: p for p in pantry_result.scalars()}

    # Step 3: build shopping list items
    shopping_list = ShoppingList(plan_id=plan_id)
    db.add(shopping_list)

    for ingredient_id, data in aggregated.items():
        ingredient: Ingredient = data["ingredient"]
        qty_needed = data["qty"]
        unit = data["unit"]

        # Deduct pantry stock
        pantry = pantry_by_ingredient.get(ingredient_id)
        pantry_qty = pantry.quantity if pantry else 0.0
        qty_after_pantry = max(0.0, qty_needed - pantry_qty)

        from_pantry = qty_after_pantry == 0.0

        # Round up to pack sizes
        if ingredient.pack_size and ingredient.pack_size > 0 and not from_pantry:
            packs = math.ceil(qty_after_pantry / ingredient.pack_size)
            qty_to_buy = packs * ingredient.pack_size
            leftover = qty_to_buy - qty_after_pantry
        else:
            packs = None
            qty_to_buy = qty_after_pantry
            leftover = 0.0

        item = ShoppingListItem(
            ingredient_id=ingredient_id,
            quantity_needed=round(qty_needed, 2),
            quantity_to_buy=round(qty_to_buy, 2),
            unit=unit,
            packs_to_buy=packs,
            leftover_quantity=round(leftover, 2),
            from_pantry=from_pantry,
        )
        shopping_list.items.append(item)

    await db.commit()
    await db.refresh(shopping_list)
    return shopping_list


# Avoid circular import — import Recipe inside function scope
from app.models.models import Recipe  # noqa: E402
