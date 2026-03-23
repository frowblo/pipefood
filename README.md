# PipeFood

A self-hosted meal management system. Plan your week, aggregate ingredients into a smart shopping list, track pantry stock, and minimise waste.

## Features

- **Meal planner** — weekly grid, multiple meal types per day, adjustable servings
- **Recipe library** — manual entry or AI import from any recipe URL
- **Smart shopping list** — aggregates ingredients across all meals, deducts pantry stock, rounds to pack sizes, flags leftovers
- **Pantry tracker** — track stock with expiry dates; auto-deducted from shopping lists
- **AI recipe import** — paste a URL, Claude extracts ingredients and instructions

---

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.12) |
| Database | PostgreSQL 16 |
| Frontend | React + Vite + TypeScript |
| Deployment | Docker Compose |

---

## Local development

```bash
git clone https://github.com/you/pipefood.git
cd pipefood
cp .env.example .env
# Edit .env — fill in DB_PASSWORD, SECRET_KEY, ANTHROPIC_API_KEY, DOCKER_HUB_USER
```

For local dev, temporarily swap the `image:` lines in `docker-compose.yml` back to `build:` directives:

```yaml
backend:
  build: ./backend

frontend:
  build: ./frontend
```

Then:

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

---

## Deploying to Synology NAS (Container Manager)

### 1. Build and push images to Docker Hub

Do this on your dev machine after any code change:

```bash
docker login

# Backend
docker build -t yourdockerhub/pipefood-backend:latest ./backend
docker push yourdockerhub/pipefood-backend:latest

# Frontend — VITE_API_URL must be your Cloudflare Tunnel domain
docker build \
  --build-arg VITE_API_URL=https://your-tunnel-domain.com \
  -t yourdockerhub/pipefood-frontend:latest ./frontend
docker push yourdockerhub/pipefood-frontend:latest
```

### 2. Prepare the NAS

SSH into the NAS and create the data directory:

```bash
mkdir -p /volume1/docker/pipefood/data/postgres
```

Copy `docker-compose.yml` and your filled-in `.env` to `/volume1/docker/pipefood/`.

### 3. Container Manager

1. Container Manager → Project → Create
2. Name: `pipefood`
3. Set path to `/volume1/docker/pipefood/`
4. Container Manager reads `docker-compose.yml` and `.env`, pulls images, starts services

### 4. Cloudflare Tunnel

Point your tunnel to:
- `http://localhost:5173` — frontend (main app)
- `http://localhost:8000` — backend API (if you want a separate API subdomain)

No ports need to be open on your router.

---

## Update workflow

```bash
# 1. Make changes, commit, push to GitHub
git add . && git commit -m "your change"
git push

# 2. Rebuild changed image(s) and push to Docker Hub
docker build -t yourdockerhub/pipefood-backend:latest ./backend
docker push yourdockerhub/pipefood-backend:latest

# 3. In Container Manager: Project → pipefood → Stop → pull images → Start
```

Only rebuild the frontend image if frontend code changed or VITE_API_URL changed.

---

## Project structure

```
pipefood/
├── backend/
│   ├── app/
│   │   ├── api/routes/      # FastAPI route handlers
│   │   │   ├── recipes.py
│   │   │   ├── plans.py
│   │   │   └── shopping_pantry.py
│   │   ├── core/config.py   # Settings via pydantic-settings
│   │   ├── db/session.py    # Async SQLAlchemy engine
│   │   ├── models/models.py # All ORM models
│   │   ├── schemas/schemas.py # Pydantic request/response schemas
│   │   ├── services/
│   │   │   ├── shopping.py  # Aggregation + wastage calculation
│   │   │   └── ai_import.py # Claude recipe URL extraction
│   │   └── main.py
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── lib/api.ts
│   │   ├── pages/
│   │   │   ├── PlannerPage.tsx
│   │   │   ├── RecipesPage.tsx
│   │   │   ├── ShoppingPage.tsx
│   │   │   └── PantryPage.tsx
│   │   ├── App.tsx
│   │   ├── App.css
│   │   └── main.tsx
│   ├── Dockerfile
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Roadmap

- Meal suggestions based on pantry contents (AI)
- "Use up leftovers" recipe suggestions
- Shared shopping list (family/partner sync)
- Cost tracking per meal
- Nutrition data via Open Food Facts API
- Alembic migrations (replace startup create_all)
