# Softframe — Creator Studio

A small shared workspace for Zeel, Palak and Nishita. One Node.js service serves the website and API; PostgreSQL keeps ideas, comments, votes, channels and calendar items shared. There is no frontend build system, separate frontend container, or media upload service.

## What is included

- Pastel responsive dashboard and two starter AI channel cards
- Shared idea pipeline: Idea → In Discussion → Approved → In Production → Ready to Post → Published
- One approval per teammate; an idea moves to Approved after two yes votes
- Idea notes, channel selection, assignment and target dates
- Prompt library with three sample prompts and shared PostgreSQL storage for new entries
- Shared schedule and team turns stored in PostgreSQL
- Preview / thumbnail URL locker (links only; no file upload)
- Optional single studio passcode

## Run locally

Requirements: Node.js 20 or newer and PostgreSQL 14 or newer.

1. Create a PostgreSQL database named `softframe`. For example, with a local PostgreSQL client:

   ```sql
   CREATE DATABASE softframe;
   ```

2. Copy `.env.example` to `.env`, then set `DATABASE_URL` to your local PostgreSQL connection string. Set `APP_PASSWORD` and `SESSION_SECRET` to private values. Leave `PGSSL=false` for local PostgreSQL.

3. Install and start the app:

   ```bash
   npm install
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000). The app creates its tables and initial demo channels, ideas and schedule the first time it connects.

If `APP_PASSWORD` is blank, the local app opens without a passcode. Do not leave it blank on a public deployment.

## Deploy on Railway

The app is one service and Postgres is a second service in the same Railway project. No Dockerfile or separate frontend service is needed. Railway detects Node from `package.json` and runs `npm start`.

1. Push this folder to a GitHub repository. Keep `.env` out of Git; `.gitignore` already excludes it.
2. In Railway, create a project and deploy the GitHub repository as a service.
3. In the same Railway project, choose **New → Database → PostgreSQL**.
4. Open the app service’s **Variables** and add:

   - `DATABASE_URL` = reference the Postgres service’s `DATABASE_URL` variable, e.g. `${{Postgres.DATABASE_URL}}` (use the exact Postgres service name shown in your project).
   - `APP_PASSWORD` = a private passcode you share with your three collaborators.
   - `SESSION_SECRET` = a long random secret (for example, generate one locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`).

   Railway provides `PORT`; the app listens on it automatically. Railway’s internal Postgres URL is the preferred connection for services in the same project, so `PGSSL` is not needed.

5. Redeploy if the service does not deploy automatically after variables are added. Wait for both Postgres and the app to become healthy.
6. In the app service, open **Settings → Networking → Generate Domain**. Visit the generated URL and unlock the studio.
7. In the Postgres service, open **Backups** and choose a backup schedule that fits your needs. Railway’s Postgres service persists data on its volume, but you should still make and verify backups.

Railway’s Free plan currently includes **$1 of resource credit per month**, within the Free plan’s service limits. It is not possible to promise that a continuously running Node app plus PostgreSQL will stay under $1: Railway bills for actual RAM, CPU, egress and volume storage, and the combined usage of both services can use up the credit. Check **Usage** in Railway before and after deploying. The free trial currently starts with a one-time $5 credit for up to 30 days; after it expires, the Free plan’s $1 monthly credit applies. See [Railway plans](https://docs.railway.com/pricing/plans) and [the Free Trial](https://docs.railway.com/pricing/free-trial) for current details.

## Data and privacy notes

- Do not add real secrets, private media, or sensitive personal information to sample notes.
- The passcode is a simple shared gate for a small trusted team, not per-person identity or a full account system. Anyone with the shared passcode can act under any of the three names using the name selector.
- Ideas, votes, comments, schedule items, saved prompts and review links are in PostgreSQL.
- File uploads, video storage, Drive OAuth and YouTube integration are intentionally not implemented yet. For now, the review locker accepts a link only in the UI; Google Drive setup can be planned separately.

## Common commands

```bash
npm install
npm start
```
