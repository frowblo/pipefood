"""
AI recipe import service.

Pipeline:
1. Fetch URL (direct, fallback to jina.ai reader proxy)
2. Claude extracts structured recipe — preserving ingredient groups
3. Normalisation — auto-apply confirmed aliases from DB
4. Validation — Claude suggests new aliases and consolidations
5. Return parsed recipe + suggestions for user review
   (nothing is saved until the user confirms)
"""
import re
import json
import httpx
import anthropic

from app.core.config import settings


# ---------------------------------------------------------------------------
# Extraction prompt
# ---------------------------------------------------------------------------

EXTRACT_PROMPT = """
You are a recipe parser. Extract the recipe from the provided text and return ONLY valid JSON
with no preamble, no markdown fences, and no extra keys.

Required format:
{
  "name": "Green Chicken Curry",
  "description": "A rich, fragrant curry with coconut milk and fresh herbs.",
  "prep_minutes": 15,
  "cook_minutes": 30,
  "base_servings": 4,
  "instructions": [
    "Combine the marinade ingredients in a bowl and coat the chicken. Set aside for 10 minutes.",
    "Heat oil in a large pan over medium-high heat.",
    "Add the curry paste and cook, stirring, for 1 minute until fragrant."
  ],
  "ingredients": [
    {
      "name": "Chicken thigh",
      "quantity": 600,
      "unit": "g",
      "notes": "bone-in, skin on",
      "group": "Marinade"
    },
    {
      "name": "Fish sauce",
      "quantity": 1,
      "unit": "tbsp",
      "group": "Marinade"
    },
    {
      "name": "Coconut milk",
      "quantity": 1.5,
      "unit": "cups",
      "group": null
    }
  ]
}

Rules — follow these exactly:

NAMING:
- Recipe name: title case (e.g. "Green Chicken Curry with Coconut Sambal")
- Ingredient names: sentence case, first word capitalised only (e.g. "Chicken thigh", "Fish sauce")
- Description: full sentence with correct punctuation

INGREDIENT GROUPS:
- If the recipe organises ingredients into named groups (e.g. "Marinade", "For the sauce",
  "Dressing", "To serve"), preserve the group name in the "group" field for each ingredient
- Use the exact group label from the recipe, in title case
- Ingredients with no group get null for "group"
- The group label should be short — omit words like "ingredients" or "for the"
  e.g. "Marinade ingredients" -> "Marinade", "For the dipping sauce" -> "Dipping sauce"

UNITS — liquids:
- All liquid ingredients use "cups", rounded to nearest 0.25
- Very small liquid amounts (less than 0.25 cups) use "tbsp" rounded to nearest 0.5,
  or "tsp" rounded to nearest 0.5
- Do NOT use ml or l

UNITS — solids:
- All solid ingredients use "g", rounded to nearest 10
  (e.g. 47g -> 50g, 183g -> 180g, 8g -> 10g)
- Do NOT use oz, lb, or kg

UNITS — exceptions (leave as-is, never convert):
- bunch, head, clove, pinch, sprig, stalk, slice, sheet, piece, can, jar, sachet, packet
- Garlic is ALWAYS in cloves — never cups
- Ginger is ALWAYS in g
- Onion, shallot, chilli are ALWAYS in pieces

INSTRUCTIONS:
- Return as a JSON array of strings — one string per step
- Match the original recipe's step structure as closely as possible
- Do not number the steps
- Only split if a single step contains truly unrelated actions
- When steps reference ingredient groups (e.g. "add the marinade ingredients"),
  keep that reference as-is — it maps to the group labels in the ingredient list

NUTRITION (per serving):
- If the recipe page includes a nutritional information panel, extract:
  "calories": integer (kcal per serving),
  "protein_g": number (grams of protein per serving),
  "fibre_g": number (grams of fibre per serving)
- Use the per-serving figures, not per-100g or totals
- Round calories to nearest integer, protein and fibre to 1 decimal place
- If nutritional info is not present on the page, omit all three keys entirely

GENERAL:
- quantity must always be a number
- notes: brief prep details only (e.g. "finely chopped") — omit if not useful
- omit keys entirely rather than using null, except for "group" which should be null not omitted
- ignore advertising, comments, and unrelated page content
"""


# ---------------------------------------------------------------------------
# Validation / suggestion prompt
# ---------------------------------------------------------------------------

VALIDATION_PROMPT = """
You are a culinary ingredient analyst. Given a list of ingredient names from a recipe,
identify two types of issues and return ONLY valid JSON with no preamble or fences.

Issues to find:

1. ALIASES — ingredients that are different names for essentially the same thing
   and can be used interchangeably without affecting the dish.
   Examples of valid aliases:
   - "Cooking salt" -> "Salt"
   - "Plain flour" -> "Flour"
   - "Chicken broth" -> "Chicken stock"
   - "Spring onion" -> "Green onion"
   - "Canola oil" -> "Oil"
   - "Coriander" -> "Cilantro" (only if clearly same use in context)

   Examples of things that are NOT aliases (do not suggest these):
   - White pepper / Black pepper / Pepper — different flavour profiles
   - Butter / Oil — different fat types, not interchangeable in all contexts
   - Lime / Lemon — different flavour
   - Sweet paprika / Smoked paprika — different flavour

2. CONSOLIDATIONS — two or more ingredients that come from the same physical
   source ingredient, where the recipe uses different parts.
   Examples:
   - "Lemon juice" + "Lemon zest" -> "Lemon (juice and zest)"
   - "Egg yolk" + "Egg white" -> "Egg"
   - "Orange juice" + "Orange zest" -> "Orange (juice and zest)"
   Only consolidate when BOTH parts appear in the ingredient list.

Return format:
{
  "aliases": [
    {
      "raw_name": "Cooking salt",
      "canonical_name": "Salt",
      "reason": "Cooking salt and salt are interchangeable in all cooking contexts"
    }
  ],
  "consolidations": [
    {
      "source_names": ["Lemon juice", "Lemon zest"],
      "consolidated_name": "Lemon (juice and zest)",
      "reason": "Both lemon juice and zest come from the same lemon"
    }
  ]
}

If nothing to suggest, return {"aliases": [], "consolidations": []}

Ingredient list:
"""


# ---------------------------------------------------------------------------
# Fetch helpers
# ---------------------------------------------------------------------------

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-AU,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
}

MIN_TEXT_LENGTH = 500


def _extract_jsonld_nutrition(html: str) -> str:
    """
    Extract nutrition data from JSON-LD structured data blocks.
    Recipe sites like RecipeTin Eats embed nutrition as schema.org/Recipe JSON-LD
    inside <script type="application/ld+json"> tags. Our HTML stripper removes
    all script tags, so we must pull this out before stripping.
    """
    import json as _json
    blocks = re.findall(
        r'<script[^>]*type=["\'\']application/ld\+json["\'\'][^>]*>(.*?)</script>',
        html, re.DOTALL | re.IGNORECASE
    )
    nutrition_lines = []
    for block in blocks:
        try:
            data = _json.loads(block.strip())
            # Handle both single object and @graph array
            items = data if isinstance(data, list) else data.get("@graph", [data])
            for item in items:
                nutrition = item.get("nutrition") if isinstance(item, dict) else None
                if nutrition:
                    cal = nutrition.get("calories", "")
                    protein = nutrition.get("proteinContent", "")
                    fibre = nutrition.get("fiberContent", "") or nutrition.get("fibreContent", "")
                    fat = nutrition.get("fatContent", "")
                    carbs = nutrition.get("carbohydrateContent", "")
                    if cal or protein or fibre:
                        nutrition_lines.append(
                            f"Nutritional information per serving: "
                            f"Calories {cal}, Protein {protein}, "
                            f"Fibre {fibre}, Fat {fat}, Carbs {carbs}"
                        )
        except Exception:
            continue
    return "\n".join(nutrition_lines)


def _strip_html(html: str) -> str:
    text = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.DOTALL)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


async def _fetch_direct(url: str, client: httpx.AsyncClient) -> str | None:
    try:
        resp = await client.get(url, headers=BROWSER_HEADERS, follow_redirects=True)
        resp.raise_for_status()
        # Extract structured nutrition data before stripping (script tags get removed)
        nutrition_data = _extract_jsonld_nutrition(resp.text)
        text = _strip_html(resp.text)
        if nutrition_data:
            text = text + "\n\n" + nutrition_data
        if len(text) >= MIN_TEXT_LENGTH:
            return text[:20000]
    except Exception:
        pass
    return None


async def _fetch_via_jina(url: str, client: httpx.AsyncClient) -> str | None:
    try:
        resp = await client.get(
            f"https://r.jina.ai/{url}",
            headers={**BROWSER_HEADERS, "Accept": "text/plain"},
            follow_redirects=True,
            timeout=20.0,
        )
        resp.raise_for_status()
        text = resp.text.strip()
        if len(text) >= MIN_TEXT_LENGTH:
            return text[:15000]
    except Exception:
        pass
    return None


async def fetch_url_text(url: str) -> str:
    async with httpx.AsyncClient(timeout=15.0) as client:
        text = await _fetch_direct(url, client)
        if text:
            return text
        text = await _fetch_via_jina(url, client)
        if text:
            return text
    raise ValueError(
        "Could not retrieve recipe page. The site may be blocking automated access. "
        "Try copying and pasting the recipe text directly instead."
    )


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _parse_json(raw: str) -> dict | list:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    return json.loads(raw)


def _format_instructions(raw: str | list) -> str:
    if isinstance(raw, list):
        steps = [s.strip() for s in raw if s.strip()]
    else:
        parts = re.split(r'\n+|\r\n+', raw.strip())
        steps = [re.sub(r'^\d+[\.\)]\s*', '', p).strip() for p in parts if p.strip()]
    return "\n".join(f"{i+1}. {step}" for i, step in enumerate(steps))


# ---------------------------------------------------------------------------
# Main import functions
# ---------------------------------------------------------------------------

async def extract_recipe(text: str) -> dict:
    """Run Claude extraction on raw recipe text. Returns parsed dict."""
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    message = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": EXTRACT_PROMPT + "\n\nRecipe text:\n" + text}],
    )
    parsed = _parse_json(message.content[0].text)
    if "instructions" in parsed:
        parsed["instructions"] = _format_instructions(parsed["instructions"])
    return parsed


async def suggest_validations(ingredient_names: list[str]) -> dict:
    """
    Ask Claude to suggest aliases and consolidations for a list of ingredient names.
    Returns {"aliases": [...], "consolidations": [...]}
    """
    if not ingredient_names:
        return {"aliases": [], "consolidations": []}

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    name_list = "\n".join(f"- {n}" for n in ingredient_names)
    message = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": VALIDATION_PROMPT + name_list}],
    )
    try:
        return _parse_json(message.content[0].text)
    except Exception:
        return {"aliases": [], "consolidations": []}


async def import_recipe_from_url(url: str) -> dict:
    """Fetch URL and extract recipe. Returns parsed dict (not yet saved)."""
    text = await fetch_url_text(url)
    return await extract_recipe(text)
