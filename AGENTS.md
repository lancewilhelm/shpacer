# Repository Guidelines

## Assistant Workflow Expectations

### Assumptions

- For web-based development, assume the project runs in a local dev environment using `pnpm`.
- Assume the dev server runs at `http://localhost:3000`.
- Assume Tailwind CSS v4 is used; prefer existing CSS variables (e.g. `--main-color`) over hard-coded Tailwind color classes when possible.

### Drizzle ORM (SQLite)

- Schema lives in `app/utils/db/schema.ts`.
- If you change the database schema, run `pnpm run db:generate` then `pnpm run db:migrate` to apply changes locally.

### After Edits

- Check project-wide diagnostics after edits (not just touched files) and address any newly introduced errors.
- Keep `docs/` up-to-date for user-facing behavior changes; docs should avoid large code blocks and should reference relevant files for implementation details.
- Provide a concise summary of edits, and include a **How to test** section with concrete steps.
- Do not perform any git actions without prior consent. If git actions are requested/approved, use Conventional Commits for commit messages.

## Project Structure

- `app/`: Nuxt 4 client app (pages, components, stores, composables, assets).
- `server/`: Nuxt server routes and utilities.
  - `server/api/**`: file-based API endpoints (e.g. `courses/[id].get.ts`).
- `app/utils/db/schema.ts`: Drizzle ORM schema (SQLite/libSQL).
- `.drizzle/`: generated migrations/artifacts (via `drizzle-kit`).
- `public/`: static assets served as-is.
- `data/`: local SQLite database and fixtures (`data/shpacer.db`, `data/test-courses/**`).

## Build, Test, and Development Commands

- `pnpm install`: install dependencies (uses `pnpm-lock.yaml`).
- `pnpm dev`: run Nuxt dev server at `http://localhost:3000`.
- `pnpm build` / `pnpm preview`: production build and local preview.
- `pnpm typecheck`: Nuxt/TypeScript typechecking.
- `pnpm lint`: ESLint for `.ts`/`.js`/`.vue`.
- `pnpm format` / `pnpm format:fix`: Prettier formatting.
- DB (SQLite + Drizzle): `pnpm db:push`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio`.

Tip: for first-time local setup, `./init.sh` creates `./data`, writes a local `.env` secret, and runs `drizzle-kit push`.

## Coding Style & Naming Conventions

- Formatting: Prettier (single quotes). Run `pnpm format:fix` before opening a PR.
- Linting: ESLint via `eslint.config.mjs`.
- Vue/Nuxt: components in `app/components/**` use `PascalCase.vue`; Pinia stores live in `app/stores/*.ts`.
- API endpoints: prefer explicit method suffixes: `*.get.ts`, `*.post.ts`, `*.put.ts`, `*.delete.ts` under `server/api/`.

## Testing Guidelines

- No dedicated automated test suite is configured yet (there is no `pnpm test` script).
- Treat `pnpm typecheck` + `pnpm lint` as required CI-equivalent checks until tests are added.

## Commit & Pull Request Guidelines

- Prefer Conventional Commit-style subjects (used by `standard-version`): `feat: …`, `fix: …`, `refactor: …`, `style: …`.
- PRs: include a short description, link the relevant issue (if any), and add screenshots for UI changes.

## Security & Configuration

- Secrets/config live in env vars; do not commit `.env`.
- Authentication is handled via Better Auth; keep session/authorization logic in server routes and avoid leaking privileged fields in public endpoints.
