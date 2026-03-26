"""
Woolworths integration routes.

GET  /api/woolworths/match/{list_id}     — match all unconfirmed items in a shopping list
POST /api/woolworths/mappings            — save confirmed product mappings
GET  /api/woolworths/search              — manual product search (user override)
GET  /api/woolworths/cart/{list_id}      — get confirmed cart items for injection
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.models import (
    ShoppingList, ShoppingListItem, Ingredient, IngredientStoreMapping
)
from app.schemas.schemas import (
    ListMatchResult, ShoppingItemMatch, WoolworthsProduct,
    ConfirmMappingRequest, CartItem
)
from app.services.woolworths import search_products, find_best_match, _calculate_packs

router = APIRouter(prefix="/woolworths", tags=["woolworths"])


@router.get("/match/{list_id}", response_model=ListMatchResult)
async def match_list(list_id: int, db: AsyncSession = Depends(get_db)):
    """
    For each unchecked buy-list item, return the best Woolworths product match.
    Items with existing confirmed mappings are returned immediately.
    New items are searched in parallel.
    """
    # Load the shopping list
    result = await db.execute(
        select(ShoppingList)
        .options(selectinload(ShoppingList.items).selectinload(ShoppingListItem.ingredient))
        .where(ShoppingList.id == list_id)
    )
    sl = result.scalar_one_or_none()
    if not sl:
        raise HTTPException(404, "Shopping list not found")

    # Only match items that need buying
    items_to_match = [i for i in sl.items if not i.from_pantry and not i.checked]

    # Load existing confirmed mappings for these ingredients
    ingredient_ids = [i.ingredient_id for i in items_to_match]
    mapping_result = await db.execute(
        select(IngredientStoreMapping).where(
            IngredientStoreMapping.ingredient_id.in_(ingredient_ids),
            IngredientStoreMapping.store == "woolworths",
            IngredientStoreMapping.confirmed == True,
        )
    )
    existing_mappings = {m.ingredient_id: m for m in mapping_result.scalars()}

    # For items without a confirmed mapping, search in parallel
    items_needing_search = [i for i in items_to_match if i.ingredient_id not in existing_mappings]

    async def search_item(item: ShoppingListItem) -> tuple[int, list[dict]]:
        try:
            results = await search_products(item.ingredient.name, page_size=5)
            return item.id, results
        except Exception:
            return item.id, []

    search_results: dict[int, list[dict]] = {}
    if items_needing_search:
        tasks = [search_item(item) for item in items_needing_search]
        for item_id, results in await asyncio.gather(*tasks):
            search_results[item_id] = results

    # Build match results
    matches = []
    for item in items_to_match:
        existing = existing_mappings.get(item.ingredient_id)

        if existing:
            # Use confirmed mapping
            packs = _calculate_packs(
                item.quantity_to_buy, item.unit,
                existing.pack_size_g, existing.pack_size_ml
            )
            best = WoolworthsProduct(
                stockcode=existing.stockcode,
                name=existing.product_name,
                brand=existing.product_brand,
                price=existing.price_aud,
                pack_description=existing.pack_size_description,
                pack_size_g=existing.pack_size_g,
                pack_size_ml=existing.pack_size_ml,
                display_name=f"{existing.product_brand} {existing.product_name}".strip()
                    if existing.product_brand else existing.product_name,
            )
            matches.append(ShoppingItemMatch(
                shopping_list_item_id=item.id,
                ingredient_name=item.ingredient.name,
                quantity_to_buy=item.quantity_to_buy,
                unit=item.unit,
                best_match=best,
                alternatives=[],
                packs_to_buy=packs,
                confirmed=True,
                existing_mapping=True,
            ))
        else:
            # Use search results
            products = search_results.get(item.id, [])
            best = None
            alts = []
            packs = 1

            if products:
                best_raw = products[0]
                best = WoolworthsProduct(**{k: best_raw[k] for k in WoolworthsProduct.model_fields})
                alts = [WoolworthsProduct(**{k: p[k] for k in WoolworthsProduct.model_fields})
                        for p in products[1:]]
                packs = _calculate_packs(
                    item.quantity_to_buy, item.unit,
                    best_raw.get("pack_size_g"), best_raw.get("pack_size_ml")
                )

            matches.append(ShoppingItemMatch(
                shopping_list_item_id=item.id,
                ingredient_name=item.ingredient.name,
                quantity_to_buy=item.quantity_to_buy,
                unit=item.unit,
                best_match=best,
                alternatives=alts,
                packs_to_buy=packs,
                confirmed=False,
                existing_mapping=False,
            ))

    return ListMatchResult(list_id=list_id, matches=matches)


@router.post("/mappings", status_code=204)
async def save_mappings(
    mappings: list[ConfirmMappingRequest],
    db: AsyncSession = Depends(get_db)
):
    """Save confirmed product→ingredient mappings for future reuse."""
    from datetime import datetime
    for m in mappings:
        result = await db.execute(
            select(IngredientStoreMapping).where(
                IngredientStoreMapping.ingredient_id == m.ingredient_id,
                IngredientStoreMapping.store == "woolworths",
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.stockcode = m.stockcode
            existing.product_name = m.product_name
            existing.product_brand = m.product_brand
            existing.pack_size_description = m.pack_description
            existing.pack_size_g = m.pack_size_g
            existing.pack_size_ml = m.pack_size_ml
            existing.price_aud = m.price_aud
            existing.confirmed = True
            existing.last_updated = datetime.utcnow()
        else:
            db.add(IngredientStoreMapping(
                ingredient_id=m.ingredient_id,
                store="woolworths",
                stockcode=m.stockcode,
                product_name=m.product_name,
                product_brand=m.product_brand,
                pack_size_description=m.pack_description,
                pack_size_g=m.pack_size_g,
                pack_size_ml=m.pack_size_ml,
                price_aud=m.price_aud,
                confirmed=True,
                last_updated=datetime.utcnow(),
            ))
    await db.commit()


@router.get("/search", response_model=list[WoolworthsProduct])
async def manual_search(q: str = Query(..., min_length=2)):
    """Manual product search for user overrides."""
    results = await search_products(q, page_size=10)
    return [WoolworthsProduct(**{k: r[k] for k in WoolworthsProduct.model_fields})
            for r in results]


@router.get("/cart/{list_id}", response_model=list[CartItem])
async def get_cart_items(list_id: int, db: AsyncSession = Depends(get_db)):
    """
    Return confirmed cart items for a shopping list.
    Used by the frontend to build the cart injection payload.
    """
    result = await db.execute(
        select(ShoppingList)
        .options(selectinload(ShoppingList.items).selectinload(ShoppingListItem.ingredient))
        .where(ShoppingList.id == list_id)
    )
    sl = result.scalar_one_or_none()
    if not sl:
        raise HTTPException(404, "Shopping list not found")

    items_to_buy = [i for i in sl.items if not i.from_pantry and not i.checked]
    ingredient_ids = [i.ingredient_id for i in items_to_buy]

    mapping_result = await db.execute(
        select(IngredientStoreMapping).where(
            IngredientStoreMapping.ingredient_id.in_(ingredient_ids),
            IngredientStoreMapping.store == "woolworths",
            IngredientStoreMapping.confirmed == True,
        )
    )
    mappings = {m.ingredient_id: m for m in mapping_result.scalars()}

    cart_items = []
    for item in items_to_buy:
        mapping = mappings.get(item.ingredient_id)
        if not mapping:
            continue
        packs = _calculate_packs(
            item.quantity_to_buy, item.unit,
            mapping.pack_size_g, mapping.pack_size_ml
        )
        cart_items.append(CartItem(
            stockcode=mapping.stockcode,
            quantity=packs,
            product_name=mapping.product_name,
        ))

    return cart_items
