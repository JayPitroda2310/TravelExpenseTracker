-- Non-destructive migration for existing Trip Vault Supabase projects.
-- Run this instead of supabase.sql if you already have trips you want to keep.

alter table public.trips
  add column if not exists password_salt text,
  add column if not exists password_hash text;

alter table public.members
  add column if not exists password_salt text,
  add column if not exists password_hash text;

alter table public.expenses
  add column if not exists payment_method text not null default 'Cash';

alter table public.settlements
  add column if not exists payment_method text not null default 'Cash';

alter table public.settlements
  add column if not exists status text not null default 'confirmed',
  add column if not exists paid_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists recorded_by_member_id text references public.members(id) on delete set null,
  add column if not exists confirmed_by_member_id text references public.members(id) on delete set null;

alter table public.settlements
  drop constraint if exists settlements_status_check;

alter table public.settlements
  add constraint settlements_status_check
  check (status in ('pending_confirmation','confirmed'));

alter table public.transactions
  add column if not exists payment_method text;

alter table public.transactions
  drop constraint if exists transactions_type_check;

alter table public.transactions
  add constraint transactions_type_check
  check (type in ('join','pool','expense','settlement'));
