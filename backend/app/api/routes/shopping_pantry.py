from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.models import ShoppingList, ShoppingListItem, Ingredient, PantryItem, IngredientAlias
from app.schemas.schemas import ShoppingListOut, PantryItemCreate, PantryItemOut
from app.services.shopping import generate_shopping_list

# --- Shopping list router ---
shopping_router = APIRouter(prefix="/shopping", tags=["shopping"])


@shopping_router.post("/generate/{plan_id}", response_model=ShoppingListOut, status_code=201)
async def generate(plan_id: int, db: AsyncSession = Depends(get_db)):
    """Generate (or regenerate) a shopping list for a plan."""
    shopping_list = await generate_shopping_list(plan_id, db)
    result = await db.execute(
        select(ShoppingList)
        .options(selectinload(ShoppingList.items).selectinload(ShoppingListItem.ingredient))
        .where(ShoppingList.id == shopping_list.id)
    )
    return result.scalar_one()


@shopping_router.get("/{plan_id}", response_model=ShoppingListOut)
async def get_list(plan_id: int, db: AsyncSession = Depends(get_db)):
    """Get the most recent shopping list for a plan."""
    result = await db.execute(
        select(ShoppingList)
        .options(selectinload(ShoppingList.items).selectinload(ShoppingListItem.ingredient))
        .where(ShoppingList.plan_id == plan_id)
        .order_by(ShoppingList.generated_at.desc())
        .limit(1)
    )
    sl = result.scalar_one_or_none()
    if not sl:
        raise HTTPException(404, "No shopping list found for this plan")
    return sl


@shopping_router.patch("/items/{item_id}/check", response_model=dict)
async def check_item(item_id: int, db: AsyncSession = Depends(get_db)):
    """Toggle checked state on a shopping list item (simple buy-list tick)."""
    item = await db.get(ShoppingListItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    item.checked = not item.checked
    await db.commit()
    return {"id": item_id, "checked": item.checked}


class MarkInStockBody(BaseModel):
    quantity: float
    unit: str
    expiry_date: Optional[str] = None


@shopping_router.post("/items/{item_id}/mark-in-stock", response_model=dict)
async def mark_in_stock(item_id: int, body: MarkInStockBody, db: AsyncSession = Depends(get_db)):
    """
    User has confirmed they already have this item.
    - Marks the shopping list item as covered (checked + from_pantry)
    - Upserts the ingredient into the pantry with the given quantity
    """
    item = await db.get(ShoppingListItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    # Mark as covered on the shopping list
    item.checked = True
    item.from_pantry = True

    # Upsert into pantry
    result = await db.execute(
        select(PantryItem).where(PantryItem.ingredient_id == item.ingredient_id)
    )
    pantry_item = result.scalar_one_or_none()
    if pantry_item:
        pantry_item.quantity = body.quantity
        pantry_item.unit = body.unit
        if body.expiry_date:
            from datetime import date
            pantry_item.expiry_date = date.fromisoformat(body.expiry_date)
    else:
        from datetime import date
        pantry_item = PantryItem(
            ingredient_id=item.ingredient_id,
            quantity=body.quantity,
            unit=body.unit,
            expiry_date=date.fromisoformat(body.expiry_date) if body.expiry_date else None,
        )
        db.add(pantry_item)

    await db.commit()
    return {"id": item_id, "checked": True, "from_pantry": True}


@shopping_router.post("/items/{item_id}/mark-out-of-stock", response_model=dict)
async def mark_out_of_stock(item_id: int, db: AsyncSession = Depends(get_db)):
    """
    User has confirmed a pantry-tracked item is actually used up.
    - Zeros the pantry quantity (keeps the record for future reference)
    - Moves the item back to the buy list (unchecks, clears from_pantry)
    """
    item = await db.get(ShoppingListItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    # Move back to buy list
    item.checked = False
    item.from_pantry = False

    # Zero the pantry quantity
    result = await db.execute(
        select(PantryItem).where(PantryItem.ingredient_id == item.ingredient_id)
    )
    pantry_item = result.scalar_one_or_none()
    if pantry_item:
        pantry_item.quantity = 0.0

    await db.commit()
    return {"id": item_id, "checked": False, "from_pantry": False}


class MergeItemsBody(BaseModel):
    item_id_a: int
    item_id_b: int
    canonical_name: str
    unit: str
    permanent: bool = False


@shopping_router.post("/items/merge", response_model=ShoppingListOut)
async def merge_items(body: MergeItemsBody, db: AsyncSession = Depends(get_db)):
    import math
    item_a = await db.get(ShoppingListItem, body.item_id_a)
    item_b = await db.get(ShoppingListItem, body.item_id_b)
    if not item_a or not item_b:
        raise HTTPException(404, "One or both items not found")
    if item_a.list_id != item_b.list_id:
        raise HTTPException(400, "Items must be on the same shopping list")

    # Save original names before any changes
    orig_name_a = item_a.ingredient.name
    orig_name_b = item_b.ingredient.name

    # Get or create canonical ingredient
    result = await db.execute(
        select(Ingredient).where(Ingredient.name == body.canonical_name.lower().strip())
    )
    canonical_ingredient = result.scalar_one_or_none()
    if not canonical_ingredient:
        canonical_ingredient = Ingredient(name=body.canonical_name.lower().strip())
        db.add(canonical_ingredient)
        await db.flush()

    # Merge quantities
    merged_needed = round(item_a.quantity_needed + item_b.quantity_needed, 2)
    merged_to_buy = round(item_a.quantity_to_buy + item_b.quantity_to_buy, 2)
    packs = None
    leftover = 0.0
    if canonical_ingredient.pack_size and canonical_ingredient.pack_size > 0:
        packs = math.ceil(merged_needed / canonical_ingredient.pack_size)
        merged_to_buy = round(packs * canonical_ingredient.pack_size, 2)
        leftover = round(merged_to_buy - merged_needed, 2)

    # Update item_a
    item_a.ingredient_id = canonical_ingredient.id
    item_a.quantity_needed = merged_needed
    item_a.quantity_to_buy = merged_to_buy
    item_a.unit = body.unit
    item_a.packs_to_buy = packs
    item_a.leftover_quantity = leftover
    list_id = item_a.list_id

    # Delete item_b
    await db.delete(item_b)

    # If permanent, save aliases for both source names
    if body.permanent:
        for orig_name in [orig_name_a, orig_name_b]:
            if orig_name.lower() != body.canonical_name.lower():
                existing = await db.execute(
                    select(IngredientAlias).where(IngredientAlias.raw_name == orig_name.lower())
                )
                alias = existing.scalar_one_or_none()
                if alias:
                    alias.canonical_name = body.canonical_name
                    alias.confirmed = True
                else:
                    db.add(IngredientAlias(
                        raw_name=orig_name.lower(),
                        canonical_name=body.canonical_name,
                        confirmed=True,
                    ))

    await db.commit()
    result = await db.execute(
        select(ShoppingList)
        .options(selectinload(ShoppingList.items).selectinload(ShoppingListItem.ingredient))
        .where(ShoppingList.id == list_id)
    )
    return result.scalar_one()


# --- Pantry router ---
pantry_router = APIRouter(prefix="/pantry", tags=["pantry"])


@pantry_router.get("", response_model=list[PantryItemOut])
async def list_pantry(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PantryItem)
        .options(selectinload(PantryItem.ingredient))
        .where(PantryItem.quantity > 0)  # hide zeroed items
        .order_by(PantryItem.expiry_date.asc().nulls_last())
    )
    return result.scalars().all()


@pantry_router.put("", response_model=PantryItemOut)
async def upsert_pantry_item(body: PantryItemCreate, db: AsyncSession = Depends(get_db)):
    """Add or update a pantry item (one entry per ingredient)."""
    result = await db.execute(
        select(PantryItem).where(PantryItem.ingredient_id == body.ingredient_id)
    )
    item = result.scalar_one_or_none()
    if item:
        item.quantity = body.quantity
        item.unit = body.unit
        item.expiry_date = body.expiry_date
    else:
        item = PantryItem(**body.model_dump())
        db.add(item)
    await db.commit()
    result = await db.execute(
        select(PantryItem)
        .options(selectinload(PantryItem.ingredient))
        .where(PantryItem.id == item.id)
    )
    return result.scalar_one()


@pantry_router.delete("/{item_id}", status_code=204)
async def delete_pantry_item(item_id: int, db: AsyncSession = Depends(get_db)):
    item = await db.get(PantryItem, item_id)
    if not item:
        raise HTTPException(404, "Pantry item not found")
    await db.delete(item)
    await db.commit()
