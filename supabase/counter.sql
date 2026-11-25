-- Лічильник розтягувань для пасхалки на haiduk.top
-- Запусти цей файл один раз: Supabase → SQL Editor → New query → встав → Run.

-- 1. Таблиця з лічильниками
create table if not exists public.counters (
  key        text primary key,
  value      bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- 2. Захист: читати може будь-хто, а змінювати напряму — ніхто
alter table public.counters enable row level security;

drop policy if exists "counters: read for everyone" on public.counters;
create policy "counters: read for everyone"
  on public.counters for select
  using (true);

-- 3. Єдиний спосіб змінити значення — ця функція.
--    Приймає лише відомі ключі й додає від 1 до 20 за раз (сайт відправляє розтягування пачками).
create or replace function public.increment_counter(counter_key text, amount int default 1)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_value bigint;
begin
  if counter_key not in ('stretches') then
    raise exception 'unknown counter';
  end if;

  amount := greatest(1, least(coalesce(amount, 1), 20));

  insert into public.counters (key, value)
  values (counter_key, amount)
  on conflict (key) do update
    set value = public.counters.value + excluded.value,
        updated_at = now()
  returning value into new_value;

  return new_value;
end;
$$;

revoke all on function public.increment_counter(text, int) from public;
grant execute on function public.increment_counter(text, int) to anon, authenticated;

-- 4. Стартове значення
insert into public.counters (key, value) values ('stretches', 0)
on conflict (key) do nothing;
