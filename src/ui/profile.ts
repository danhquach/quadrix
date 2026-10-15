import { newProfile, parseProfile, toProfileText, type Profile } from '../core/profile.ts';
import type { SaveStorage } from './save.ts';

export const PROFILE_KEY = 'quadrix.profile';

/**
 * The stored profile (a new one on first launch), and whether it may be written back.
 * It may not when storage is missing or throws, or holds a profile from a later
 * version: the profile then lives in memory only, so a stored one is never overwritten
 * by a blank or downgraded copy.
 */
export function loadProfile(storage: () => SaveStorage | null): {
  profile: Profile;
  stored: boolean;
} {
  try {
    const store = storage();
    if (!store) return { profile: newProfile(), stored: false };
    const { profile, newer } = parseProfile(store.getItem(PROFILE_KEY));
    return { profile, stored: !newer };
  } catch {
    return { profile: newProfile(), stored: false };
  }
}

/**
 * Apply `change` to the profile as stored now, not to `current`, so another tab's
 * records since `current` was read are kept, and store the result. When the stored
 * profile can't be read or written back (see loadProfile), `change` applies to
 * `current` in memory.
 */
export function updateProfile(
  storage: () => SaveStorage | null,
  current: Profile,
  change: (p: Profile) => Profile,
): Profile {
  const fresh = loadProfile(storage);
  if (!fresh.stored) return change(current);
  const next = change(fresh.profile);
  writeProfile(storage, next);
  return next;
}

/** Store `p`. Never throws: play goes on with the in-memory profile. */
export function writeProfile(storage: () => SaveStorage | null, p: Profile): void {
  try {
    storage()?.setItem(PROFILE_KEY, toProfileText(p));
  } catch {
    // Full or unavailable storage: the profile just won't survive a reload.
  }
}
