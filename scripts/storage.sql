-- Run on the game-only Supabase project. Replace __SECRET_SHA256__ with
-- sha256(WITNESS_STORE_SECRET). Never put the plaintext secret in Git.
begin;
create schema if not exists witness_private;
revoke all on schema witness_private from public, anon, authenticated;
create table if not exists witness_private.documents (
  key text primary key,
  rev bigint not null default 0,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table witness_private.documents enable row level security;
revoke all on witness_private.documents from public, anon, authenticated;
create table if not exists witness_private.configuration (
  singleton boolean primary key default true check (singleton),
  secret_hash text not null
);
alter table witness_private.configuration enable row level security;
revoke all on witness_private.configuration from public, anon, authenticated;
insert into witness_private.configuration(singleton,secret_hash)
values (true,'__SECRET_SHA256__')
on conflict(singleton) do update set secret_hash=excluded.secret_hash;

create or replace function public.witness_store(
  p_secret text,
  p_op text,
  p_key text,
  p_expected bigint default null,
  p_value jsonb default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $body$
declare result jsonb; changed integer;
begin
  if p_secret is null or length(p_secret)<40 or not exists (
    select 1 from witness_private.configuration
    where singleton and secret_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex')
  ) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  if p_key is null or length(p_key)>180 or p_key !~ '^witness[:a-zA-Z0-9_-]+$' then
    raise exception 'Invalid key';
  end if;
  if p_op='get' then
    select jsonb_build_object('rev',rev,'value',value) into result
    from witness_private.documents where key=p_key;
    return result;
  elsif p_op='create' then
    if p_value is null then raise exception 'Missing value'; end if;
    insert into witness_private.documents(key,rev,value) values(p_key,0,p_value)
    on conflict(key) do nothing;
    get diagnostics changed = row_count;
    return to_jsonb(changed=1);
  elsif p_op='cas' then
    if p_value is null or p_expected is null then raise exception 'Missing value or version'; end if;
    update witness_private.documents set rev=rev+1,value=p_value,updated_at=now()
    where key=p_key and rev=p_expected;
    get diagnostics changed = row_count;
    return to_jsonb(changed=1);
  end if;
  raise exception 'Invalid operation';
end;
$body$;
revoke all on function public.witness_store(text,text,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.witness_store(text,text,text,bigint,jsonb) to anon;
comment on function public.witness_store is 'Server-only game document CAS; requires 256-bit server secret. No table access.';
notify pgrst, 'reload schema';
commit;
