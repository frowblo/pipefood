"""
AI recipe import service.

Given a URL or raw text, uses Claude to extract a structured recipe
including name, ingredients (with quantities and units), and instructions.

Fetch strategy:
1. Direct fetch with browser-like headers and redirect following
2. If that returns a redirect loop, bot wall, or too little text —
   fall back to jina.ai/r/ reader proxy which strips JS/ads and
   returns clean markdown. No API key required.
"""
import re
import httpx
import anthropic
import json

from app.core.config import settings


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
    "Heat oil in a large pan over medium-high heat.",
    "Add the curry paste and cook, stirring, for 1 minute until fragrant.",
    "Add the chicken and cook for 3-4 minutes until sealed."
  ],
  "ingredients": [
    {
      "name": "Chicken thigh",
      "quantity": 600,
      "unit": "g",
      "notes": "bone-in, skin on"
    },
    {
      "name": "Coconut milk",
      "quantity": 1.5,
      "unit": "cups",
      "notes": null
    }
  ]
}

Rules — follow these exactly:

NAMING:
- Recipe name: title case (e.g. "Green Chicken Curry with Coconut Sambal")
- Ingredient names: sentence case, first word capitalised only (e.g. "Chicken thigh", "Fish sauce", "Spring onion")
- Description: full sentence with correct punctuation

UNITS — liquids:
- All liquid ingredients (water, stock, milk, cream, oil, sauce, juice, wine, coconut milk, etc.)
  must use "cups", rounded to the nearest 1/4 cup (0.25, 0.5, 0.75, 1, 1.25, etc.)
- Very small liquid amounts (less than 1/4 cup) use "tbsp" or "tsp" as appropriate
- Do NOT use ml or l for any liquid

UNITS — solids:
- All solid ingredients must use "g" (grams)
- Do NOT use oz, lb, or kg

UNITS — exceptions (leave as-is, do not convert):
- bunch, head, clove, pinch, sprig, stalk, slice, sheet, piece, can, jar, sachet, packet

INSTRUCTIONS:
- Return as a JSON array of strings — one string per step
- Each step is a single clear action, written as a complete sentence
- Do not number the steps — that is handled by the app
- Do not combine multiple actions into one step
- If the source has vague or combined steps, split them sensibly

GENERAL:
- quantity must always be a number (never a string)
- notes should only contain brief prep details like "finely chopped" or "skin removed" — omit if not useful
- if a value is unknown, omit the key entirely rather than using null
- ignore advertising, nutritional panels, comments, and unrelated page content
"""


# Browser headers that pass most basic bot checks
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

# Minimum characters of useful text before we consider a fetch successful
MIN_TEXT_LENGTH = 500


def _strip_html(html: str) -> str:
    """Strip HTML tags and collapse whitespace."""
    text = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.DOTALL)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


async def _fetch_direct(url: str, client: httpx.AsyncClient) -> str | None:
    """Attempt a direct fetch with redirect following. Returns text or None."""
    try:
        resp = await client.get(url, headers=BROWSER_HEADERS, follow_redirects=True)
        resp.raise_for_status()
        text = _strip_html(resp.text)
        if len(text) >= MIN_TEXT_LENGTH:
            return text[:15000]
    except Exception:
        pass
    return None


async def _fetch_via_jina(url: str, client: httpx.AsyncClient) -> str | None:
    """
    Fetch via jina.ai reader proxy — returns clean markdown of the page.
    Handles JS-heavy sites, paywalls, and redirect loops that block direct fetches.
    """
    jina_url = f"https://r.jina.ai/{url}"
    try:
        resp = await client.get(
            jina_url,
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
    """
    Fetch recipe page text using a two-stage strategy:
    1. Direct fetch (fast, works for most sites)
    2. Jina reader proxy (fallback for redirects, bot walls, JS-heavy sites)
    """
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


def _format_instructions(raw: str | list) -> str:
    """
    Normalise instructions to a numbered list string regardless of
    whether Claude returned a list or a legacy single string.
    """
    if isinstance(raw, list):
        steps = [s.strip() for s in raw if s.strip()]
    else:
        # Legacy single-string fallback — split on newlines or numbers
        parts = re.split(r'\n+|\r\n+', raw.strip())
        steps = [re.sub(r'^\d+[\.\)]\s*', '', p).strip() for p in parts if p.strip()]

    return "\n".join(f"{i+1}. {step}" for i, step in enumerate(steps))


async def import_recipe_from_url(url: str) -> dict:
    """Import and parse a recipe from a URL using Claude."""
    raw_text = await fetch_url_text(url)
    return await parse_recipe_text(raw_text)


async def parse_recipe_text(text: str) -> dict:
    """Use Claude to extract structured recipe data from arbitrary text."""
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    message = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": EXTRACT_PROMPT + "\n\nRecipe text:\n" + text}],
    )

    raw = message.content[0].text.strip()
    # Strip accidental markdown fences
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]

    parsed = json.loads(raw)

    # Normalise instructions to numbered string regardless of Claude's output format
    if "instructions" in parsed:
        parsed["instructions"] = _format_instructions(parsed["instructions"])

    return parsed
