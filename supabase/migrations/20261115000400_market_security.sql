-- Public reference data: anyone may read, nobody writes through the Data API. The loader uses the
-- service role, which bypasses row level security. Privileges are stated explicitly because
-- TRUNCATE is not covered by row level security.

do $$
declare
  t text;
begin
  foreach t in array array['data_sources', 'areas', 'faostat_items', 'crops', 'crop_faostat_items', 'crop_countries', 'producer_prices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    -- Stated rather than inherited, so the loader works whether or not the project auto-exposes new tables.
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('create policy "Public read" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end
$$;

revoke all on table public.crop_prices, public.crop_latest_prices from anon, authenticated;
grant select on table public.crop_prices, public.crop_latest_prices to anon, authenticated, service_role;

revoke all on function public.crop_price_series(text, integer) from public;
grant execute on function public.crop_price_series(text, integer) to anon, authenticated, service_role;
