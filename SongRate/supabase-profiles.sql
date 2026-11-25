-- SongRate: профілі з аватарками (запусти один раз у Supabase → SQL Editor)

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text,
  avatar     text check (avatar is null or length(avatar) < 200000),  -- маленька картинка (data URL)
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Бачити аватарки й імена можуть усі
drop policy if exists "profiles: read for everyone" on public.profiles;
create policy "profiles: read for everyone"
  on public.profiles for select
  using (true);

-- Створювати і змінювати — лише свій профіль
drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
