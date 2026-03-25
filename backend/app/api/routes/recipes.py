from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.models import (
    Recipe, RecipeIngredient, Ingredient,
    IngredientAlias, IngredientConsolidation
)
from app.schemas.schemas import (
    RecipeCreate, RecipeOut, ImportUrlRequest,
    RecipePreview, ConfirmImportRequest,
    AliasSuggestion, ConsolidationSuggestion
)
from app.services.ai_import import import_recipe_from_url, suggest_validations

router = APIRouter(prefix="/recipes", tags=["recipes"])

RECIPE_LOAD = selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient)


async def get_or_create_ingredient(name: str, db: AsyncSession, category: str | None = None) -> Ingredient:
    result = await db.execute(
        select(Ingredient).where(Ingredient.name == name.lower().strip())
    )
    ingredient = result.scalar_one_or_none()
    if not ingredient:
        from app.models.models import IngredientCategory
        cat = IngredientCategory.other
        if category:
            try:
                cat = IngredientCategory(category)
            except ValueError:
                pass
        ingredient = Ingredient(name=name.lower().strip(), category=cat)
        db.add(ingredient)
        await db.flush()
    elif category and ingredient.category == IngredientCategory.other:
        # Update category if previously uncategorised
        from app.models.models import IngredientCategory
        try:
            ingredient.category = IngredientCategory(category)
        except ValueError:
            pass
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
        calories=body.calories,
        protein_g=body.protein_g,
        fibre_g=body.fibre_g,
    )
    db.add(recipe)
    await db.flush()

    for ri_in in body.ingredients:
        ingredient = await get_or_create_ingredient(ri_in.ingredient_name, db, ri_in.category)
        ri = RecipeIngredient(
            recipe_id=recipe.id,
            ingredient_id=ingredient.id,
            quantity=ri_in.quantity,
            unit=ri_in.unit,
            notes=ri_in.notes,
            group=ri_in.group,
        )
        db.add(ri)

    await db.commit()
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
    from sqlalchemy import delete as sql_delete
    from app.models.models import PlannedMeal
    await db.execute(sql_delete(PlannedMeal).where(PlannedMeal.recipe_id == recipe_id))
    await db.delete(recipe)
    await db.commit()


# ---------------------------------------------------------------------------
# Two-step import: preview → confirm
# ---------------------------------------------------------------------------

@router.post("/import/preview", response_model=RecipePreview, status_code=200)
async def import_preview(body: ImportUrlRequest, db: AsyncSession = Depends(get_db)):
    """
    Step 1: Fetch, extract, and validate — return a preview with suggestions.
    Nothing is saved to the database at this point.
    """
    try:
        parsed = await import_recipe_from_url(body.url)
    except Exception as e:
        raise HTTPException(422, f"Failed to import recipe: {e}")

    ingredient_names = [ing.get("name", "") for ing in parsed.get("ingredients", [])]

    # --- Auto-apply confirmed aliases from DB ---
    alias_result = await db.execute(
        select(IngredientAlias).where(IngredientAlias.confirmed == True)
    )
    confirmed_aliases = {a.raw_name.lower(): a.canonical_name for a in alias_result.scalars()}

    auto_applied: list[str] = []
    for ing in parsed.get("ingredients", []):
        raw = ing.get("name", "")
        if raw.lower() in confirmed_aliases:
            canonical = confirmed_aliases[raw.lower()]
            ing["name"] = canonical
            auto_applied.append(f"{raw} → {canonical}")

    # --- Auto-apply confirmed consolidations from DB ---
    consol_result = await db.execute(
        select(IngredientConsolidation).where(IngredientConsolidation.confirmed == True)
    )
    confirmed_consols = {
        c.source_names: c.consolidated_name for c in consol_result.scalars()
    }
    current_names = [i.get("name", "") for i in parsed.get("ingredients", [])]
    for source_key, consolidated in confirmed_consols.items():
        sources = sorted(source_key.split(","))
        if all(s in current_names for s in sources):
            # Merge: replace first source ingredient, remove rest
            first = True
            new_ingredients = []
            for ing in parsed["ingredients"]:
                if ing.get("name") in sources:
                    if first:
                        ing["name"] = consolidated
                        ing["notes"] = ", ".join(
                            i.get("notes", "") for i in parsed["ingredients"]
                            if i.get("name") in sources and i.get("notes")
                        ) or None
                        new_ingredients.append(ing)
                        first = False
                else:
                    new_ingredients.append(ing)
            parsed["ingredients"] = new_ingredients

    # --- Get fresh suggestions for remaining ingredients ---
    current_names_after = [i.get("name", "") for i in parsed.get("ingredients", [])]

    # Filter out names we've already made decisions on
    rejected_result = await db.execute(
        select(IngredientAlias).where(IngredientAlias.confirmed == False)
    )
    rejected_aliases = {a.raw_name.lower() for a in rejected_result.scalars()}

    rejected_consols_result = await db.execute(
        select(IngredientConsolidation).where(IngredientConsolidation.confirmed == False)
    )
    rejected_consol_keys = {c.source_names for c in rejected_consols_result.scalars()}

    suggestions = await suggest_validations(current_names_after)

    # Filter out already-decided suggestions
    alias_suggestions = [
        AliasSuggestion(**s) for s in suggestions.get("aliases", [])
        if s["raw_name"].lower() not in confirmed_aliases
        and s["raw_name"].lower() not in rejected_aliases
    ]

    consolidation_suggestions = [
        ConsolidationSuggestion(**s) for s in suggestions.get("consolidations", [])
        if ",".join(sorted(s["source_names"])) not in rejected_consol_keys
        and ",".join(sorted(s["source_names"])) not in confirmed_consols
    ]

    return RecipePreview(
        parsed=parsed,
        alias_suggestions=alias_suggestions,
        consolidation_suggestions=consolidation_suggestions,
        auto_applied_aliases=auto_applied,
    )


@router.post("/import/confirm", response_model=RecipeOut, status_code=201)
async def import_confirm(body: ConfirmImportRequest, db: AsyncSession = Depends(get_db)):
    """
    Step 2: User has reviewed suggestions. Apply decisions, save aliases, save recipe.
    """
    parsed = body.parsed

    # --- Apply and store alias decisions ---
    for decision in body.alias_decisions:
        # Store in DB
        alias_result = await db.execute(
            select(IngredientAlias).where(
                IngredientAlias.raw_name == decision.raw_name.lower()
            )
        )
        existing = alias_result.scalar_one_or_none()
        if existing:
            existing.confirmed = decision.confirmed
            existing.canonical_name = decision.canonical_name
        else:
            db.add(IngredientAlias(
                raw_name=decision.raw_name.lower(),
                canonical_name=decision.canonical_name,
                confirmed=decision.confirmed,
            ))

        # Apply to parsed ingredients if confirmed
        if decision.confirmed:
            for ing in parsed.get("ingredients", []):
                if ing.get("name", "").lower() == decision.raw_name.lower():
                    ing["name"] = decision.canonical_name

    # --- Apply and store consolidation decisions ---
    for decision in body.consolidation_decisions:
        source_key = ",".join(sorted(decision.source_names))
        consol_result = await db.execute(
            select(IngredientConsolidation).where(
                IngredientConsolidation.source_names == source_key
            )
        )
        existing = consol_result.scalar_one_or_none()
        if existing:
            existing.confirmed = decision.confirmed
            existing.consolidated_name = decision.consolidated_name
        else:
            db.add(IngredientConsolidation(
                source_names=source_key,
                consolidated_name=decision.consolidated_name,
                confirmed=decision.confirmed,
            ))

        if decision.confirmed:
            first = True
            new_ingredients = []
            for ing in parsed["ingredients"]:
                if ing.get("name") in decision.source_names:
                    if first:
                        ing["name"] = decision.consolidated_name
                        new_ingredients.append(ing)
                        first = False
                else:
                    new_ingredients.append(ing)
            parsed["ingredients"] = new_ingredients

    await db.flush()

    # --- Build RecipeCreate and save ---
    from app.schemas.schemas import RecipeIngredientIn
    ingredients = [RecipeIngredientIn(**ing) for ing in parsed.get("ingredients", [])]
    recipe_data = RecipeCreate(
        name=parsed["name"],
        description=parsed.get("description"),
        source_url=parsed.get("source_url"),
        prep_minutes=parsed.get("prep_minutes"),
        cook_minutes=parsed.get("cook_minutes"),
        base_servings=parsed.get("base_servings", 2),
        instructions=parsed.get("instructions"),
        ingredients=ingredients,
        calories=parsed.get("calories"),
        protein_g=parsed.get("protein_g"),
        fibre_g=parsed.get("fibre_g"),
    )

    recipe = Recipe(
        name=recipe_data.name,
        description=recipe_data.description,
        source_url=recipe_data.source_url,
        prep_minutes=recipe_data.prep_minutes,
        cook_minutes=recipe_data.cook_minutes,
        base_servings=recipe_data.base_servings,
        instructions=recipe_data.instructions,
        calories=recipe_data.calories,
        protein_g=recipe_data.protein_g,
        fibre_g=recipe_data.fibre_g,
    )
    db.add(recipe)
    await db.flush()

    for ri_in in recipe_data.ingredients:
        ingredient = await get_or_create_ingredient(ri_in.ingredient_name, db, ri_in.category)
        ri = RecipeIngredient(
            recipe_id=recipe.id,
            ingredient_id=ingredient.id,
            quantity=ri_in.quantity,
            unit=ri_in.unit,
            notes=ri_in.notes,
            group=ri_in.group,
        )
        db.add(ri)

    await db.commit()
    result = await db.execute(
        select(Recipe).options(RECIPE_LOAD).where(Recipe.id == recipe.id)
    )
    return result.scalar_one()


@router.post("/ingredients/recategorise", response_model=dict)
async def recategorise_ingredients(db: AsyncSession = Depends(get_db)):
    """
    One-off endpoint: ask Claude to assign categories to all uncategorised ingredients.
    Call this once after deploying the category fix to update existing data.
    """
    from sqlalchemy import update
    from app.models.models import IngredientCategory
    import anthropic as _anthropic
    import json as _json
    from app.core.config import settings

    # Fetch all ingredients currently set to 'other'
    result = await db.execute(
        select(Ingredient).where(Ingredient.category == IngredientCategory.other)
    )
    uncategorised = result.scalars().all()
    if not uncategorised:
        return {"updated": 0, "message": "All ingredients already categorised"}

    names = [i.name for i in uncategorised]

    prompt = """Given this list of ingredient names, return ONLY valid JSON mapping each name to its
supermarket category. Use exactly these categories:
produce, meat, seafood, dairy, dry_goods, condiments, frozen, bakery, other

Guidelines:
produce: fresh fruit, vegetables, herbs, mushrooms, garlic, ginger, onion
meat: beef, chicken, pork, lamb, duck, bacon, any land animal meat
seafood: fish, prawns, squid, crab, mussels, any seafood
dairy: milk, cream, butter, cheese, yoghurt, eggs, sour cream
dry_goods: flour, sugar, rice, pasta, noodles, bread, oats, lentils, beans, canned goods, coconut milk (tinned), stock
condiments: sauces, oils, vinegars, soy sauce, fish sauce, sesame oil, honey, mustard, spices, salt, pepper
frozen: anything typically bought frozen
bakery: bread, tortillas, wraps, pastry, pizza bases
other: only if genuinely none of the above fit

Return format (no preamble, no fences):
{"ingredient name": "category", ...}

Ingredients:
""" + "\n".join(f"- {n}" for n in names)

    client = _anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    message = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    mapping: dict = _json.loads(raw)

    updated = 0
    for ingredient in uncategorised:
        cat_str = mapping.get(ingredient.name)
        if cat_str:
            try:
                ingredient.category = IngredientCategory(cat_str)
                updated += 1
            except ValueError:
                pass

    await db.commit()
    return {"updated": updated, "total": len(uncategorised)}
