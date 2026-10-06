-- =============================================================================
-- Electricity Market Game · database for Supabase
--
-- Paste this whole file into Supabase → SQL Editor → Run. It is idempotent:
-- running it again updates the functions and keeps the data.
-- Then set the instructor password (only possible from the SQL editor):
--
--     select set_admin_password('choose-a-password');
--
-- The game is pay-as-bid: every plant is 100 MW with no production cost, and
-- each team that sells is paid the price it offered.
--
-- Security model: the web app is static (GitHub Pages) and talks to Supabase
-- with the public anon key. Tables are closed to anon (RLS on, no policies,
-- privileges revoked); the browser can only call the RPC functions granted at
-- the end of this file. They run as the owner (security definer) and check
-- the team code or the instructor token themselves.
-- =============================================================================

-- ------------------------------------------------------------------ tables

create table if not exists sessions (
  id            text primary key,
  name          text not null,
  price_cap     double precision not null default 200,
  round_seconds integer not null default 180,
  created_at    timestamptz not null default now()
);

create table if not exists groups (
  id            serial primary key,
  session_id    text not null references sessions(id) on delete cascade,
  slot          integer not null,
  code          text not null unique,
  name          text,
  technology    text not null,
  icon          text not null,
  capacity      double precision not null default 100,
  joined_at     timestamptz,
  created_at    timestamptz not null default now(),
  unique (session_id, slot)
);

create table if not exists rounds (
  id             serial primary key,
  session_id     text not null references sessions(id) on delete cascade,
  number         integer not null,
  label          text not null,
  phase          text not null check (phase in ('practice', 'competition', 'collusion')),
  demand_share   double precision not null,
  demand_mw      double precision,
  status         text not null default 'pending' check (status in ('pending', 'open', 'closed')),
  opened_at      timestamptz,
  deadline       timestamptz,
  closed_at      timestamptz,
  clearing_price double precision, -- market price: average paid, weighted by MWh
  marginal_price double precision, -- highest accepted offer
  served_mw      double precision,
  unique (session_id, number)
);

-- Latest offer per group and round (the one used for clearing) plus its result.
create table if not exists bids (
  id           serial primary key,
  round_id     integer not null references rounds(id) on delete cascade,
  group_id     integer not null references groups(id) on delete cascade,
  price        double precision not null,
  quantity     double precision not null,
  revisions    integer not null default 1,
  submitted_at timestamptz not null default now(),
  dispatched   double precision,
  profit       double precision,
  unique (round_id, group_id)
);

-- Every submission, including the ones later overwritten. Never deleted.
create table if not exists bid_log (
  id           serial primary key,
  session_id   text not null,
  round_id     integer not null,
  group_id     integer not null,
  price        double precision not null,
  quantity     double precision not null,
  submitted_at timestamptz not null default now()
);

create table if not exists app_config (
  id         integer primary key default 1 check (id = 1),
  admin_salt text not null,
  admin_hash text not null
);

create table if not exists admin_tokens (
  token      text primary key,
  expires_at timestamptz not null
);

-- Columns of the former pay-as-clear version, removed from older installs.
alter table sessions drop column if exists mode;
alter table sessions drop column if exists reveal_costs;
alter table groups drop column if exists marginal_cost;
alter table groups alter column capacity set default 100;

-- Optional demand uncertainty per round (0 = demand known exactly). With a
-- spread of 0.1 teams are told "forecast: base ±10%" and the real demand is
-- drawn at random in that range when the round opens; it is revealed at close.
-- Secret per session that shuffles the anonymous letters of Part 1 offers.
alter table sessions add column if not exists anon_salt text not null default md5(random()::text || clock_timestamp()::text);

alter table rounds add column if not exists demand_spread double precision not null default 0;
alter table rounds add column if not exists demand_low double precision;
alter table rounds add column if not exists demand_high double precision;

-- Teams the instructor pauses (e.g. they left) stop counting towards demand and cannot bid.
alter table groups add column if not exists active boolean not null default true;

create index if not exists bids_round_idx on bids (round_id);
create index if not exists rounds_session_idx on rounds (session_id);
create index if not exists groups_session_idx on groups (session_id);

-- Close every table to the public API roles.
do $$
declare t text;
begin
  foreach t in array array['sessions', 'groups', 'rounds', 'bids', 'bid_log', 'app_config', 'admin_tokens'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ helpers

create or replace function _fail(p_message text, p_hint text default null) returns void
language plpgsql as $$
begin
  raise exception using message = p_message, hint = coalesce(p_hint, '');
end $$;

create or replace function _hash(p_salt text, p_password text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_salt || p_password, 'UTF8')), 'hex')
$$;

create or replace function _random_code(p_length integer) returns text
language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, p_length)
$$;

create or replace function _clean_name(p_name text) returns text
language sql immutable as $$
  select nullif(left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 24), '')
$$;

create or replace function _check_admin(p_token text) returns void
language plpgsql as $$
begin
  if not exists (select 1 from admin_tokens where token = p_token and expires_at > now()) then
    perform _fail('Instructor login required', 'auth');
  end if;
end $$;

-- Plant name and icon for the team in position p_slot (1-based). They are only
-- labels: every plant is identical. Beyond 12 teams the names repeat as "III", "IV"…
drop function if exists _technology(integer, text);
create or replace function _technology(p_slot integer, out technology text, out icon text)
language plpgsql immutable as $$
declare
  v_names text[] := array['Nuclear', 'Combined-cycle gas', 'Wind', 'Coal', 'Hydro', 'Gas peaker',
                          'Solar', 'Biomass', 'Oil', 'Combined-cycle gas II', 'Coal II', 'Hydro II'];
  v_icons text[] := array['☢️', '🔥', '💨', '🏭', '💧', '⚡', '☀️', '🌿', '🛢️', '🔥', '🏭', '💧'];
  v_roman text[] := array['III', 'IV', 'V', 'VI', 'VII'];
  i integer := (p_slot - 1) % 12 + 1;
  v_cycle integer := (p_slot - 1) / 12;
begin
  technology := v_names[i];
  icon := v_icons[i];
  if v_cycle > 0 then
    technology := regexp_replace(technology, ' II$', '') || ' ' || coalesce(v_roman[v_cycle], (v_cycle + 2)::text);
  end if;
end $$;

-- Capacity that sets the demand of a round: active teams that have shown up
-- (opened their page or bid). Printed cards nobody used do not count. If no
-- team has shown up yet (e.g. a dry run), every active team counts.
create or replace function _playing_groups(p_session text) returns setof groups
language sql stable as $$
  select * from groups g
  where g.session_id = p_session and g.active
    and (g.joined_at is not null
         or not exists (select 1 from groups x where x.session_id = p_session and x.active and x.joined_at is not null))
$$;

create or replace function _playing_capacity(p_session text) returns double precision
language sql stable as $$
  select coalesce(sum(capacity), 0) from _playing_groups(p_session)
$$;

-- Most demand a round may have: the playing capacity minus the largest plant,
-- so at least one plant's worth is always left unsold and asking too much has
-- a real risk (in Part 1 the most expensive team sells nothing). With a single
-- team there is nothing to leave out.
create or replace function _demand_cap(p_session text) returns double precision
language sql stable as $$
  select case when count(*) >= 2 then sum(capacity) - max(capacity) else coalesce(sum(capacity), 0) end
  from _playing_groups(p_session)
$$;

drop function if exists _insert_group(text, integer, text);
create or replace function _insert_group(p_session text, p_slot integer) returns void
language plpgsql as $$
declare
  t record;
  v_code text;
begin
  select * into t from _technology(p_slot);
  loop
    v_code := _random_code(5);
    exit when not exists (select 1 from groups where code = v_code);
  end loop;
  insert into groups (session_id, slot, code, technology, icon)
  values (p_session, p_slot, v_code, t.technology, t.icon);
end $$;

-- Pay-as-bid auction with inelastic demand. Offers are accepted from cheapest
-- to most expensive until demand is met; ties at the margin share what is
-- left pro rata (so a cartel that all bids the same price shares the market).
-- Each accepted team is paid its own offer; the market price reported is the
-- average paid, weighted by MWh. There are no production costs, so a team's
-- profit is its revenue.
-- p_offers: [{groupId, price, quantity}]. Pure function, mirrored by
-- clearMarket() in lib/game.ts and checked against it in the tests.
drop function if exists _clear_market(double precision, jsonb, double precision, text);
create or replace function _clear_market(p_demand double precision, p_offers jsonb) returns jsonb
language plpgsql immutable as $$
declare
  v_remaining double precision := p_demand;
  v_marginal double precision := 0;
  v_level double precision;
  v_total double precision;
  v_ratio double precision;
  v_dispatched jsonb := '{}';
  v_shortfall double precision;
  v_served double precision;
  v_revenue double precision := 0;
  v_out jsonb := '[]';
  v_q double precision;
  v_price double precision;
  o jsonb;
begin
  for v_level in
    select distinct (e->>'price')::double precision as p
    from jsonb_array_elements(p_offers) e
    where (e->>'quantity')::double precision > 0
    order by p
  loop
    exit when v_remaining <= 0;
    select sum((e->>'quantity')::double precision) into v_total
    from jsonb_array_elements(p_offers) e
    where (e->>'quantity')::double precision > 0 and (e->>'price')::double precision = v_level;
    v_ratio := least(1, v_remaining / v_total);
    for o in
      select e from jsonb_array_elements(p_offers) e
      where (e->>'quantity')::double precision > 0 and (e->>'price')::double precision = v_level
    loop
      v_dispatched := v_dispatched || jsonb_build_object(o->>'groupId', (o->>'quantity')::double precision * v_ratio);
    end loop;
    v_remaining := v_remaining - v_total * v_ratio;
    v_marginal := v_level;
  end loop;

  v_shortfall := case when v_remaining > 1e-9 then v_remaining else 0 end;
  v_served := p_demand - v_shortfall;

  for o in select e from jsonb_array_elements(p_offers) e loop
    v_q := coalesce((v_dispatched->>(o->>'groupId'))::double precision, 0);
    v_price := (o->>'price')::double precision;
    v_revenue := v_revenue + v_price * v_q;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'groupId', (o->>'groupId')::integer,
      'dispatched', round(v_q::numeric, 2),
      'profit', round((v_price * v_q)::numeric, 2)));
  end loop;

  return jsonb_build_object(
    'clearingPrice', round((case when v_served > 0 then v_revenue / v_served else 0 end)::numeric, 2),
    'marginalPrice', round(v_marginal::numeric, 2),
    'servedMw', round(v_served::numeric, 2),
    'shortfallMw', round(v_shortfall::numeric, 2),
    'dispatch', v_out);
end $$;

-- Cumulative earnings per team over closed rounds, practice excluded.
create or replace function _totals(p_session text) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('group_id', t.group_id, 'profit', t.profit)), '[]')
  from (
    select b.group_id, round(sum(coalesce(b.profit, 0))::numeric, 2) as profit
    from bids b join rounds r on r.id = b.round_id
    where r.session_id = p_session and r.status = 'closed' and r.phase <> 'practice'
    group by b.group_id
  ) t
$$;

-- Everything a screen needs about a session. Non-admin callers get no team
-- codes and, for an open round, only who has bid.
-- p_viewer is the team asking (null for the projector).
--
-- Part 1 (practice and competition) results are anonymous for everyone but
-- the instructor: other teams' offers come as "Team A, B, C…", reshuffled
-- every round, so nobody can single out (or punish) a rival. The viewer's own
-- offer keeps its id. Part 2 shows names: a cartel needs to see who cheats.
drop function if exists _bundle(text, boolean);
create or replace function _bundle(p_session text, p_admin boolean, p_viewer integer default null) returns jsonb
language plpgsql stable as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session;
  if not found then
    perform _fail('Session not found', 'not_found');
  end if;
  return jsonb_build_object(
    'session', case when p_admin then to_jsonb(s) else to_jsonb(s) - 'anon_salt' end,
    'groups', coalesce((
      select jsonb_agg(
        case when p_admin then to_jsonb(g) else to_jsonb(g) - 'code' end order by g.slot)
      from groups g where g.session_id = s.id), '[]'),
    'rounds', coalesce((
      select jsonb_agg(
        case when not p_admin and r.status = 'open' and r.demand_spread > 0
             then to_jsonb(r) - 'demand_mw' -- only the forecast range until the round closes
             else to_jsonb(r)
        end order by r.number)
      -- Upcoming rounds stay with the instructor: their phase would reveal Part 2 in advance.
      from rounds r where r.session_id = s.id and (p_admin or r.status <> 'pending')), '[]'),
    'bids', coalesce((
      select jsonb_agg(
        case
          when p_admin then to_jsonb(x.b)
          when x.status <> 'closed' then jsonb_build_object('round_id', (x.b).round_id, 'group_id', (x.b).group_id)
          when x.phase = 'collusion' or (x.b).group_id = p_viewer then to_jsonb(x.b)
          else (to_jsonb(x.b) - 'id' - 'group_id' - 'submitted_at' - 'revisions')
               || jsonb_build_object(
                    'group_id', -x.anon_rank,
                    'anon', case when x.anon_rank <= 26 then chr(64 + x.anon_rank::int) else 'Z' || (x.anon_rank - 26) end)
        end order by x.sort_key)
      from (
        select b, r.status, r.phase,
          -- Same letter for every viewer within a round, a new shuffle each round.
          row_number() over (partition by b.round_id order by md5(s.anon_salt || ':' || b.round_id || ':' || b.group_id)) as anon_rank,
          case when p_admin or r.phase = 'collusion' then b.submitted_at::text
               else md5(s.anon_salt || ':' || b.round_id || ':' || b.group_id) end as sort_key
        from bids b join rounds r on r.id = b.round_id where r.session_id = s.id
      ) x), '[]'),
    -- Cumulative earnings per team (practice excluded). Named totals would undo
    -- the anonymity of Part 1 (after one round, total = that round's earnings),
    -- so teams and the projector only get them once Part 2 has started; until
    -- then each team receives just its own total and position (group_state).
    'totals', case when p_admin or exists (
                 select 1 from rounds r where r.session_id = s.id and r.phase = 'collusion' and r.status <> 'pending')
               then _totals(s.id) else '[]'::jsonb end,
    'serverTime', now());
end $$;

create or replace function _close_round(p_session text, p_round integer) returns void
language plpgsql as $$
declare
  r rounds;
  v_offers jsonb;
  v_result jsonb;
begin
  -- Guarded update: only one caller can move the round from open to closed.
  -- Bids take a share lock on the round, so none can slip in after this point.
  update rounds set status = 'closed', closed_at = now()
  where id = p_round and session_id = p_session and status = 'open'
  returning * into r;
  if not found then
    perform _fail('Round is not open');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'groupId', b.group_id, 'price', b.price, 'quantity', b.quantity)), '[]')
  into v_offers
  from bids b join groups g on g.id = b.group_id
  where b.round_id = r.id and g.active;

  v_result := _clear_market(r.demand_mw, v_offers);

  update bids b
  set dispatched = (d->>'dispatched')::double precision, profit = (d->>'profit')::double precision
  from jsonb_array_elements(v_result->'dispatch') d
  where b.round_id = r.id and b.group_id = (d->>'groupId')::integer;

  update rounds
  set clearing_price = (v_result->>'clearingPrice')::double precision,
      marginal_price = (v_result->>'marginalPrice')::double precision,
      served_mw = (v_result->>'servedMw')::double precision
  where id = r.id;
end $$;

-- ------------------------------------------------------------------ instructor

-- Run from the SQL editor only (not callable from the web).
create or replace function set_admin_password(p_password text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_salt text := md5(random()::text || clock_timestamp()::text);
begin
  if length(coalesce(p_password, '')) < 4 then
    perform _fail('Password must have at least 4 characters');
  end if;
  insert into app_config (id, admin_salt, admin_hash) values (1, v_salt, _hash(v_salt, p_password))
  on conflict (id) do update set admin_salt = excluded.admin_salt, admin_hash = excluded.admin_hash;
  delete from admin_tokens; -- log everybody out
end $$;

create or replace function admin_login(p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c app_config;
  v_token text;
begin
  select * into c from app_config where id = 1;
  if not found then
    perform _fail('No instructor password yet. Run select set_admin_password(''...''); in the Supabase SQL editor.');
  end if;
  if _hash(c.admin_salt, coalesce(p_password, '')) <> c.admin_hash then
    perform pg_sleep(0.5);
    perform _fail('Wrong password', 'auth');
  end if;
  delete from admin_tokens where expires_at < now();
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into admin_tokens (token, expires_at) values (v_token, now() + interval '7 days');
  return jsonb_build_object('token', v_token);
end $$;

create or replace function admin_sessions(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'createdAt', s.created_at,
      'groupCount', (select count(*) from groups g where g.session_id = s.id),
      'closedRounds', (select count(*) from rounds r where r.session_id = s.id and r.status = 'closed'))
      order by s.created_at desc)
    from sessions s), '[]');
end $$;

drop function if exists admin_create_session(text, text, integer, double precision, integer, text);
create or replace function admin_create_session(p_token text, p_name text, p_groups integer,
  p_price_cap double precision, p_round_seconds integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id text;
  v_groups integer := greatest(1, least(40, coalesce(p_groups, 10)));
  v_number integer := 1;
  h record;
  v_phase text;
begin
  perform _check_admin(p_token);
  loop
    v_id := lower(_random_code(6));
    exit when not exists (select 1 from sessions where id = v_id);
  end loop;
  insert into sessions (id, name, price_cap, round_seconds)
  values (v_id, coalesce(nullif(trim(p_name), ''), 'Open Day'),
          coalesce(nullif(p_price_cap, 0), 200), coalesce(p_round_seconds, 180));
  for i in 1..v_groups loop
    perform _insert_group(v_id, i);
  end loop;

  -- Default plan: one practice round, then the same four hours with and
  -- without agreements so both parts can be compared.
  insert into rounds (session_id, number, label, phase, demand_share) values (v_id, v_number, 'Practice', 'practice', 0.6);
  foreach v_phase in array array['competition', 'collusion'] loop
    for h in select * from (values (1, '03:00 · Night', 0.45), (2, '09:00 · Morning', 0.7),
                                   (3, '14:00 · Afternoon', 0.55), (4, '20:00 · Evening peak', 0.85)) as t(o, label, share)
             order by o loop
      v_number := v_number + 1;
      insert into rounds (session_id, number, label, phase, demand_share) values (v_id, v_number, h.label, v_phase, h.share);
    end loop;
  end loop;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function admin_session(p_token text, p_session text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_token);
  return _bundle(p_session, true);
end $$;

create or replace function admin_action(p_token text, p_session text, p_action jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s sessions;
  r rounds;
  a text := p_action->>'action';
  v_round integer := (p_action->>'roundId')::integer;
  v_share double precision := (p_action->>'demandShare')::double precision;
  v_spread double precision := (p_action->>'demandSpread')::double precision;
  v_base double precision;
  v_low double precision;
  v_high double precision;
  v_phase text := p_action->>'phase';
  v_open integer;
  v_total double precision;
  v_seconds integer;
  v_cap double precision;
begin
  perform _check_admin(p_token);
  select * into s from sessions where id = p_session;
  if not found then
    perform _fail('Session not found', 'not_found');
  end if;
  if v_round is not null then
    select * into r from rounds where id = v_round and session_id = p_session;
    if not found then
      perform _fail('Round not found', 'not_found');
    end if;
  end if;
  if v_phase is not null and v_phase not in ('practice', 'competition', 'collusion') then
    perform _fail('Unknown phase');
  end if;
  if v_share is not null and (v_share <= 0 or v_share > 1.5) then
    perform _fail('Demand must be between 1% and 150%');
  end if;
  if v_spread is not null and (v_spread < 0 or v_spread > 0.5) then
    perform _fail('Uncertainty must be between 0% and 50%');
  end if;

  case a
    when 'openRound' then
      if r.status <> 'pending' then perform _fail('Only pending rounds can be opened'); end if;
      select number into v_open from rounds where session_id = p_session and status = 'open';
      if found then perform _fail(format('Round %s is still open. Close it first.', v_open)); end if;
      v_total := _playing_capacity(p_session);
      v_seconds := coalesce((p_action->>'seconds')::integer, s.round_seconds);
      v_cap := _demand_cap(p_session);
      v_base := round((v_total * r.demand_share)::numeric);
      v_high := least(round((v_base * (1 + r.demand_spread))::numeric), v_cap);
      v_low := least(round((v_base * (1 - r.demand_spread))::numeric), v_high);
      update rounds set status = 'open', opened_at = now(),
        demand_low = v_low,
        demand_high = v_high,
        -- Uniform whole number of MW in [low, high]; equals the base when the spread is 0.
        demand_mw = v_low + floor(random() * (v_high - v_low + 1)),
        deadline = case when v_seconds > 0 then now() + make_interval(secs => v_seconds) end
      where id = r.id;

    when 'extendRound' then
      update rounds set deadline = greatest(deadline, now()) + make_interval(secs => coalesce((p_action->>'seconds')::integer, 30))
      where id = r.id and status = 'open' and deadline is not null;

    when 'closeRound' then
      perform _close_round(p_session, r.id);

    when 'resetRound' then
      -- Back to pending. Current bids are dropped; bid_log keeps the full history.
      delete from bids where round_id = r.id;
      update rounds set status = 'pending', opened_at = null, deadline = null, closed_at = null,
        demand_mw = null, demand_low = null, demand_high = null,
        clearing_price = null, marginal_price = null, served_mw = null
      where id = r.id;

    when 'addRound' then
      insert into rounds (session_id, number, label, phase, demand_share, demand_spread)
      values (p_session, (select coalesce(max(number), 0) + 1 from rounds where session_id = p_session),
              coalesce(nullif(trim(p_action->>'label'), ''), 'Extra round'), coalesce(v_phase, 'competition'),
              coalesce(v_share, 0.7), coalesce(v_spread, 0));

    when 'updateRound' then
      if r.status <> 'pending' then perform _fail('Only pending rounds can be edited'); end if;
      update rounds set label = coalesce(nullif(trim(p_action->>'label'), ''), label),
        phase = coalesce(v_phase, phase), demand_share = coalesce(v_share, demand_share),
        demand_spread = coalesce(v_spread, demand_spread)
      where id = r.id;

    when 'setSpreadAll' then
      -- Same uncertainty for every round not played yet.
      update rounds set demand_spread = coalesce(v_spread, 0)
      where session_id = p_session and status = 'pending';

    when 'deleteRound' then
      if r.status <> 'pending' then perform _fail('Only pending rounds can be deleted'); end if;
      delete from rounds where id = r.id;

    when 'addGroup' then
      perform _insert_group(p_session, (select coalesce(max(slot), 0) + 1 from groups where session_id = p_session));

    when 'removeGroup' then
      if exists (select 1 from bids where group_id = (p_action->>'groupId')::integer) then
        perform _fail('This group has already bid; it cannot be removed');
      end if;
      delete from groups where id = (p_action->>'groupId')::integer and session_id = p_session;

    when 'setActive' then
      update groups set active = coalesce((p_action->>'active')::boolean, true)
      where id = (p_action->>'groupId')::integer and session_id = p_session;

    when 'renameGroup' then
      update groups set name = _clean_name(p_action->>'name')
      where id = (p_action->>'groupId')::integer and session_id = p_session;

    when 'updateSession' then
      update sessions set name = coalesce(nullif(trim(p_action->>'name'), ''), name),
        price_cap = coalesce((p_action->>'priceCap')::double precision, price_cap),
        round_seconds = coalesce((p_action->>'roundSeconds')::integer, round_seconds)
      where id = p_session;

    else
      perform _fail('Unknown action');
  end case;

  return _bundle(p_session, true);
end $$;

-- Rows for the CSV downloads. Column order is decided by the web app.
create or replace function admin_export(p_token text, p_session text, p_file text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_token);
  if p_file = 'results' then
    -- One row per round × group, including groups that did not bid.
    return coalesce((select jsonb_agg(to_jsonb(x) order by x.round, x.group_slot) from (
      select s.id as session_id, s.name as session_name, r.number as round, r.label, r.phase,
        r.demand_mw, r.demand_low, r.demand_high, r.clearing_price as market_price, r.marginal_price, r.served_mw,
        r.opened_at, r.closed_at,
        g.slot as group_slot, coalesce(g.name, 'Team ' || g.slot) as group_name, g.code as group_code,
        g.technology, (b.id is not null) as submitted,
        b.price as bid_price, b.revisions, b.submitted_at,
        coalesce(b.dispatched, 0) as dispatched,
        case when coalesce(b.dispatched, 0) > 0 then b.price end as paid_price,
        coalesce(b.profit, 0) as profit
      from rounds r join sessions s on s.id = r.session_id
      join groups g on g.session_id = r.session_id
      left join bids b on b.round_id = r.id and b.group_id = g.id
      where r.session_id = p_session and r.status = 'closed') x), '[]');
  elsif p_file = 'bid_log' then
    -- Every submission, including revised ones.
    return coalesce((select jsonb_agg(to_jsonb(x) order by x.submitted_at) from (
      select l.id, r.number as round, r.phase, g.slot as group_slot, coalesce(g.name, 'Team ' || g.slot) as group_name,
        g.technology, l.price, l.submitted_at,
        extract(epoch from (l.submitted_at - r.opened_at))::double precision as seconds_after_open
      from bid_log l join rounds r on r.id = l.round_id join groups g on g.id = l.group_id
      where l.session_id = p_session) x), '[]');
  elsif p_file = 'rounds' then
    return coalesce((select jsonb_agg(to_jsonb(x) order by x.round) from (
      select number as round, label, phase, status, demand_share, demand_spread, demand_low, demand_high,
        demand_mw, clearing_price as market_price,
        marginal_price, served_mw, opened_at, deadline, closed_at
      from rounds where session_id = p_session) x), '[]');
  elsif p_file = 'groups' then
    return coalesce((select jsonb_agg(to_jsonb(x) order by x.slot) from (
      select slot, name, code, technology, joined_at, active
      from groups where session_id = p_session) x), '[]');
  end if;
  perform _fail('Unknown export');
end $$;

-- ------------------------------------------------------------------ projector

create or replace function screen_state(p_session text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return _bundle(p_session, false);
end $$;

-- Sessions of the last two weeks, so the projector can pick one without a
-- password or a copied link. Only public facts: no codes, no offers.
create or replace function screen_sessions() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'createdAt', s.created_at,
      'teamsJoined', (select count(*) from groups g where g.session_id = s.id and g.active and g.joined_at is not null),
      'roundsPlayed', (select count(*) from rounds r where r.session_id = s.id and r.status = 'closed'))
      order by s.created_at desc)
    from sessions s where s.created_at > now() - interval '14 days'), '[]');
end $$;

-- ------------------------------------------------------------------ teams

create or replace function group_state(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g groups;
begin
  select * into g from groups where code = upper(trim(coalesce(p_code, '')));
  if not found then
    perform _fail('Unknown group code', 'not_found');
  end if;
  if g.joined_at is null then
    update groups set joined_at = now() where id = g.id returning * into g;
  end if;
  return _bundle(g.session_id, false, g.id) || jsonb_build_object(
    'me', to_jsonb(g),
    -- Own total and position among the teams that joined (ties share the better place).
    'myTotal', (select coalesce((t->>'profit')::double precision, 0)
                from jsonb_array_elements(_totals(g.session_id)) t where (t->>'group_id')::integer = g.id),
    'myRank', 1 + (select count(*) from jsonb_array_elements(_totals(g.session_id)) t
                   join groups o on o.id = (t->>'group_id')::integer
                   where o.joined_at is not null and o.id <> g.id
                     and (t->>'profit')::double precision >
                         coalesce((select (u->>'profit')::double precision from jsonb_array_elements(_totals(g.session_id)) u
                                   where (u->>'group_id')::integer = g.id), 0)),
    'myOpenBids', coalesce((
      select jsonb_agg(to_jsonb(b)) from bids b join rounds r on r.id = b.round_id
      where b.group_id = g.id and r.status = 'open'), '[]'));
end $$;

create or replace function group_rename(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update groups set name = _clean_name(p_name) where code = upper(trim(coalesce(p_code, '')));
  return group_state(p_code);
end $$;

drop function if exists group_bid(text, integer, double precision, double precision);
create or replace function group_bid(p_code text, p_round integer, p_price double precision) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g groups;
  r rounds;
  s sessions;
  v_price double precision;
begin
  select * into g from groups where code = upper(trim(coalesce(p_code, '')));
  if not found then
    perform _fail('Unknown group code', 'not_found');
  end if;
  if not g.active then
    perform _fail('Your team is paused. Ask the instructor to bring you back in.');
  end if;
  -- Share lock: waits for a concurrent close and then sees its result.
  select * into r from rounds where id = p_round for share;
  if not found or r.session_id <> g.session_id then
    perform _fail('Round not found', 'not_found');
  end if;
  if r.status <> 'open' then
    perform _fail('This round is closed');
  end if;
  if r.deadline is not null and now() > r.deadline + interval '5 seconds' then
    perform _fail('Time is up for this round');
  end if;
  select * into s from sessions where id = g.session_id;

  if p_price is null or p_price < 0 or p_price > s.price_cap or p_price = 'NaN'::double precision then
    perform _fail(format('Price must be between 0 and %s €/MWh', s.price_cap));
  end if;
  v_price := round(p_price::numeric, 2);

  -- Every team always offers its whole plant.
  insert into bids (round_id, group_id, price, quantity) values (r.id, g.id, v_price, g.capacity)
  on conflict (round_id, group_id) do update
    set price = excluded.price, quantity = excluded.quantity,
        revisions = bids.revisions + 1, submitted_at = now();
  insert into bid_log (session_id, round_id, group_id, price, quantity)
  values (g.session_id, r.id, g.id, v_price, g.capacity);
  update groups set joined_at = coalesce(joined_at, now()) where id = g.id;

  return group_state(p_code);
end $$;

-- ------------------------------------------------------------------ permissions

-- Nothing is callable from the web unless listed here.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  admin_login(text),
  admin_sessions(text),
  admin_create_session(text, text, integer, double precision, integer),
  admin_session(text, text),
  admin_action(text, text, jsonb),
  admin_export(text, text, text),
  screen_state(text),
  screen_sessions(),
  group_state(text),
  group_rename(text, text),
  group_bid(text, integer, double precision)
to anon, authenticated;
