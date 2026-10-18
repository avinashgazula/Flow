/** Asks TMDB's /configuration endpoint, the cheapest call that needs a valid key. A v4 read-access
 *  token is a long JWT; a v3 key is 32 characters. */
export async function checkTMDBKey(key: string, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error: string }> {
  const value = key.trim()
  if (!value) return { ok: false, error: 'Paste a TMDB API key or read-access token.' }
  const bearer = value.length > 40
  try {
    const response = await fetch(`https://api.themoviedb.org/3/configuration${bearer ? '' : `?api_key=${encodeURIComponent(value)}`}`, {
      headers: bearer ? { Authorization: `Bearer ${value}` } : {},
      signal,
    })
    if (response.ok) return { ok: true }
    if (response.status === 401) return { ok: false, error: 'TMDB didn’t accept that key. Check it and try again.' }
    return { ok: false, error: `TMDB answered ${response.status}. Try again in a moment.` }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return { ok: false, error: '' }
    return { ok: false, error: 'Couldn’t reach TMDB. Check your connection and try again.' }
  }
}
