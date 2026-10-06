create table if not exists public.stations (
  code text primary key,
  name text not null,
  state text not null default '',
  zone text not null default ''
);

create table if not exists public.trains (
  code text primary key,
  name text not null,
  from_city text not null,
  to_city text not null,
  departure text not null,
  arrival text not null,
  duration text not null default '',
  fares jsonb not null default '{"sleeper": 100, "chair": 160, "executive": 250}',
  seats integer not null default 100 check (seats > 0),
  days text not null default '',
  train_type text not null default '',
  running_days jsonb not null default '{}'::jsonb,
  overall_distance_km integer not null default 0,
  route jsonb not null default '[]'::jsonb
);

alter table public.trains add column if not exists train_type text not null default '';
alter table public.trains add column if not exists running_days jsonb not null default '{}'::jsonb;
alter table public.trains add column if not exists overall_distance_km integer not null default 0;
alter table public.trains add column if not exists route jsonb not null default '[]'::jsonb;
alter table public.trains add column if not exists demo_capacity integer not null default 100;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  train_code text not null references public.trains(code),
  journey_date date not null,
  passenger_name text not null,
  passenger_email text not null,
  seat_class text not null check (seat_class in ('sleeper', 'chair', 'executive')),
  amount integer not null check (amount > 0),
  payment_method text not null default 'demo',
  payment_status text not null default 'demo_paid' check (payment_status = 'demo_paid'),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table public.bookings add column if not exists from_station_code text;
alter table public.bookings add column if not exists to_station_code text;
alter table public.bookings add column if not exists from_sequence integer;
alter table public.bookings add column if not exists to_sequence integer;
alter table public.bookings add column if not exists service_date date;

create index if not exists bookings_user_date_idx
  on public.bookings (user_id, journey_date desc);
create index if not exists bookings_train_service_idx
  on public.bookings (train_code, service_date)
  where status = 'confirmed';
create index if not exists trains_route_idx on public.trains using gin (route jsonb_path_ops);
create index if not exists stations_name_idx on public.stations (name);

alter table public.stations enable row level security;
alter table public.trains enable row level security;
alter table public.bookings enable row level security;

drop policy if exists "Anyone can read stations" on public.stations;
create policy "Anyone can read stations" on public.stations for select using (true);
drop policy if exists "Anyone can read sample trains" on public.trains;
drop policy if exists "Anyone can read trains" on public.trains;
create policy "Anyone can read trains" on public.trains for select using (true);
drop policy if exists "Users can read their own bookings" on public.bookings;
create policy "Users can read their own bookings"
  on public.bookings for select to authenticated using (auth.uid() = user_id);

grant select on public.stations, public.trains to anon, authenticated;
grant select on public.bookings to authenticated;
revoke insert, update, delete on public.stations, public.trains, public.bookings from anon, authenticated;

drop function if exists public.create_demo_booking(text, date, text, text, text);

create or replace function public.search_demo_trains(
  p_from_station text,
  p_to_station text,
  p_travel_date date
)
returns table (
  train_code text,
  train_name text,
  train_type text,
  from_code text,
  from_name text,
  to_code text,
  to_name text,
  departure text,
  arrival text,
  from_journey_day integer,
  to_journey_day integer,
  segment_distance integer,
  fares jsonb,
  seats_left integer,
  running_days jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.code,
    t.name,
    t.train_type,
    p_from_station,
    coalesce(origin_stop->>'stationName', t.from_city),
    p_to_station,
    coalesce(destination_stop->>'stationName', t.to_city),
    coalesce(
      nullif(origin_stop->>'departureTime', ''),
      nullif(origin_stop->>'arrivalTime', ''),
      t.departure
    ),
    coalesce(
      nullif(destination_stop->>'arrivalTime', ''),
      nullif(destination_stop->>'departureTime', ''),
      t.arrival
    ),
    (origin_stop->>'journeyDay')::integer,
    (destination_stop->>'journeyDay')::integer,
    greatest(0, (destination_stop->>'distance')::integer - (origin_stop->>'distance')::integer),
    jsonb_build_object(
      'sleeper', 4200 + ceil(greatest(0, (destination_stop->>'distance')::integer - (origin_stop->>'distance')::integer) * 0.8)::integer,
      'chair', 5200 + ceil(greatest(0, (destination_stop->>'distance')::integer - (origin_stop->>'distance')::integer) * 1.4)::integer,
      'executive', 6200 + ceil(greatest(0, (destination_stop->>'distance')::integer - (origin_stop->>'distance')::integer) * 2.2)::integer
    ),
    greatest(0, t.demo_capacity - (
      select count(*)::integer
      from public.bookings b
      where b.train_code = t.code
        and b.service_date = p_travel_date - ((origin_stop->>'journeyDay')::integer - 1)
        and b.status = 'confirmed'
        and b.from_sequence < (destination_stop->>'sequence')::integer
        and b.to_sequence > (origin_stop->>'sequence')::integer
    )),
    t.running_days
  from public.trains t
  cross join lateral jsonb_array_elements(t.route) as origin_stop
  cross join lateral jsonb_array_elements(t.route) as destination_stop
  where t.route <> '[]'::jsonb
    and t.route @> jsonb_build_array(jsonb_build_object('stationCode', upper(p_from_station)))
    and t.route @> jsonb_build_array(jsonb_build_object('stationCode', upper(p_to_station)))
    and origin_stop->>'stationCode' = upper(p_from_station)
    and destination_stop->>'stationCode' = upper(p_to_station)
    and (origin_stop->>'sequence')::integer < (destination_stop->>'sequence')::integer
    and p_travel_date is not null
    and p_travel_date - ((origin_stop->>'journeyDay')::integer - 1) >= current_date
    and coalesce(
      (t.running_days ->> upper(to_char(
        p_travel_date - ((origin_stop->>'journeyDay')::integer - 1),
        'DY'
      )))::boolean,
      false
    )
  order by
    coalesce(nullif(origin_stop->>'departureTime', ''), nullif(origin_stop->>'arrivalTime', ''), t.departure),
    t.code
  limit 50;
$$;

revoke all on function public.search_demo_trains(text, text, date) from public;
grant execute on function public.search_demo_trains(text, text, date) to anon, authenticated;

create or replace function public.create_demo_booking(
  p_train_code text,
  p_from_station text,
  p_to_station text,
  p_travel_date date,
  p_passenger_name text,
  p_passenger_email text,
  p_seat_class text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_train public.trains%rowtype;
  v_origin jsonb;
  v_destination jsonb;
  v_amount integer;
  v_reference text;
  v_booking_id uuid;
  v_service_date date;
  v_booked_seats bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in before booking a ticket.';
  end if;

  if lower(trim(coalesce(p_passenger_email, ''))) <>
     lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'The passenger email must match your signed-in account.';
  end if;

  if length(trim(coalesce(p_passenger_name, ''))) not between 2 and 100 then
    raise exception 'Enter a passenger name between 2 and 100 characters.';
  end if;

  if p_travel_date is null or p_travel_date < current_date or p_travel_date > current_date + 365 then
    raise exception 'Choose a travel date within the next 365 days.';
  end if;

  if p_seat_class is null or p_seat_class not in ('sleeper', 'chair', 'executive') then
    raise exception 'Choose a valid travel class.';
  end if;

  select * into v_train from public.trains where code = p_train_code for update;
  if not found then
    raise exception 'This train is not available.';
  end if;

  select stop into v_origin
  from jsonb_array_elements(v_train.route) as stop
  where stop->>'stationCode' = upper(p_from_station)
  limit 1;
  select stop into v_destination
  from jsonb_array_elements(v_train.route) as stop
  where stop->>'stationCode' = upper(p_to_station)
  limit 1;

  if v_origin is null or v_destination is null
    or (v_origin->>'sequence')::integer >= (v_destination->>'sequence')::integer then
    raise exception 'Choose two stations on this train in travel order.';
  end if;

  v_service_date := p_travel_date - ((v_origin->>'journeyDay')::integer - 1);
  if v_service_date < current_date or v_service_date > current_date + 365 then
    raise exception 'Choose a travel date within the next 365 days.';
  end if;
  if not coalesce((v_train.running_days ->> upper(to_char(v_service_date, 'DY')))::boolean, false) then
    raise exception 'This train does not run on the selected date.';
  end if;

  v_amount := case p_seat_class
    when 'sleeper' then 4200 + ceil(greatest(0, (v_destination->>'distance')::integer - (v_origin->>'distance')::integer) * 0.8)::integer
    when 'chair' then 5200 + ceil(greatest(0, (v_destination->>'distance')::integer - (v_origin->>'distance')::integer) * 1.4)::integer
    else 6200 + ceil(greatest(0, (v_destination->>'distance')::integer - (v_origin->>'distance')::integer) * 2.2)::integer
  end;

  select count(*) into v_booked_seats
  from public.bookings b
  where b.train_code = v_train.code
    and b.service_date = v_service_date
    and b.status = 'confirmed'
    and b.from_sequence < (v_destination->>'sequence')::integer
    and b.to_sequence > (v_origin->>'sequence')::integer;

  if v_booked_seats >= v_train.demo_capacity then
    raise exception 'No demo seats are left on this segment for the selected date.';
  end if;

  v_reference := 'RY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.bookings (
    reference, user_id, train_code, journey_date, passenger_name,
    passenger_email, seat_class, amount, from_station_code, to_station_code,
    from_sequence, to_sequence, service_date
  )
  values (
    v_reference, auth.uid(), v_train.code, p_travel_date,
    trim(p_passenger_name), lower(trim(p_passenger_email)), p_seat_class, v_amount,
    upper(p_from_station), upper(p_to_station),
    (v_origin->>'sequence')::integer, (v_destination->>'sequence')::integer, v_service_date
  )
  returning id into v_booking_id;

  return jsonb_build_object(
    'id', v_booking_id,
    'reference', v_reference,
    'train_name', v_train.name,
    'train_code', v_train.code,
    'from_city', v_origin->>'stationName',
    'to_city', v_destination->>'stationName',
    'travel_date', p_travel_date,
    'departure', coalesce(nullif(v_origin->>'departureTime', ''), v_origin->>'arrivalTime'),
    'arrival', coalesce(nullif(v_destination->>'arrivalTime', ''), v_destination->>'departureTime'),
    'seat_class', p_seat_class,
    'amount', v_amount,
    'passenger_name', trim(p_passenger_name)
  );
end;
$$;

revoke all on function public.create_demo_booking(text, text, text, date, text, text, text) from public;
grant execute on function public.create_demo_booking(text, text, text, date, text, text, text) to authenticated;
