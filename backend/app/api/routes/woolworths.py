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
            from app.services.woolworths import _clean_search_query, _score_result
            clean_query = _clean_search_query(item.ingredient.name)
            results = await search_products(clean_query, page_size=8)
            # Re-rank by relevance
            scored = sorted(results, key=lambda p: _score_result(p, clean_query), reverse=True)
            return item.id, scored
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


# ---------------------------------------------------------------------------
# Account linking — receive token from bookmarklet
# ---------------------------------------------------------------------------

from pydantic import BaseModel as _BaseModel

class LinkTokenBody(_BaseModel):
    cookies: str  # raw document.cookie string from woolworths.com.au


class LinkStatus(_BaseModel):
    linked: bool
    expires: str | None = None


# Store token in a simple DB table — reuse IngredientStoreMapping table's pattern
# but use a dedicated settings approach via a simple key-value in DB

@router.post("/link", status_code=200)
async def link_account(body: LinkTokenBody, db: AsyncSession = Depends(get_db)):
    """
    Receive cookies from the bookmarklet running on woolworths.com.au.
    Extract the auth token and store it for use in product searches.
    """
    import re
    from app.models.models import WoolworthsToken

    # Extract the most useful auth cookie — try several known names
    token = None
    expiry = None
    for cookie_name in ["wow-auth-token", "WOWToken", "login-token", "auth-token"]:
        match = re.search(
            rf'(?:^|;\s*){re.escape(cookie_name)}=([^;]+)', body.cookies
        )
        if match:
            token = match.group(1)
            break

    # Store the full cookie string regardless — we'll send it all
    result = await db.execute(select(WoolworthsToken))
    existing = result.scalar_one_or_none()
    if existing:
        existing.cookie_string = body.cookies
        existing.auth_token = token
        existing.linked_at = __import__('datetime').datetime.utcnow()
    else:
        from app.models.models import WoolworthsToken as WT
        db.add(WT(
            cookie_string=body.cookies,
            auth_token=token,
        ))
    await db.commit()
    return {"linked": True, "message": "Woolworths account linked successfully"}


@router.get("/status", response_model=LinkStatus)
async def link_status(db: AsyncSession = Depends(get_db)):
    """Check if a Woolworths account is currently linked."""
    from app.models.models import WoolworthsToken
    result = await db.execute(select(WoolworthsToken))
    token = result.scalar_one_or_none()
    if not token:
        return LinkStatus(linked=False)
    linked_at = token.linked_at.strftime("%d %b %Y") if token.linked_at else None
    return LinkStatus(linked=True, expires=linked_at)


@router.delete("/link", status_code=204)
async def unlink_account(db: AsyncSession = Depends(get_db)):
    """Remove the stored Woolworths token."""
    from app.models.models import WoolworthsToken
    result = await db.execute(select(WoolworthsToken))
    token = result.scalar_one_or_none()
    if token:
        await db.delete(token)
        await db.commit()
