# EduCare accounts, courses and video uploads — deployment guide

This update preserves the two React frontends and the sage-green EduCare design. The Node/Express API and PostgreSQL database **cannot run on GitHub Pages**; GitHub Pages only serves the React frontends.

## Included

- Student sign-up (`POST /auth/register`) and login (`POST /auth/login`) with password hashing and rate limiting
- Student enrollment and saved lesson progress
- Teacher/admin studio: create course drafts, add lessons, publish/unpublish
- MP4 and WebM upload with size limit (default 200 MB), basic file-signature check and progress indicator
- Protected video streaming with HTTP Range support for seeking and a temporary playback token
- Staff-only management routes; new accounts always have the STUDENT role

## Run locally in WSL

From the project root:

```bash
npm install --no-audit --no-fund --prefer-offline --maxsockets=3
cp apps/api/.env.example apps/api/.env
cp apps/learn/.env.example apps/learn/.env
cp apps/site/.env.example apps/site/.env
# Edit apps/api/.env and generate a random JWT_SECRET
openssl rand -hex 32
# Paste the result into JWT_SECRET in apps/api/.env
# Start database using Docker Desktop with WSL integration enabled
docker compose up -d postgres
npm run db:generate
npm run db:migrate
npm run db:seed
```

When prompted for a migration name, use `add_video_support`. If your database is new, it creates all tables including the video fields. To generate a reusable migration while the DB is running, use `npm run db:migrate`.

In separate terminals:

```bash
npm run dev:api
npm run dev:learn
npm run dev:site
```

Open `http://localhost:5174` for EduCare and `http://localhost:5173` for UniCare. The EduCare `.env` file points to `http://localhost:4000`.

### Set up your first administrator

1. Create a normal account in EduCare using the registration form.
2. In WSL with `apps/api/.env` configured and PostgreSQL running:

```bash
npm run admin:promote -w @unicare/api -- you@yourdomain.org
```

3. Sign out and sign back in. The **Manage courses** menu appears for ADMIN and TEACHER accounts.
4. Create a draft course, add a lesson, upload a video and publish the course.

**Never add a public endpoint to assign ADMIN roles.** Only a trusted operator with server/database access should promote staff.

## Deployment

- **GitHub Pages**: frontends only, from `.github/workflows/pages.yml`.
- **Node API**: deploy `apps/api` to a Node service with HTTPS and a persistent disk, or adapt uploads to S3/R2/Bunny Stream before production.
- **PostgreSQL**: managed PostgreSQL (e.g. Neon, Railway, Render, Supabase DB). Set `DATABASE_URL` to the provider's connection string.
- Backend environment: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS=https://asfawabel.github.io`, `PUBLIC_API_URL=https://YOUR-API-HOST`, `UPLOAD_DIR=/persistent/uploads`. Add other env variables as needed.
- On the server, run `npm run db:generate` and `npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma` from the repository root. To build API: `npm run build -w @unicare/api`; start it with `npm run start -w @unicare/api`.
- In GitHub repository **Settings → Secrets and variables → Actions → Variables**, set `VITE_API_URL` to the HTTPS API URL (no trailing slash). The existing GitHub Actions workflow reads this value and rebuilds both React sites on the next push.
- Once set, verify `/health`, then registration, enrollment, teacher uploads and video playback.

**Important:** `UPLOAD_DIR` must be backed by durable storage on your API host. Ephemeral host disks are wiped on redeployment and would erase course videos. A 200 MB limit is suitable for a starter MVP, not a large streaming service. Production delivery should use an object store or dedicated streaming service for large videos and transcoding. Restrict backups and access to user records, add email verification and password reset, and use secure cookie sessions rather than localStorage tokens before handling sensitive information or a large public launch.

## API reference

| Method | Route | Authentication |
|---|---|---|
| POST | `/auth/register` | Public |
| POST | `/auth/login` | Public |
| GET | `/me` | Student/staff token |
| GET | `/courses` and `/courses/:slug` | Public (published only) |
| POST | `/courses/:slug/enroll` | Signed-in |
| POST | `/lessons/:id/complete` | Enrolled student |
| GET | `/admin/courses` | Teacher/admin |
| POST | `/admin/courses` | Teacher/admin |
| PATCH | `/admin/courses/:id` | Teacher/admin |
| POST | `/admin/courses/:id/lessons` | Teacher/admin |
| POST | `/admin/lessons/:id/video` | Teacher/admin, multipart form field `video` |
| POST | `/lessons/:id/playback` | Enrolled student or staff |
| GET | `/media/:id?ticket=...` | Temporary signed playback ticket |

Video links are temporary and should not be shared. The starter implementation validates file type by header, but does not virus-scan, transcode, generate thumbnails or support resumable uploads; add these before scaling. At present the course creation endpoint does not implement complex teacher ownership/assignment—any TEACHER can manage courses. Use ADMIN-only controls or course-level ownership when the NGO adds multiple educators.
