from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.models import Recipe, RecipeIngredient, Ingredient
from app.schemas.schemas import RecipeCreate, RecipeOut, ImportUrlRequest
from app.services.ai_import import import_recipe_from_url

router = APIRouter(prefix="/recipes", tags=["recipes"])

# Reusable load options — always fetch ingredients + their ingredient in one query
RECIPE_LOAD = selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient)


async def get_or_create_ingredient(name: str, db: AsyncSession) -> Ingredient:
    """Find ingredient by name or create it if new."""
    result = await db.execute(
        select(Ingredient).where(Ingredient.name == name.lower().strip())
    )
    ingredient = result.scalar_one_or_none()
    if not ingredient:
        ingredient = Ingredient(name=name.lower().strip())
        db.add(ingredient)
        await db.flush()
    return ingredient


@router.get("", response_model=list[RecipeOut])
async def list_recipes(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Recipe).options(RECIPE_LOAD).order_by(Recipe.name)
    )
    return result.scalars().all()


@router.get("/{recipe_id}", response_model=RecipeOut)
async def get_recipe(recipe_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Recipe).options(RECIPE_LOAD).where(Recipe.id == recipe_id)
    )
    recipe = result.scalar_one_or_none()
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    return recipe


@router.post("", response_model=RecipeOut, status_code=201)
async def create_recipe(body: RecipeCreate, db: AsyncSession = Depends(get_db)):
    recipe = Recipe(
        name=body.name,
        description=body.description,
        source_url=body.source_url,
        prep_minutes=body.prep_minutes,
        cook_minutes=body.cook_minutes,
        base_servings=body.base_servings,
        instructions=body.instructions,
    )
    db.add(recipe)
    await db.flush()

    for ri_in in body.ingredients:
        ingredient = await get_or_create_ingredient(ri_in.ingredient_name, db)
        ri = RecipeIngredient(
            recipe_id=recipe.id,
            ingredient_id=ingredient.id,
            quantity=ri_in.quantity,
            unit=ri_in.unit,
            notes=ri_in.notes,
        )
        db.add(ri)

    await db.commit()

    # Reload with eager-loaded relations — avoids MissingGreenlet on serialisation
    result = await db.execute(
        select(Recipe).options(RECIPE_LOAD).where(Recipe.id == recipe.id)
    )
    return result.scalar_one()


@router.delete("/{recipe_id}", status_code=204)
async def delete_recipe(recipe_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Recipe).where(Recipe.id == recipe_id))
    recipe = result.scalar_one_or_none()
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    await db.delete(recipe)
    await db.commit()


@router.post("/import/url", response_model=RecipeOut, status_code=201)
async def import_from_url(body: ImportUrlRequest, db: AsyncSession = Depends(get_db)):
    """Import a recipe from a URL using AI extraction."""
    try:
        parsed = await import_recipe_from_url(body.url)
    except Exception as e:
        raise HTTPException(422, f"Failed to import recipe: {e}")

    from app.schemas.schemas import RecipeIngredientIn
    ingredients = [RecipeIngredientIn(**ing) for ing in parsed.get("ingredients", [])]
    recipe_data = RecipeCreate(
        name=parsed["name"],
        description=parsed.get("description"),
        source_url=body.url,
        prep_minutes=parsed.get("prep_minutes"),
        cook_minutes=parsed.get("cook_minutes"),
        base_servings=parsed.get("base_servings", 2),
        instructions=parsed.get("instructions"),
        ingredients=ingredients,
    )
    return await create_recipe(recipe_data, db)
