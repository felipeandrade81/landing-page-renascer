-- RENASCER · configuração do banco no Supabase
-- Rode UMA vez: Supabase › SQL Editor › New query › cole tudo › Run.

-- 1) Tabela única onde o sistema guarda os dados (em JSON)
create table if not exists public.app_state (
  part       text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) Segurança em nível de linha: só quem fez LOGIN (contas criadas no painel do Supabase) lê e grava.
--    Visitantes anônimos, mesmo com a chave pública do config.js, não enxergam nada.
alter table public.app_state enable row level security;

drop policy if exists "staff le"     on public.app_state;
drop policy if exists "staff insere" on public.app_state;
drop policy if exists "staff altera" on public.app_state;

create policy "staff le"     on public.app_state for select to authenticated using (true);
create policy "staff insere" on public.app_state for insert to authenticated with check (true);
create policy "staff altera" on public.app_state for update to authenticated using (true) with check (true);

grant select, insert, update on public.app_state to authenticated;

-- 3) Mantém a data da última alteração
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists app_state_touch on public.app_state;
create trigger app_state_touch before update on public.app_state
for each row execute function public.touch_updated_at();
