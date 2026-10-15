-- Cloud save: one profile per player, shared by every browser linked to it.
--
-- Players have no account: each browser signs in as an anonymous Supabase user (role
-- `authenticated`). Browsers attach to a save through private.save_members; a link code
-- attaches another browser to an existing save.
--
-- Access: `anon` (not signed in) gets nothing. `authenticated` may read its own save row
-- (RLS) and call the three functions below; every write goes through them. Tables in the
-- `private` schema are never granted, and PostgREST does not expose that schema.
--
-- Logging: nothing here raises a notice or puts a link code, profile or token into an
-- error message. Link codes are stored only as SHA-256 hashes.

create schema private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Tables

create table public.saves (
  id uuid primary key default gen_random_uuid(),
  profile jsonb not null,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now()
);

create table private.save_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  save_id uuid not null references public.saves (id) on delete cascade
);
create index save_members_save_id on private.save_members (save_id);

create table private.link_codes (
  code_hash bytea primary key,
  save_id uuid not null references public.saves (id) on delete cascade,
  expires_at timestamptz not null,
  used_by uuid references auth.users (id) on delete cascade
);
create index link_codes_save_id on private.link_codes (save_id);
create index link_codes_expires_at on private.link_codes (expires_at);

-- Wrong link codes per user, for the redeem rate limit.
create table private.redeem_failures (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index redeem_failures_user_at on private.redeem_failures (user_id, at);

-- Supabase grants every new public table to anon and authenticated by default; undo that.
revoke all on table public.saves from public, anon, authenticated;
grant select on table public.saves to authenticated;
alter table public.saves enable row level security;
alter table private.save_members enable row level security;
alter table private.link_codes enable row level security;
alter table private.redeem_failures enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers (private)

/**
 * The signed-in caller's user id. Raises 'not signed in' with no id, or when the user
 * was deleted while its token is still valid (instead of a key error naming the id).
 */
create function private.caller() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from auth.users u where u.id = uid) then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  return uid;
end
$$;

/** The caller's save, or null. */
create function private.my_save_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select save_id from private.save_members where user_id = auth.uid()
$$;

create policy "read own save" on public.saves
  for select to authenticated using (id = (select private.my_save_id()));

/** A whole JSON number in 0..2^40 (the client's MAX_COUNT). */
create function private.valid_count(v jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  return jsonb_typeof(v) = 'number'
    and v::numeric = trunc(v::numeric)
    and v::numeric between 0 and 1099511627776;
end
$$;

/**
 * A display name as the client's cleanName writes it: 1 to 16 characters, no control,
 * format (bidi, zero-width), blank or separator characters other than single inner
 * spaces. Rejects only what cleanName removes, so no name it writes is refused
 * (combining marks such as emoji variation selectors stay). Listed by code point so
 * the result never depends on the database locale.
 */
create function private.valid_name(n text) returns boolean
language sql immutable set search_path = '' as $$
  select char_length(n) between 1 and 16
    and n !~ ('[\u0001-\u001f\u007f-\u00a0\u00ad\u034f\u061c\u115f\u1160\u1680\u180e'
      || '\u2000-\u200f\u2028-\u202f\u205f-\u206f\u2800\u3000\u3164'
      || '\ufeff\uffa0\ufff9-\ufffc]')
    and n !~ '^ | $|  '
$$;

/**
 * The stored profile's allow-list, matching the client's format (src/core/profile.ts,
 * version 1): exactly the keys v, name, best, stars, gamesPlayed, totalLines. Checked
 * step by step so a wrong type never reaches a function that would raise on it.
 */
create function private.valid_profile(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  e record;
begin
  -- A cheap first cut: no valid profile comes near 128 KiB (stars are the bulk).
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 131072 then
    return false;
  end if;
  if array(select k from jsonb_object_keys(p) k order by k collate "C")
     <> array['best', 'gamesPlayed', 'name', 'stars', 'totalLines', 'v'] then
    return false;
  end if;
  if not private.valid_count(p->'v') or (p->>'v')::numeric not between 1 and 1000 then
    return false;
  end if;
  if jsonb_typeof(p->'name') <> 'string' or not private.valid_name(p->>'name') then
    return false;
  end if;
  if jsonb_typeof(p->'stars') <> 'string'
     or char_length(p->>'stars') > 100000
     or p->>'stars' !~ '^[1-3]*$' then
    return false;
  end if;
  if not private.valid_count(p->'gamesPlayed') or not private.valid_count(p->'totalLines') then
    return false;
  end if;
  if jsonb_typeof(p->'best') <> 'object'
     or (select count(*) from jsonb_object_keys(p->'best')) > 16 then
    return false;
  end if;
  for e in select key, value from jsonb_each(p->'best') loop
    if e.key !~ '^[a-z][a-z0-9-]{0,31}$' or jsonb_typeof(e.value) <> 'object' then
      return false;
    end if;
    if array(select k from jsonb_object_keys(e.value) k order by k collate "C")
       <> array['lines', 'score']
       or not private.valid_count(e.value->'score')
       or not private.valid_count(e.value->'lines') then
      return false;
    end if;
  end loop;
  return true;
end
$$;

alter table public.saves add constraint profile_shape check (private.valid_profile(profile));

/** A save nobody is attached to any more is deleted (its link codes cascade). */
create function private.drop_orphan_save() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Lock the save first: a browser joining it concurrently holds a key-share lock on it
  -- until it commits, so the check below (a new snapshot) then sees its membership.
  perform 1 from public.saves s where s.id = old.save_id for update;
  if not exists (select 1 from private.save_members m where m.save_id = old.save_id) then
    delete from public.saves s where s.id = old.save_id;
  end if;
  return null;
end
$$;

create trigger drop_orphan_save after delete on private.save_members
  for each row execute function private.drop_orphan_save();

/**
 * Expired link codes and old redeem failures. Create and redeem run it last, after
 * every save lock they take, and it skips rows another transaction holds, so it never
 * waits on anyone while holding a lock they need.
 */
create function private.cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from private.link_codes where ctid in (
    select ctid from private.link_codes where expires_at <= now() for update skip locked);
  delete from private.redeem_failures where ctid in (
    select ctid from private.redeem_failures
    where at <= now() - interval '10 minutes' for update skip locked);
$$;

-- ---------------------------------------------------------------------------
-- API (public, signed-in players only)

/**
 * Store `new_profile` as the caller's save if its revision is still `base_revision`
 * (0: the caller has no save yet). Returns {status: 'saved', revision, updated_at}, or
 * {status: 'conflict', revision, profile, updated_at} with the stored save (revision 0
 * and null profile if there is none) for the client to merge and retry.
 */
create function public.save_profile(new_profile jsonb, base_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.caller();
  sid uuid;
  cur public.saves;
begin
  if not private.valid_profile(new_profile) then
    raise exception 'invalid profile' using errcode = '22023';
  end if;
  -- One call at a time per browser, so two first saves cannot both create a save.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select m.save_id into sid from private.save_members m where m.user_id = uid;

  if sid is null then
    if base_revision is distinct from 0 then
      return jsonb_build_object('status', 'conflict', 'revision', 0, 'profile', null,
        'updated_at', null);
    end if;
    insert into public.saves (profile) values (new_profile) returning * into cur;
    insert into private.save_members (user_id, save_id) values (uid, cur.id);
    return jsonb_build_object('status', 'saved', 'revision', cur.revision,
      'updated_at', cur.updated_at);
  end if;

  update public.saves s
  set profile = new_profile, revision = s.revision + 1, updated_at = now()
  where s.id = sid and s.revision = base_revision
  returning * into cur;
  if found then
    return jsonb_build_object('status', 'saved', 'revision', cur.revision,
      'updated_at', cur.updated_at);
  end if;
  select * into cur from public.saves s where s.id = sid;
  return jsonb_build_object('status', 'conflict', 'revision', cur.revision,
    'profile', cur.profile, 'updated_at', cur.updated_at);
end
$$;

/**
 * A new link code for the caller's save, valid for 10 minutes and once: 8 characters
 * from a 32-letter alphabet without I, O, 0 and 1. Replaces the save's earlier unused
 * codes. Returns {status: 'created', code, expires_at}, or {status: 'no_save'}.
 */
create function public.create_link_code() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.caller();
  sid uuid;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  bits bigint;
  code text;
  expires timestamptz := now() + interval '10 minutes';
begin
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select m.save_id into sid from private.save_members m where m.user_id = uid;
  if sid is null then
    perform private.cleanup();
    return jsonb_build_object('status', 'no_save');
  end if;
  -- Saves before codes, the order every other path takes (see redeem_link_code).
  perform 1 from public.saves s where s.id = sid for update;
  delete from private.link_codes l where l.save_id = sid and l.used_by is null;
  loop
    -- The first 6 bytes of a v4 UUID are random (pg_strong_random); use 40 bits of them.
    bytes := uuid_send(gen_random_uuid());
    bits := 0;
    for i in 0..4 loop
      bits := (bits << 8) | get_byte(bytes, i);
    end loop;
    code := '';
    for i in 0..7 loop
      code := code || substr(alphabet, ((bits >> (5 * i)) & 31)::int + 1, 1);
    end loop;
    begin
      insert into private.link_codes (code_hash, save_id, expires_at)
      values (sha256(convert_to(code, 'UTF8')), sid, expires);
      exit;
    exception when unique_violation then
      -- Same code as a live one: draw again.
    end;
  end loop;
  perform private.cleanup();
  return jsonb_build_object('status', 'created', 'code', code, 'expires_at', expires);
end
$$;

/**
 * Attach the caller to the save that `code` was made for. Case, spaces and dashes in the
 * code are ignored. Redeeming a code again from the same browser before it expires
 * succeeds again while the browser is still attached to its save (a retry after a lost
 * response); from another browser it is invalid.
 * The caller's previous save is left, and deleted if nobody else is attached to it.
 * After 5 wrong codes in 10 minutes every code is refused until the window passes.
 * Returns {status: 'linked', revision, profile, updated_at}, {status: 'invalid'} or
 * {status: 'rate_limited'}.
 */
create function public.redeem_link_code(code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.caller();
  clean text;
  hash bytea;
  sid uuid;
  old_sid uuid;
  cur public.saves;
begin
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  if (select count(*) from private.redeem_failures f
      where f.user_id = uid and f.at > now() - interval '10 minutes') >= 5 then
    perform private.cleanup();
    return jsonb_build_object('status', 'rate_limited');
  end if;

  select m.save_id into old_sid from private.save_members m where m.user_id = uid;
  if code is not null and char_length(code) <= 64 then
    clean := upper(regexp_replace(code, '[[:space:]-]+', '', 'g'));
    if clean ~ '^[A-HJ-NP-Z2-9]{8}$' then
      hash := sha256(convert_to(clean, 'UTF8'));
      -- Lock the saves involved, in id order, before the code row: a browser leaving
      -- its save locks it before its leave trigger deletes the save's codes, so every
      -- redeem takes saves first, then codes, and none can deadlock with another.
      perform 1 from public.saves s
      where s.id = old_sid
         or s.id = (select l.save_id from private.link_codes l where l.code_hash = hash)
      order by s.id for update;
      update private.link_codes l set used_by = uid
      where l.code_hash = hash and l.used_by is null and l.expires_at > now()
      returning l.save_id into sid;
      if sid is null then
        select l.save_id into sid from private.link_codes l
        where l.code_hash = hash and l.used_by = uid and l.save_id = old_sid
          and l.expires_at > now();
      end if;
    end if;
  end if;
  if sid is null then
    insert into private.redeem_failures (user_id) values (uid);
    perform private.cleanup();
    return jsonb_build_object('status', 'invalid');
  end if;

  if old_sid is distinct from sid then
    delete from private.save_members m where m.user_id = uid;
    insert into private.save_members (user_id, save_id) values (uid, sid);
  end if;
  select * into cur from public.saves s where s.id = sid;
  perform private.cleanup();
  return jsonb_build_object('status', 'linked', 'revision', cur.revision,
    'profile', cur.profile, 'updated_at', cur.updated_at);
end
$$;

-- ---------------------------------------------------------------------------
-- Function grants: Postgres grants EXECUTE to PUBLIC and Supabase to anon by default.

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.my_save_id() to authenticated;

revoke all on function public.save_profile(jsonb, bigint) from public, anon;
revoke all on function public.create_link_code() from public, anon;
revoke all on function public.redeem_link_code(text) from public, anon;
grant execute on function public.save_profile(jsonb, bigint) to authenticated;
grant execute on function public.create_link_code() to authenticated;
grant execute on function public.redeem_link_code(text) to authenticated;
