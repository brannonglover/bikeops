# Bike Ops

Monorepo for Bike Ops.

| Folder        | What it is                                             | Formerly            |
| ------------- | ------------------------------------------------------ | ------------------- |
| `apps/web`    | Next.js web app and API (bikeops.co), Prisma, catalog  | `bikeopsco` repo    |
| `apps/mobile` | Expo / React Native staff app (iOS + Android)          | `bikeops` repo      |

The two apps are installed and built independently. There is no root
`package.json` or workspace setup: the web app is on React 18 / Next 14 and the
mobile app on React 19 / Expo SDK 54, so sharing a `node_modules` would fight
over React. Run every command from inside the app's folder.

## Web (`apps/web`)

```bash
cd apps/web
npm install
npm run dev          # http://localhost:3000
```

Deploys go through the Vercel CLI from `apps/web` (the `.vercel` link lives
there). See `apps/web/DEPLOYMENT.md`. The production `build` script runs
`prisma migrate deploy`, so any production build applies pending migrations.

## Mobile (`apps/mobile`)

```bash
cd apps/mobile
npm install
npx expo start
```

EAS builds and updates run from `apps/mobile` (`eas.json` lives there).

## Shared code

`src/lib/catalog-chips.ts` exists in both apps and must stay identical; change
both together.

## History

Both original repositories' histories are preserved. Files were moved into
`apps/*` in a single rename commit per app, so use `--follow` to see a file's
history from before the move:

```bash
git log --follow apps/web/src/lib/voice.ts
```

Web release tags (`release-*`) and mobile version tags (`v1.*`) were carried
over unchanged.
