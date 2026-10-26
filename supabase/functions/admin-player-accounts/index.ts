import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

async function collectFiles(client: ReturnType<typeof createClient>, bucket: string, folder: string) {
  const pending = [folder]
  const files: string[] = []
  while (pending.length) {
    const path = pending.pop()!
    let offset = 0
    while (true) {
      const { data, error } = await client.storage.from(bucket).list(path, { limit: 1000, offset })
      if (error) throw new Error(`Could not safely inspect ${bucket} storage.`)
      for (const entry of data ?? []) {
        const objectPath = `${path}/${entry.name}`
        if (entry.id === null) pending.push(objectPath)
        else files.push(objectPath)
      }
      if (!data || data.length < 1000) break
      offset += data.length
    }
  }
  return files
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const authorization = request.headers.get('Authorization')
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization || !url || !anonKey || !serviceKey) return json({ error: 'Admin service is not configured.' }, 503)

  const callerClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  })
  const { data: callerData, error: callerError } = await callerClient.auth.getUser()
  const caller = callerData.user
  if (callerError || !caller) return json({ error: 'Sign in again to continue.' }, 401)
  if (caller.app_metadata?.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403)

  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  let body: { action?: string; userId?: string }
  try { body = await request.json() }
  catch { return json({ error: 'A valid request body is required.' }, 400) }

  if (body.action === 'list') {
    const [{ data: users, error: usersError }, { data: profiles, error: profilesError }] = await Promise.all([
      service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      service.from('profiles').select('id,username,display_name,avatar_url,country,rating,wins,losses').eq('is_deleted', false).order('rating', { ascending: false }),
    ])
    if (usersError || profilesError) return json({ error: 'Player accounts could not be loaded.' }, 500)
    const byId = new Map((profiles ?? []).map(profile => [profile.id, profile]))
    return json({ players: (users?.users ?? []).map(user => ({
      id: user.id,
      email: user.email ?? '',
      created_at: user.created_at,
      profile: byId.get(user.id) ?? null,
    })) })
  }

  if (body.action !== 'delete' || !body.userId || !/^[0-9a-f-]{36}$/i.test(body.userId)) {
    return json({ error: 'Choose a valid player account.' }, 400)
  }
  if (body.userId === caller.id) return json({ error: 'You cannot delete your own administrator account.' }, 400)

  const { data: target, error: targetError } = await service.auth.admin.getUserById(body.userId)
  if (targetError || !target.user) return json({ error: 'That player account was not found.' }, 404)

  try {
    // Remove only assets in the target player's own avatar and evidence folders.
    // Listing/removal errors abort before the Auth account is deleted.
    const { data: buckets, error: bucketsError } = await service.storage.listBuckets()
    if (bucketsError) throw new Error('Storage ownership could not be checked.')
    const bucketNames = new Set((buckets ?? []).map(bucket => bucket.name))
    if (bucketNames.has('player-avatars')) {
      const paths = await collectFiles(service, 'player-avatars', body.userId)
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await service.storage.from('player-avatars').remove(paths.slice(i, i + 100))
        if (error) throw new Error('The player avatar files could not be removed.')
      }
    }
    if (bucketNames.has('match-evidence')) {
      const { data: matches, error } = await service.from('matches').select('id')
        .or(`player1_id.eq.${body.userId},player2_id.eq.${body.userId}`)
      if (error) throw new Error('The player match evidence could not be inspected.')
      for (const match of matches ?? []) {
        const paths = await collectFiles(service, 'match-evidence', `${match.id}/${body.userId}`)
        for (let i = 0; i < paths.length; i += 100) {
          const { error: removeError } = await service.storage.from('match-evidence').remove(paths.slice(i, i + 100))
          if (removeError) throw new Error('The player match evidence could not be removed.')
        }
      }
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Player storage could not be cleaned safely.' }, 500)
  }

  const { error: deleteError } = await service.auth.admin.deleteUser(body.userId, false)
  if (deleteError) return json({ error: 'The account could not be deleted. Its history remains intact; check for other Auth-owned storage files.' }, 409)
  return json({ deleted: true, userId: body.userId, historyPreserved: true })
})
