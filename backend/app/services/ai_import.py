"""
AI recipe import service.

Given a URL or raw text, uses Claude to extract a structured recipe
including name, ingredients (with quantities and units), and instructions.
"""
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


async def fetch_url_text(url: str) -> str:
    """Fetch raw text from a recipe URL."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        # Very rough text extraction — strip HTML tags
        import re
        text = re.sub(r"<[^>]+>", " ", resp.text)
        text = re.sub(r"\s+", " ", text)
        return text[:12000]  # Claude context limit buffer


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
