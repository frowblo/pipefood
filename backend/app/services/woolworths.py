"""
Woolworths product search service.

Uses Woolworths' internal search API (same endpoint as their website).
No authentication required for search — read-only product data is public.
Cart injection is handled client-side using the user's browser session.
"""
import re
import math
import httpx
from typing import Optional

SEARCH_URL = "https://www.woolworths.com.au/apis/ui/Search/products"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-AU,en;q=0.9",
    "Origin": "https://www.woolworths.com.au",
    "Referer": "https://www.woolworths.com.au/",
}


def _parse_pack_size(description: str) -> tuple[Optional[float], Optional[float]]:
    """
    Parse a pack size string like '1kg', '400ml', '500g', '2L' into
    (grams, millilitres). Returns (None, None) if not parseable.
    """
    if not description:
        return None, None
    desc = description.lower().strip()

    ml_match = re.search(r'([\d.]+)\s*(?:ml|millilitre)', desc)
    if ml_match:
        return None, float(ml_match.group(1))

    l_match = re.search(r'([\d.]+)\s*(?:l|litre|liter)\b', desc)
    if l_match:
        return None, float(l_match.group(1)) * 1000

    kg_match = re.search(r'([\d.]+)\s*kg', desc)
    if kg_match:
        return float(kg_match.group(1)) * 1000, None

    g_match = re.search(r'([\d.]+)\s*g\b', desc)
    if g_match:
        return float(g_match.group(1)), None

    return None, None


def _calculate_packs(
    qty_needed: float,
    unit: str,
    pack_size_g: Optional[float],
    pack_size_ml: Optional[float],
) -> int:
    """
    Given how much we need and the product's pack size, return how many packs to buy.
    Defaults to 1 if conversion isn't possible.
    """
    CUPS_TO_ML = 250.0
    TSP_TO_ML = 5.0
    TBSP_TO_ML = 15.0

    needed_g: Optional[float] = None
    needed_ml: Optional[float] = None

    if unit == "g":
        needed_g = qty_needed
    elif unit == "kg":
        needed_g = qty_needed * 1000
    elif unit == "ml":
        needed_ml = qty_needed
    elif unit == "l":
        needed_ml = qty_needed * 1000
    elif unit == "cups":
        needed_ml = qty_needed * CUPS_TO_ML
    elif unit == "tsp":
        needed_ml = qty_needed * TSP_TO_ML
    elif unit == "tbsp":
        needed_ml = qty_needed * TBSP_TO_ML

    if needed_g and pack_size_g:
        return max(1, math.ceil(needed_g / pack_size_g))
    if needed_ml and pack_size_ml:
        return max(1, math.ceil(needed_ml / pack_size_ml))

    # Can't convert — default to 1 pack
    return 1


async def search_products(query: str, page_size: int = 5) -> list[dict]:
    """
    Search Woolworths for products matching a query.
    Returns a list of product dicts with stockcode, name, price, pack size etc.
    """
    params = {
        "searchTerm": query,
        "pageNumber": 1,
        "pageSize": page_size,
        "sortType": "TraderRelevance",
        "isMobile": "false",
        "filters": "[]",
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(SEARCH_URL, params=params, headers=HEADERS)
        resp.raise_for_status()
        data = resp.json()

    products = []
    bundles = data.get("Bundles", []) or []
    for bundle in bundles:
        for product in bundle.get("Products", []):
            stockcode = str(product.get("Stockcode", ""))
            name = product.get("Name", "")
            brand = product.get("Brand", "")
            price = product.get("Price") or product.get("WasPrice")
            pack_desc = product.get("PackageSize", "") or product.get("UnitWeightInGrams", "")

            # Parse pack size
            if isinstance(pack_desc, (int, float)):
                pack_size_g = float(pack_desc)
                pack_size_ml = None
                pack_desc_str = f"{pack_desc}g"
            else:
                pack_size_g, pack_size_ml = _parse_pack_size(str(pack_desc))
                pack_desc_str = str(pack_desc)

            products.append({
                "stockcode": stockcode,
                "name": name,
                "brand": brand,
                "price": price,
                "pack_description": pack_desc_str,
                "pack_size_g": pack_size_g,
                "pack_size_ml": pack_size_ml,
                "display_name": f"{brand} {name}".strip() if brand else name,
            })

    return products


async def find_best_match(ingredient_name: str) -> Optional[dict]:
    """Search for an ingredient and return the single best match."""
    results = await search_products(ingredient_name, page_size=5)
    return results[0] if results else None
