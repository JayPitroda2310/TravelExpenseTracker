-- Trip Vault schema (state JSON + normalized tables)

drop table if exists public.expense_splits cascade;
drop table if exists public.expenses cascade;
drop table if exists public.settlements cascade;
drop table if exists public.transactions cascade;
drop table if exists public.members cascade;
drop table if exists public.trips cascade;
drop table if exists public.tripvault_state cascade;

create table public.tripvault_state (
  id text primary key,
  app_state jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.trips (
  id text primary key,
  code text not null unique check (char_length(code) = 6),
  name text not null,
  password_salt text,
  password_hash text,
  initial_pool numeric(12,2) not null default 0 check (initial_pool >= 0),
  current_pool numeric(12,2) not null default 0 check (current_pool >= 0),
  admin_member_id text,
  created_at timestamptz not null default now()
);

create table public.members (
  id text primary key,
  trip_id text not null references public.trips(id) on delete cascade,
  name text not null,
  password_salt text,
  password_hash text,
  contribution numeric(12,2) not null default 0 check (contribution >= 0),
  joined_at timestamptz not null default now()
);

create unique index members_trip_id_name_ci_idx
on public.members (trip_id, lower(name));

create table public.expenses (
  id text primary key,
  trip_id text not null references public.trips(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  category text not null,
  payment_method text not null default 'Cash',
  paid_by_member_id text not null references public.members(id) on delete restrict,
  split_type text not null check (split_type in ('equal','unequal','percent')),
  split_label text not null,
  created_at timestamptz not null default now()
);

create table public.expense_splits (
  expense_id text not null references public.expenses(id) on delete cascade,
  member_id text not null references public.members(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  primary key (expense_id, member_id)
);

create table public.settlements (
  id text primary key,
  trip_id text not null references public.trips(id) on delete cascade,
  from_member_id text not null references public.members(id) on delete restrict,
  to_member_id text not null references public.members(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  payment_method text not null default 'Cash',
  status text not null default 'confirmed' check (status in ('pending_confirmation','confirmed')),
  paid_at timestamptz,
  confirmed_at timestamptz,
  recorded_by_member_id text references public.members(id) on delete set null,
  confirmed_by_member_id text references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_member_id <> to_member_id)
);

create table public.transactions (
  id text primary key,
  trip_id text not null references public.trips(id) on delete cascade,
  type text not null check (type in ('join','pool','expense','settlement')),
  description text not null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  payment_method text,
  member_id text references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.trips
  add constraint trips_admin_member_fk
  foreign key (admin_member_id) references public.members(id) on delete set null;

create index idx_members_trip_id on public.members(trip_id);
create index idx_expenses_trip_id_created_at on public.expenses(trip_id, created_at desc);
create index idx_settlements_trip_id_created_at on public.settlements(trip_id, created_at desc);
create index idx_transactions_trip_id_created_at on public.transactions(trip_id, created_at desc);

alter table public.tripvault_state enable row level security;
alter table public.trips enable row level security;
alter table public.members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;
alter table public.transactions enable row level security;

drop policy if exists tripvault_state_all on public.tripvault_state;
create policy tripvault_state_all on public.tripvault_state
for all to anon, authenticated using (true) with check (true);

drop policy if exists trips_all on public.trips;
create policy trips_all on public.trips
for all to anon, authenticated using (true) with check (true);

drop policy if exists members_all on public.members;
create policy members_all on public.members
for all to anon, authenticated using (true) with check (true);

drop policy if exists expenses_all on public.expenses;
create policy expenses_all on public.expenses
for all to anon, authenticated using (true) with check (true);

drop policy if exists expense_splits_all on public.expense_splits;
create policy expense_splits_all on public.expense_splits
for all to anon, authenticated using (true) with check (true);

drop policy if exists settlements_all on public.settlements;
create policy settlements_all on public.settlements
for all to anon, authenticated using (true) with check (true);

drop policy if exists transactions_all on public.transactions;
create policy transactions_all on public.transactions
for all to anon, authenticated using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.tripvault_state to anon, authenticated;
grant select, insert, update, delete on public.trips to anon, authenticated;
grant select, insert, update, delete on public.members to anon, authenticated;
grant select, insert, update, delete on public.expenses to anon, authenticated;
grant select, insert, update, delete on public.expense_splits to anon, authenticated;
grant select, insert, update, delete on public.settlements to anon, authenticated;
grant select, insert, update, delete on public.transactions to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.tripvault_state;
exception
  when duplicate_object then null;
end $$;
