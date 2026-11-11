# UniCare + EduCare

A GitHub-ready, TypeScript monorepo for **UniCare** (umbrella NGO) and **EduCare** (separate education portal). **UniCare is a working name.** This is a starter MVP, not a production-approved nonprofit platform.

## What is included

- `apps/site`: responsive public UniCare website (React + Vite + TypeScript)
- `apps/learn`: EduCare learner website (React + Vite + TypeScript)
- `apps/api`: Express REST API with registration, login, courses, enrollment, and lesson progress
- PostgreSQL + Prisma schema and 6 starter courses with lessons
- GitHub Actions workflow that publishes both React apps to **one GitHub Pages site**, with independent frontends at `/` and `/learn/`
- Docker Compose for local PostgreSQL

## Requirements

- Node.js 22+, npm 10+
- Docker Desktop **or** an existing PostgreSQL 16+ server

## Local setup

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/site/.env.example apps/site/.env
cp apps/learn/.env.example apps/learn/.env
```

On Windows PowerShell, replace `cp` with `Copy-Item`.

Edit `apps/api/.env` and set **JWT_SECRET** to a secure random value. The example is deliberately not a deployable secret.

```bash
docker compose up -d
npm run db:generate
npm run db:migrate
npm run db:seed
```

When Prisma prompts for a migration name, enter `init`.

Run **three terminal windows**:

```bash
npm run dev:api
npm run dev:site
npm run dev:learn -- --port 5174
```

> Vite can assign another port if 5174 is already taken. Set `VITE_LEARN_PATH` and `CORS_ORIGINS` accordingly.

Open:

- Main NGO website: `http://localhost:5173`
- EduCare portal: `http://localhost:5174`
- Backend health check: `http://localhost:4000/health`

You can explore both frontends before configuring the backend. The course cards then use *preview content*; registration, enrollment, and course detail content require the API.

## Publish the frontends to GitHub Pages

GitHub Pages **does not run Node.js servers or PostgreSQL**. It only hosts the built React assets. The API and database must run on another host (such as Render/Railway/Fly.io and managed PostgreSQL). Until then, the site and catalog work as a preview, while account/enrollment features display an API-unavailable message.

1. Create a new GitHub repository (suggested: `unicare-platform`).
2. From this folder:

   ```bash
   git init
   git add .
   git commit -m "Initial UniCare and EduCare platform"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/unicare-platform.git
   git push -u origin main
   ```

3. In GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Push to `main`; the `.github/workflows/pages.yml` workflow publishes automatically.
5. The URLs will be:
   - `https://YOUR_USERNAME.github.io/unicare-platform/` — UniCare
   - `https://YOUR_USERNAME.github.io/unicare-platform/learn/` — EduCare
6. If you chose another repository name, the workflow automatically adjusts the built asset paths.
7. If you deploy an API later, define repository variable **`VITE_API_URL`** at **Settings → Secrets and variables → Actions → Variables**, e.g. `https://your-api.example.com`. Re-run the deployment workflow.
8. Update the API's `CORS_ORIGINS` to include your GitHub Pages origin, e.g. `https://YOUR_USERNAME.github.io` (origin only, no paths).

> For a future custom domain, update the base paths/workflow and DNS configuration. HTTPS is essential when accounts are enabled.

## API endpoints

| Method | Endpoint | Access |
|---|---|---|
| GET | `/health` | Public |
| GET | `/courses` | Public |
| GET | `/courses/:slug` | Public |
| POST | `/auth/register` | Public |
| POST | `/auth/login` | Public |
| GET | `/me` | Bearer token |
| GET | `/me/courses` | Bearer token |
| POST | `/courses/:slug/enroll` | Bearer token |
| GET | `/courses/:slug/progress` | Bearer token |
| POST | `/lessons/:id/complete` | Bearer token; enrolled learners |

## MVP limitations and next steps

- **Demo content only:** replace sample courses and text with approved NGO materials.
- **No real donation collection or contact-email storage.** The contact section only prepares an email link to `hello@unicare.example`, a placeholder which must be replaced with a real address.
- **No administrator CMS yet.** Course updates are currently managed through the seed and database, not an admin interface.
- **No password reset / email verification / MFA.** Add these before admitting real learners.
- Current demonstration uses bearer JWTs in localStorage. For production, migrate to secure HttpOnly cookie sessions with CSRF protection, implement stronger abuse protection, audit logging, account deletion and privacy controls.
- Before collecting information from children, implement an age-appropriate access and consent model, minimization of personal data, moderation and child safeguarding policies, and a compliance assessment covering Ethiopia and other user locations.
- Check NGO naming/trademark/domain availability, registration obligations and accessibility before launch.
- Use course content from educators, not automated filler, before presenting as a real education service.

## Deployment architecture

```text
GitHub Pages
├── /            → React UniCare public website
└── /learn/      → React EduCare learning portal
                         │
                         ▼
                    Express API (external hosting)
                         │
                         ▼
                 PostgreSQL (managed database)
```

Both frontends can later move to separate domains, e.g. `unicare.org` and `learn.unicare.org`, without changing the API/database structure.
