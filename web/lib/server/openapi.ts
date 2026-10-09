// @ts-nocheck — copied from the Express API (src/openapi.js).
// OpenAPI 3 description of every HTTP route in this server, served at /openapi.json and
// rendered by Swagger UI at /docs. Keep it in step with src/*.js when routes change.
const pkg = { version: '1.0.0' };

const ref = name => ({ $ref: `#/components/schemas/${name}` });
const json = schema => ({ content: { 'application/json': { schema } } });
const ok = (schema, description = 'OK') => ({ description, ...json(schema) });
const err = description => ({ description, ...json(ref('Error')) });
const body = (schema, required = true) => ({ required, ...json(schema) });
const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });

const path = (name, description, schema = { type: 'string' }) => ({ name, in: 'path', required: true, description, schema });
const query = (name, description, schema = { type: 'string' }, required = false) => ({ name, in: 'query', required, description, schema });

const CODE = path('code', 'Six-character live match code (A–Z, 2–9)', { type: 'string', pattern: '^[A-Za-z0-9]{6}$', example: 'K7QX2M' });
const SUCCESS = ok(obj({ success: { type: 'boolean', example: true } }));
const CREATED_ID = ok(obj({ success: { type: 'boolean', example: true }, id: { type: 'string', format: 'uuid' } }));
const STORAGE_ERR = err('Storage error');
const html = description => ({ description, content: { 'text/html': { schema: { type: 'string' } } } });

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'CricScore API',
    version: pkg.version,
    description:
      'Backend for the CricScore cricket scoring app: shared teams, saved matches, live score sharing between ' +
      'phones, the YouTube score overlay and camera streaming.\n\n' +
      '**Auth model.** There are no user accounts. Writes are protected by secrets the app keeps on the phone: ' +
      'a `deviceId` for teams, a per-match `key` for saved matches, and a live-session `token` for live scoring.\n\n' +
      '**Legacy routes** (tag *Legacy (MySQL)*) only exist when the server runs with `DB_RUN=true`; otherwise they return 404.',
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'System', description: 'Health and service info' },
    { name: 'Shared Teams', description: 'Teams visible to every app user. Only the creating device can edit or delete.' },
    { name: 'Matches', description: 'Saved matches (v2). The first write sets a private key that later writes must send.' },
    { name: 'Live Scoring', description: 'In-memory live sessions: share a match code, approve other phones, sync score state.' },
    { name: 'Overlay & Camera', description: 'Public score feed for the stream overlay, camera rooms and replays.' },
    { name: 'WebRTC Stream', description: 'Peer-to-peer phone camera streaming (signaling runs over socket.io at /rtc).' },
    { name: 'Pages', description: 'HTML pages for streaming apps, camera phones and viewers.' },
    { name: 'Legacy (MySQL)', description: 'Original relational API. Active only when DB_RUN=true.' },
  ],
  paths: {
    // ─── System ─────────────────────────────────────────
    '/health': {
      get: {
        tags: ['System'], summary: 'Health check',
        responses: { 200: ok(obj({ status: { type: 'string', example: 'ok' }, db: { type: 'boolean', description: 'Whether DB_RUN is on' } })) },
      },
    },

    // ─── Shared teams ───────────────────────────────────
    '/api/shared-teams': {
      get: {
        tags: ['Shared Teams'], summary: 'List teams (newest first)',
        parameters: [
          query('search', 'Matches team or player names (case-insensitive)'),
          query('deviceId', 'Caller device id; sets `mine` on each team'),
        ],
        responses: { 200: ok({ type: 'array', items: ref('Team') }), 500: STORAGE_ERR },
      },
      post: {
        tags: ['Shared Teams'], summary: 'Create a team',
        requestBody: body(ref('TeamInput')),
        responses: {
          200: ok(ref('Team'), 'Created team'),
          400: err('Validation failed (name missing, fewer than 2 or more than 11 players)'),
          409: err('A team with this name already exists'),
          500: STORAGE_ERR,
        },
      },
    },
    '/api/shared-teams/{id}': {
      parameters: [path('id', 'Team id', { type: 'string', format: 'uuid' })],
      put: {
        tags: ['Shared Teams'], summary: 'Update a team (creator only)',
        requestBody: body(ref('TeamInput')),
        responses: {
          200: ok(ref('Team'), 'Updated team'),
          400: err('Validation failed'),
          403: err('deviceId does not match the creator'),
          404: err('Team not found'),
          409: err('Another team already uses this name'),
          500: STORAGE_ERR,
        },
      },
      delete: {
        tags: ['Shared Teams'], summary: 'Delete a team (creator only)',
        parameters: [query('deviceId', 'Device id of the creator', { type: 'string' }, true)],
        responses: { 200: SUCCESS, 403: err('deviceId does not match the creator'), 404: err('Team not found'), 500: STORAGE_ERR },
      },
    },

    // ─── Matches v2 ─────────────────────────────────────
    '/api/v2/matches': {
      get: {
        tags: ['Matches'], summary: 'List match summaries (newest first)',
        parameters: [
          query('deviceId', 'Caller device id; sets `mine` on each match'),
          query('mine', 'Send `1` to return only matches created by deviceId', { type: 'string', enum: ['1'] }),
          query('search', 'Matches team names or location'),
          query('limit', 'Max results (default 100, max 500)', { type: 'integer', minimum: 1, maximum: 500, default: 100 }),
        ],
        responses: { 200: ok({ type: 'array', items: ref('MatchSummary') }), 500: STORAGE_ERR },
      },
    },
    '/api/v2/matches/{id}': {
      parameters: [path('id', 'Client-generated match id', { type: 'string', pattern: '^[A-Za-z0-9_-]{6,64}$' })],
      get: {
        tags: ['Matches'], summary: 'Get a full match (both innings, ball-by-ball)',
        parameters: [query('deviceId', 'Caller device id; sets `mine`')],
        responses: { 200: ok(ref('Match')), 404: err('Match not found'), 500: STORAGE_ERR },
      },
      put: {
        tags: ['Matches'], summary: 'Create or update a match',
        description: 'Creates the match on the first call (team1 and team2 required) and stores `key`. ' +
          'Later calls must send the same key; supplied fields are merged into the stored match.',
        requestBody: body(ref('MatchInput')),
        responses: {
          200: ok(ref('MatchSummary'), 'Saved match summary'),
          400: err('Invalid id, missing key, invalid status, or missing teams on create'),
          403: err('Key does not match'),
          500: STORAGE_ERR,
        },
      },
      delete: {
        tags: ['Matches'], summary: 'Delete a match',
        parameters: [query('key', 'The match key', { type: 'string' }, true)],
        responses: { 200: SUCCESS, 403: err('Key does not match'), 404: err('Match not found'), 500: STORAGE_ERR },
      },
    },

    // ─── Live scoring ───────────────────────────────────
    '/api/live': {
      post: {
        tags: ['Live Scoring'], summary: 'Start a live session',
        description: 'Returns a share code and the host token. Sessions are kept in memory for 12 hours after last use.',
        requestBody: body(obj({ hostName: { type: 'string' }, deviceId: { type: 'string' }, payload: ref('LivePayload') }), false),
        responses: {
          200: ok(obj({ code: { type: 'string', example: 'K7QX2M' }, token: { type: 'string' }, overlayUrl: { type: 'string', format: 'uri' } })),
        },
      },
    },
    '/api/live/restore': {
      post: {
        tags: ['Live Scoring'], summary: 'Re-register a session after a server restart',
        requestBody: body(obj({
          code: { type: 'string', pattern: '^[A-Z0-9]{6}$' }, token: { type: 'string' },
          hostName: { type: 'string' }, deviceId: { type: 'string' }, payload: ref('LivePayload'),
        }, ['code', 'token'])),
        responses: {
          200: ok(obj({ code: { type: 'string' }, restored: { type: 'boolean', description: 'false if the session already existed' } })),
          400: err('Invalid code or missing token'),
          409: err('Code is in use by another match'),
        },
      },
    },
    '/api/live/{code}/links': {
      parameters: [CODE],
      get: {
        tags: ['Live Scoring'], summary: 'Get the overlay URL',
        responses: { 200: ok(obj({ overlayUrl: { type: 'string', format: 'uri' } })), 404: err('Match code not found or expired') },
      },
    },
    '/api/live/{code}/join': {
      parameters: [CODE],
      post: {
        tags: ['Live Scoring'], summary: 'Ask to join a match (scorer or streamer)',
        description: 'At most two devices per match. The active scorer must approve the request.',
        requestBody: body(obj({
          name: { type: 'string' }, deviceId: { type: 'string' },
          role: { type: 'string', enum: ['scorer', 'streamer'], default: 'scorer' },
        }, ['name', 'deviceId'])),
        responses: {
          200: ok(obj({ requestId: { type: 'string' }, hostName: { type: 'string' } })),
          400: err('Missing name/deviceId, or this phone is already scoring'),
          404: err('Match code not found or expired'),
          409: err('Match full, or another device is already waiting'),
        },
      },
    },
    '/api/live/{code}/requests': {
      parameters: [CODE],
      get: {
        tags: ['Live Scoring'], summary: 'List pending join requests (active scorer only)',
        parameters: [query('token', 'Token of the phone currently scoring', { type: 'string' }, true)],
        responses: {
          200: ok({ type: 'array', items: obj({ id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, createdAt: { type: 'integer' } }) }),
          403: err('Not the active scorer'),
          404: err('Match code not found or expired'),
        },
      },
    },
    '/api/live/{code}/requests/{id}': {
      parameters: [CODE, path('id', 'Join request id')],
      get: {
        tags: ['Live Scoring'], summary: 'Poll a join request (joiner)',
        responses: {
          200: ok(obj({
            status: { type: 'string', enum: ['pending', 'approved', 'denied'] },
            role: { type: 'string', enum: ['scorer', 'streamer'] },
            token: { type: 'string', description: 'Only when approved' },
            version: { type: 'integer', description: 'Only when approved' },
            payload: ref('LivePayload'),
          })),
          404: err('Match or request not found'),
        },
      },
      post: {
        tags: ['Live Scoring'], summary: 'Approve or deny a join request (active scorer only)',
        requestBody: body(obj({ token: { type: 'string' }, approve: { type: 'boolean' } }, ['token', 'approve'])),
        responses: {
          200: ok(obj({ success: { type: 'boolean' }, status: { type: 'string', enum: ['approved', 'denied'] } })),
          403: err('Not the active scorer'),
          404: err('Match or request not found'),
          409: err('Already 2 devices connected'),
        },
      },
    },
    '/api/live/{code}/takeover': {
      parameters: [CODE],
      post: {
        tags: ['Live Scoring'], summary: 'Become the active scorer',
        description: 'The previous scorer is disconnected and sees `activeDevice` change on its next poll.',
        requestBody: body(obj({ token: { type: 'string' }, deviceId: { type: 'string' }, name: { type: 'string' } }, ['token', 'deviceId'])),
        responses: {
          200: ok({ allOf: [obj({ success: { type: 'boolean' } }), ref('ActiveInfo')] }),
          403: err('No scoring access, or this device is the streamer'),
          404: err('Match code not found or expired'),
        },
      },
    },
    '/api/live/{code}/leave': {
      parameters: [CODE],
      post: {
        tags: ['Live Scoring'], summary: 'Disconnect a non-scoring device',
        requestBody: body(obj({ token: { type: 'string' }, deviceId: { type: 'string' } }, ['token', 'deviceId'])),
        responses: {
          200: SUCCESS,
          400: err('The scoring phone cannot leave'),
          403: err('Not connected'),
          404: err('Match code not found or expired'),
        },
      },
    },
    '/api/live/{code}/state': {
      parameters: [CODE],
      get: {
        tags: ['Live Scoring'], summary: 'Poll score state',
        parameters: [
          query('token', 'Session token', { type: 'string' }, true),
          query('since', 'Last version the caller has; payload is returned only if newer', { type: 'integer', default: 0 }),
        ],
        responses: {
          200: ok({
            allOf: [obj({
              changed: { type: 'boolean' }, version: { type: 'integer' },
              payload: ref('LivePayload'), updatedBy: { type: 'string', nullable: true },
            }), ref('ActiveInfo')],
          }),
          403: err('No scoring access'),
          404: err('Match code not found or expired'),
        },
      },
      put: {
        tags: ['Live Scoring'], summary: 'Push score state (active scorer only)',
        requestBody: body(obj({ token: { type: 'string' }, deviceId: { type: 'string' }, payload: ref('LivePayload') }, ['token', 'payload'])),
        responses: {
          200: ok(obj({ version: { type: 'integer' } })),
          403: err('No scoring access'),
          404: err('Match code not found or expired'),
          409: { description: 'Scoring moved to another phone', ...json({ allOf: [ref('Error'), obj({ moved: { type: 'boolean' } }), ref('ActiveInfo')] }) },
        },
      },
    },

    // ─── Overlay & camera ───────────────────────────────
    '/api/live/{code}/overlay': {
      parameters: [CODE],
      get: {
        tags: ['Overlay & Camera'], summary: 'Public score summary for the overlay (no token)',
        responses: { 200: ok(ref('OverlaySummary')), 404: err('Match code not found or expired') },
      },
    },
    '/api/live/{code}/camera': {
      parameters: [CODE],
      post: {
        tags: ['Overlay & Camera'], summary: 'Get or create the camera room for this match',
        requestBody: body(obj({ token: { type: 'string' } }, ['token'])),
        responses: {
          200: ok(obj({
            roomId: { type: 'string' },
            studioUrl: { type: 'string', format: 'uri', description: 'Signs the opening browser in as the camera' },
            watchUrl: { type: 'string', format: 'uri', description: 'Permanent public viewer link' },
          })),
          403: err('Not part of this match'),
          404: err('Match code not found or expired'),
          409: err('Match is over'),
          502: err('Camera streaming service unavailable'),
          503: err('LIVE_STREAM_SECRET not configured'),
        },
      },
    },
    '/api/live/{code}/replay': {
      parameters: [CODE],
      post: {
        tags: ['Overlay & Camera'], summary: 'Start or stop an on-air replay',
        requestBody: body(obj({
          token: { type: 'string' },
          action: { type: 'string', enum: ['start', 'stop'] },
          seconds: { type: 'number', description: 'How far back to replay' },
          rate: { type: 'number', description: 'Playback rate, e.g. 0.5 for slow motion' },
        }, ['token', 'action'])),
        responses: {
          200: ok(obj({ ok: { type: 'boolean' } })),
          403: err('Not part of this match'),
          404: err('Match code not found or expired'),
          409: err('Camera refused the replay'),
          502: err('Camera streaming service unavailable'),
          503: err('LIVE_STREAM_SECRET not configured'),
        },
      },
    },

    // ─── WebRTC stream ──────────────────────────────────
    '/api/stream/{code}': {
      parameters: [CODE],
      post: {
        tags: ['WebRTC Stream'], summary: 'Create broadcast and watch links (scoring phone only)',
        requestBody: body(obj({ token: { type: 'string', description: 'Live session token' } }, ['token'])),
        responses: {
          200: ok(obj({ broadcastUrl: { type: 'string', format: 'uri' }, watchUrl: { type: 'string', format: 'uri' }, maxViewers: { type: 'integer' } })),
          400: err('Match code and token are required'),
          403: err('Not allowed to stream this match'),
          503: err('Could not verify the match'),
        },
      },
    },
    '/api/stream/{code}/status': {
      parameters: [CODE],
      get: {
        tags: ['WebRTC Stream'], summary: 'Broadcast status',
        responses: { 200: ok(obj({ live: { type: 'boolean' }, viewers: { type: 'integer' }, maxViewers: { type: 'integer' } })) },
      },
    },
    '/api/stream-ice': {
      get: {
        tags: ['WebRTC Stream'], summary: 'ICE servers (STUN, plus TURN when configured)',
        responses: {
          200: ok(obj({
            iceServers: {
              type: 'array',
              items: obj({ urls: { type: 'array', items: { type: 'string' } }, username: { type: 'string' }, credential: { type: 'string' } }),
            },
          })),
        },
      },
    },

    // ─── Pages ──────────────────────────────────────────
    '/overlay/{code}': { parameters: [CODE], get: { tags: ['Pages'], summary: 'Score overlay (add as a browser source in OBS/streaming apps)', responses: { 200: html('Overlay page') } } },
    '/go/{code}': {
      parameters: [CODE, query('k', 'Broadcast key from POST /api/stream/{code}')],
      get: { tags: ['Pages'], summary: 'Camera phone broadcast page', responses: { 200: html('Broadcast page'), 404: { description: 'Unknown match' } } },
    },
    '/watch/{code}': {
      parameters: [CODE],
      get: { tags: ['Pages'], summary: 'Viewer page with live video and scoreboard', responses: { 200: html('Viewer page'), 404: { description: 'Unknown match' } } },
    },

    // ─── Legacy MySQL API (DB_RUN=true) ─────────────────
    '/api/teams': {
      get: { tags: ['Legacy (MySQL)'], summary: 'List teams', responses: { 200: ok({ type: 'array', items: ref('LegacyRow') }), 500: err('Database error') } },
      post: {
        tags: ['Legacy (MySQL)'], summary: 'Create a team',
        requestBody: body(obj({ name: { type: 'string' } }, ['name'])),
        responses: { 200: CREATED_ID, 500: err('Database error') },
      },
    },
    '/api/teams/{id}': {
      parameters: [path('id', 'Team id')],
      get: { tags: ['Legacy (MySQL)'], summary: 'Get a team', responses: { 200: ok(ref('LegacyRow')), 404: err('Not found'), 500: err('Database error') } },
    },
    '/api/players': {
      get: {
        tags: ['Legacy (MySQL)'], summary: 'List players',
        parameters: [query('team_id', 'Filter by team'), query('search', 'Filter by name (takes precedence over team_id)')],
        responses: { 200: ok({ type: 'array', items: ref('LegacyRow') }), 500: err('Database error') },
      },
      post: {
        tags: ['Legacy (MySQL)'], summary: 'Create a player',
        requestBody: body(obj({
          team_id: { type: 'string' }, name: { type: 'string' }, nickname: { type: 'string' },
          mobile: { type: 'string' }, photo: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } },
        }, ['team_id', 'name'])),
        responses: { 200: CREATED_ID, 500: err('Database error') },
      },
    },
    '/api/matches': {
      get: { tags: ['Legacy (MySQL)'], summary: 'List matches', responses: { 200: ok({ type: 'array', items: ref('LegacyRow') }), 500: err('Database error') } },
      post: {
        tags: ['Legacy (MySQL)'], summary: 'Create a match',
        requestBody: body(obj({
          team1_id: { type: 'string' }, team2_id: { type: 'string' }, team1_name: { type: 'string' }, team2_name: { type: 'string' },
          overs: { type: 'integer' }, match_type: { type: 'string', default: 'local' },
          toss_winner: { type: 'string' }, toss_choice: { type: 'string' },
          bet_type: { type: 'string', default: 'free' }, bet_amount: { type: 'number', default: 0 },
          cap1_photo: { type: 'string' }, cap2_photo: { type: 'string' },
        }, ['team1_name', 'team2_name', 'overs'])),
        responses: { 200: CREATED_ID, 500: err('Database error') },
      },
    },
    '/api/matches/{id}': {
      parameters: [path('id', 'Match id')],
      get: { tags: ['Legacy (MySQL)'], summary: 'Get a match', responses: { 200: ok(ref('LegacyRow')), 404: err('Not found'), 500: err('Database error') } },
    },
    '/api/matches/{id}/complete': {
      parameters: [path('id', 'Match id')],
      patch: {
        tags: ['Legacy (MySQL)'], summary: 'Mark a match completed',
        requestBody: body(obj({ result: { type: 'string' } }), false),
        responses: { 200: SUCCESS, 500: err('Database error') },
      },
    },
    '/api/matches/{id}/full': {
      parameters: [path('id', 'Match id')],
      get: {
        tags: ['Legacy (MySQL)'], summary: 'Match with innings, batting, bowling and balls',
        responses: { 200: ok(ref('LegacyRow')), 404: err('Not found'), 500: err('Database error') },
      },
    },
    '/api/innings': {
      get: {
        tags: ['Legacy (MySQL)'], summary: 'List innings', parameters: [query('match_id', 'Filter by match')],
        responses: { 200: ok({ type: 'array', items: ref('LegacyRow') }), 500: err('Database error') },
      },
      post: {
        tags: ['Legacy (MySQL)'], summary: 'Create an innings',
        requestBody: body(obj({
          match_id: { type: 'string' }, innings_number: { type: 'integer', default: 1 },
          batting_team_id: { type: 'string' }, bowling_team_id: { type: 'string' }, batting_team_name: { type: 'string' },
          total_runs: { type: 'integer' }, total_wickets: { type: 'integer' }, overs_played: { type: 'integer' }, balls_played: { type: 'integer' },
        }, ['match_id'])),
        responses: { 200: CREATED_ID, 500: err('Database error') },
      },
    },
    '/api/batting': {
      get: {
        tags: ['Legacy (MySQL)'], summary: 'Batting scores of an innings',
        parameters: [query('innings_id', 'Innings id', { type: 'string' }, true)],
        responses: { 200: ok({ type: 'array', items: ref('LegacyRow') }), 500: err('Database error') },
      },
      post: {
        tags: ['Legacy (MySQL)'], summary: 'Add a batting score',
        requestBody: body(obj({
          innings_id: { type: 'string' }, player_name: { type: 'string' }, runs: { type: 'integer' }, balls: { type: 'integer' },
          fours: { type: 'integer' }, sixes: { type: 'integer' }, is_out: { type: 'boolean' }, how_out: { type: 'string' },
        }, ['innings_id', 'player_name'])),
        responses: { 200: CREATED_ID, 500: err('Database error') },
      },
    },
    '/api/bowling': {
      get: {
        tags: ['Legacy (MySQL)'], summary: 'Bowling figures of an innings',
        parameters: [query('innings_id', 'Innings id', { type: 'string' }, true)],
        responses: { 200: ok({ type: 'array', items: ref('LegacyRow') }), 500: err('Database error') },
      },
      post: {
        tags: ['Legacy (MySQL)'], summary: 'Add bowling figures',
        requestBody: body(obj({
          innings_id: { type: 'string' }, player_name: { type: 'string' }, overs: { type: 'integer' },
          balls: { type: 'integer' }, runs: { type: 'integer' }, wickets: { type: 'integer' },
        }, ['innings_id', 'player_name'])),
        responses: { 200: CREATED_ID, 500: err('Database error') },
      },
    },
    '/api/balls': {
      get: {
        tags: ['Legacy (MySQL)'], summary: 'Ball-by-ball log of an innings',
        parameters: [query('innings_id', 'Innings id', { type: 'string' }, true)],
        responses: { 200: ok({ type: 'array', items: ref('LegacyRow') }), 500: err('Database error') },
      },
      post: {
        tags: ['Legacy (MySQL)'], summary: 'Record a ball',
        requestBody: body(obj({
          innings_id: { type: 'string' }, over_number: { type: 'integer' }, ball_number: { type: 'integer' },
          runs: { type: 'integer' }, extra_type: { type: 'string' }, is_wicket: { type: 'boolean' },
          direction: { type: 'string' }, batsman_name: { type: 'string' }, bowler_name: { type: 'string' },
        }, ['innings_id', 'over_number', 'ball_number'])),
        responses: { 200: CREATED_ID, 500: err('Database error') },
      },
    },
  },

  components: {
    schemas: {
      Error: obj({ error: { type: 'string' } }, ['error']),
      Role: { type: 'string', enum: ['Batter', 'Bowler', 'All-Rounder', 'Captain', 'Keeper', 'Impact Player'] },
      Player: obj({
        name: { type: 'string', maxLength: 40 },
        nickname: { type: 'string', maxLength: 30 },
        mobile: { type: 'string', pattern: '^\\+?\\d{10,13}$', description: 'Dropped if not a valid number' },
        roles: { type: 'array', items: ref('Role') },
      }, ['name']),
      TeamInput: obj({
        name: { type: 'string', maxLength: 40, example: 'Royal Strikers' },
        players: { type: 'array', minItems: 2, maxItems: 11, items: ref('Player') },
        createdBy: { type: 'string', maxLength: 40 },
        deviceId: { type: 'string', maxLength: 64, description: 'Required for update; becomes the owner on create' },
      }, ['name', 'players']),
      Team: obj({
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        players: { type: 'array', items: ref('Player') },
        captain: { type: 'string', description: 'First player with the Captain role, else the first player' },
        createdBy: { type: 'string' },
        createdAt: { type: 'integer', description: 'Epoch ms' },
        updatedAt: { type: 'integer', description: 'Epoch ms' },
        mine: { type: 'boolean', description: 'True if the caller deviceId created it' },
      }),
      MatchStatus: { type: 'string', enum: ['live', 'innings_break', 'completed', 'abandoned'] },
      MatchFields: obj({
        team1: { type: 'object', description: 'Team object; must include `name`', additionalProperties: true },
        team2: { type: 'object', additionalProperties: true },
        overs: { type: 'integer' },
        matchType: { type: 'string' },
        location: { type: 'string' },
        tossWinner: { type: 'string' },
        tossChoice: { type: 'string' },
        bet: { type: 'object', additionalProperties: true, description: 'Includes `ballType`' },
        status: ref('MatchStatus'),
        innings1: ref('Innings'),
        innings2: ref('Innings'),
        result: { type: 'string' },
        liveCode: { type: 'string' },
        createdBy: { type: 'string' },
      }),
      MatchInput: {
        allOf: [
          obj({
            key: { type: 'string', minLength: 16, description: 'Private match key, set by the first write' },
            deviceId: { type: 'string' },
            createdAt: { type: 'integer', description: 'Epoch ms (create only)' },
          }, ['key']),
          ref('MatchFields'),
        ],
      },
      Match: {
        allOf: [
          ref('MatchFields'),
          obj({ id: { type: 'string' }, createdAt: { type: 'integer' }, updatedAt: { type: 'integer' }, mine: { type: 'boolean' } }),
        ],
      },
      Innings: {
        type: 'object', additionalProperties: true,
        properties: { runs: { type: 'integer' }, wickets: { type: 'integer' }, overs: { type: 'integer' }, balls: { type: 'integer' } },
      },
      MatchSummary: obj({
        id: { type: 'string' }, mine: { type: 'boolean' },
        team1: { type: 'string' }, team2: { type: 'string' },
        overs: { type: 'integer' }, matchType: { type: 'string' }, location: { type: 'string' },
        status: ref('MatchStatus'), result: { type: 'string' },
        score: { type: 'string', example: '142/6' }, oversPlayed: { type: 'string', example: '18.4' },
        score2: { type: 'string' }, oversPlayed2: { type: 'string' },
        ballType: { type: 'string' }, createdBy: { type: 'string' },
        createdAt: { type: 'integer' }, updatedAt: { type: 'integer' },
      }),
      LivePayload: {
        type: 'object', additionalProperties: true, nullable: true,
        description: 'Opaque app state: `phase`, `inningsNum`, `params`, `savedState`, `scorecardParams`.',
      },
      ActiveInfo: obj({
        activeDevice: { type: 'string', nullable: true },
        activeName: { type: 'string' },
        streamerName: { type: 'string', nullable: true },
      }),
      BatterLine: obj({ name: { type: 'string' }, runs: { type: 'integer' }, balls: { type: 'integer' } }),
      OverlaySummary: obj({
        version: { type: 'integer' },
        phase: { type: 'string', description: '`waiting` before the first state push' },
        inningsNum: { type: 'integer' },
        battingTeam: { type: 'string' }, bowlingTeam: { type: 'string' },
        matchType: { type: 'string' }, overs: { type: 'integer' }, target: { type: 'integer', nullable: true },
        runs: { type: 'integer' }, wickets: { type: 'integer' }, over: { type: 'integer' }, ball: { type: 'integer' },
        striker: { allOf: [ref('BatterLine')], nullable: true },
        nonStriker: { allOf: [ref('BatterLine')], nullable: true },
        bowler: { type: 'object', additionalProperties: true, nullable: true },
        thisOver: { type: 'array', items: {} },
        deliveries: { type: 'integer' },
        lastBall: { nullable: true },
        lastCommentary: { type: 'string' },
        result: { type: 'string', description: 'At innings end' },
        final: { type: 'object', nullable: true, additionalProperties: true, description: 'Winner, margin, innings and best players once the match ends' },
      }),
      LegacyRow: { type: 'object', additionalProperties: true, description: 'A database row' },
    },
  },
};

export default spec;
