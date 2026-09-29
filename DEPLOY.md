# Barello Server Deploy

## Required env vars

- `DATABASE_URL`
- `JWT_SECRET`
- `CLIENT_URL`
- `ADMIN_CLIENT_URL`
- `PORT`

Optional moderator variables:

- `MODERATOR_1_EMAIL`
- `MODERATOR_1_PASSWORD_HASH`
- `MODERATOR_1_NAME`
- `MODERATOR_2_EMAIL`
- `MODERATOR_2_PASSWORD_HASH`
- `MODERATOR_2_NAME`
- `MODERATOR_3_EMAIL`
- `MODERATOR_3_PASSWORD_HASH`
- `MODERATOR_3_NAME`

Optional test variable:

- `ALLOW_TEST_OTP`

## Deploy order

1. Install dependencies:

```bash
npm ci
```

2. Generate Prisma client for the target server OS:

```bash
npm run prisma:generate
```

3. Build the server:

```bash
npm run build
```

4. Apply production migrations:

```bash
npm run prisma:deploy
```

5. Start the server:

```bash
npm start
```

## One-command deploy

```bash
npm run deploy
```

## Notes

- Production entrypoint is `dist/src/main.js`.
- `npm run build` also copies the generated Prisma client into `dist/src/generated/prisma`, which is required for runtime imports used by this codebase.
- `postinstall` runs `prisma generate`, which is important when deploying to Linux because the generated Prisma engine is platform-specific.
- `ALLOW_TEST_OTP=true` temporarily allows the test OTP `1234` even when `NODE_ENV=production`. Keep it disabled by default.
- Uploaded price files are stored in the local `uploads/` directory, so that directory must be writable on the server.
- If the frontend is deployed together with this backend, the server will serve `../client/dist` when that directory exists.
