from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.models import MealPlan, PlannedMeal, Recipe, RecipeIngredient, Ingredient
from app.schemas.schemas import MealPlanCreate, MealPlanOut, PlannedMealCreate, PlannedMealOut

router = APIRouter(prefix="/plans", tags=["plans"])

MEAL_LOAD_OPTIONS = [
    selectinload(MealPlan.meals)
    .selectinload(PlannedMeal.recipe)
    .selectinload(Recipe.ingredients)
    .selectinload(RecipeIngredient.ingredient)
]


@router.get("", response_model=list[MealPlanOut])
async def list_plans(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MealPlan).options(*MEAL_LOAD_OPTIONS).order_by(MealPlan.week_start.desc())
    )
    return result.scalars().all()


@router.post("", response_model=MealPlanOut, status_code=201)
async def create_plan(body: MealPlanCreate, db: AsyncSession = Depends(get_db)):
    plan = MealPlan(name=body.name, week_start=body.week_start)
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return plan


@router.get("/{plan_id}", response_model=MealPlanOut)
async def get_plan(plan_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MealPlan).options(*MEAL_LOAD_OPTIONS).where(MealPlan.id == plan_id)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(404, "Plan not found")
    return plan


@router.post("/{plan_id}/meals", response_model=PlannedMealOut, status_code=201)
async def add_meal(plan_id: int, body: PlannedMealCreate, db: AsyncSession = Depends(get_db)):
    # Verify plan and recipe exist
    plan = await db.get(MealPlan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    recipe = await db.get(Recipe, body.recipe_id)
    if not recipe:
        raise HTTPException(404, "Recipe not found")

    meal = PlannedMeal(
        plan_id=plan_id,
        recipe_id=body.recipe_id,
        planned_date=body.planned_date,
        meal_type=body.meal_type,
        servings=body.servings,
    )
    db.add(meal)
    await db.commit()

    # Reload with relations for response
    result = await db.execute(
        select(PlannedMeal)
        .options(
            selectinload(PlannedMeal.recipe)
            .selectinload(Recipe.ingredients)
            .selectinload(RecipeIngredient.ingredient)
        )
        .where(PlannedMeal.id == meal.id)
    )
    return result.scalar_one()


@router.delete("/{plan_id}/meals/{meal_id}", status_code=204)
async def remove_meal(plan_id: int, meal_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PlannedMeal).where(PlannedMeal.id == meal_id, PlannedMeal.plan_id == plan_id)
    )
    meal = result.scalar_one_or_none()
    if not meal:
        raise HTTPException(404, "Meal not found")
    await db.delete(meal)
    await db.commit()


@router.patch("/{plan_id}/meals/{meal_id}/cooked", response_model=PlannedMealOut)
async def mark_cooked(plan_id: int, meal_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PlannedMeal).where(PlannedMeal.id == meal_id, PlannedMeal.plan_id == plan_id)
    )
    meal = result.scalar_one_or_none()
    if not meal:
        raise HTTPException(404, "Meal not found")
    meal.cooked = True
    await db.commit()
    await db.refresh(meal)
    return meal
