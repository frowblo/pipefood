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
You are a recipe parser. Extract the recipe from the text below and return ONLY valid JSON
with no preamble, no markdown fences, and no extra keys.

Required format:
{
  "name": "Recipe name",
  "description": "One sentence description",
  "prep_minutes": 10,
  "cook_minutes": 30,
  "base_servings": 4,
  "instructions": "Full cooking instructions as a single string.",
  "ingredients": [
    {
      "name": "chicken thigh",
      "quantity": 600,
      "unit": "g",
      "notes": "bone-in, skin on"
    }
  ]
}

Rules:
- quantity must be a number (not a string)
- unit must be one of: g, kg, ml, l, tsp, tbsp, cup, piece, bunch, clove, pinch, slice
- ingredient name should be lowercase, generic (no brand names)
- notes is optional — only include prep details like "finely chopped" or "skin on"
- if a value is unknown, omit the key rather than using null

Recipe text:
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

        # Direct fetch failed or returned too little — try jina
        text = await _fetch_via_jina(url, client)
        if text:
            return text

    raise ValueError(
        "Could not retrieve recipe page. The site may be blocking automated access. "
        "Try copying and pasting the recipe text directly instead."
    )


async def import_recipe_from_url(url: str) -> dict:
    """Import and parse a recipe from a URL using Claude."""
    raw_text = await fetch_url_text(url)
    return await parse_recipe_text(raw_text)


async def parse_recipe_text(text: str) -> dict:
    """Use Claude to extract structured recipe data from arbitrary text."""
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    message = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        messages=[{"role": "user", "content": EXTRACT_PROMPT + text}],
    )

    raw = message.content[0].text.strip()
    # Strip accidental markdown fences
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]

    return json.loads(raw)
