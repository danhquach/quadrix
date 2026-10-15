# Cloud save backend

One Supabase project (free tier) keeps each player's profile so it can follow them to another device. Players have no account: each browser signs in as an anonymous Supabase user. This folder is the database side; the game's client is `src/ui/cloud.ts` (Cloud save on the main menu).

## What is here

```
config.toml       auth settings: anonymous sign-ins on, email sign-up off, sign-in rate limit
migrations/       SQL, applied in file-name order
tests/            SQL tests, run by `npm test` in PGlite (Postgres in WebAssembly)
```

## Data and access

| Object                                                 | Who can use it                                          |
| ------------------------------------------------------ | ------------------------------------------------------- |
| `public.saves`                                         | Signed-in players: read their own row (RLS). No writes. |
| `private.save_members`                                 | Nobody (browser → save)                                 |
| `private.link_codes`                                   | Nobody (SHA-256 of each code, save, expiry, used by)    |
| `private.redeem_failures`                              | Nobody (wrong codes, for the rate limit)                |
| `save_profile`, `create_link_code`, `redeem_link_code` | Signed-in players                                       |

The `anon` role (the public key with no sign-in) gets nothing. The `private` schema is not exposed over the API. Every write goes through the three functions, which act only on the caller's own save (`auth.uid()`).

## API

All three are called with `supabase.rpc(name, args)` and return JSON.

- `save_profile({ new_profile, base_revision })`: stores the profile if the save is still at `base_revision` (0: no save yet, which creates one). Returns `{ status: 'saved', revision, updated_at }` or `{ status: 'conflict', revision, profile, updated_at }` with the stored save (revision 0, profile null if none); the client merges and retries with that revision. A profile outside the allow-list (the client's format, `src/core/profile.ts`: exact keys, types, at most 100,000 rungs, 16-character name without control, bidi, zero-width or blank characters or stray spaces, counts 0..2^40, at most 16 modes, 128 KiB) raises `invalid profile`.
- `create_link_code()`: a code for the caller's save, 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, valid for 10 minutes and once. A new code replaces the save's unused one. `{ status: 'created', code, expires_at }` or `{ status: 'no_save' }`.
- `redeem_link_code({ code })`: attaches this browser to that code's save (case, spaces and dashes ignored). The same browser may repeat it until the code expires, while still attached to that save (a retry after a lost response); any other browser gets `invalid`. The browser's previous save is left, and deleted if no other browser uses it. After 5 wrong codes in 10 minutes a browser gets `rate_limited` for every code until the window passes. `{ status: 'linked', revision, profile, updated_at }`, `{ status: 'invalid' }` or `{ status: 'rate_limited' }`.

Deleting a user (Authentication → Users) deletes their membership and failures; a save is deleted with its last browser, and its link codes with it. Expired link codes and old failures are deleted at the end of every create and redeem. Deleting a user while that browser is mid-request can make Postgres abort one of the two (a deadlock error, nothing changed): run the delete again.

Nothing logs: no function raises a notice, and error messages never contain a code, profile, token or user id (a deleted user's still-valid token gets `not signed in`).

## Maintainer setup

Needs the [Supabase CLI](https://supabase.com/docs/guides/cli).

1. Create a project on the free tier.
2. Link and push the schema and auth settings:

   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   supabase config push
   ```

3. In the dashboard, check Settings → Data API: exposed schemas is `public` only (never `private`). Check Authentication → Sign In / Providers: "Allow anonymous sign-ins" on, email sign-up off; and Authentication → Rate Limits: anonymous sign-ins 30 per hour.
4. Settings → API Keys: copy the project URL and the **anon** (or publishable) key. Never the `service_role` or a secret key.
5. GitHub → Settings → Secrets and variables → Actions → **Variables** (not secrets; both are public by design and end up in the page): `SUPABASE_URL` and `SUPABASE_ANON_KEY`. CI passes them to `npm run build` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

For a local build, the same two names can go in a git-ignored `.env`. Set both or neither: with only one, `npm run build`, `npm run dev` and `npm test` all stop with an error.

With neither variable set, the build ships without cloud save and its Content-Security-Policy is unchanged. With both, the project origin is added to `connect-src`. The build fails if only one is set, the URL is not a bare `https://` origin, or the key is not an anon/publishable key (a `service_role` JWT or `sb_secret_` key is refused).

## Verify

- `npm test` runs `tests/saves.test.ts` against the migrations: isolation between players, no access for `anon` or to the private tables, revision conflicts, profile limits, link-code expiry, single use and retry, the redeem rate limit, and cascade delete. `tests/supabase-stub.sql` stands in for the parts of Supabase the migrations need (roles, `auth.users`, `auth.uid()`, Supabase's default grants).
- Against a local stack (Docker): `supabase start`, then `supabase db reset` applies the migrations; `supabase stop` when done.
- After `supabase db push`, in the dashboard SQL editor: `select has_table_privilege('anon', 'public.saves', 'select');` is `false`, and Database → Tables shows RLS enabled on every table.

## Changing the profile format

The server checks the client's profile format (`private.valid_profile`). A new profile field or version needs a new migration that replaces that function, merged before the client that writes the new format. A new mode also needs a `PROFILE_VERSION` bump: an older client keeps only the bests of modes it knows, so without the bump its next upload would erase the new mode's bests; with it, the older client refuses the newer save instead.

## Client behaviour

- A device that turns cloud save off and on again starts a new save; rejoining the old one takes a link code from a device still on it.
- If the server refuses a device's session (revoked, or the anonymous user deleted), cloud save turns off on that device with the status "Signed out"; its local profile stays, and a link code brings it back to the save.
