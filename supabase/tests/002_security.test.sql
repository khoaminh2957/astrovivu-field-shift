-- Anyone reads, nobody writes through the Data API.
begin;
select plan(20);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'every table in public has row level security enabled'
);
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions::text ilike '%security_invoker=true%', false)),
  0,
  'every view in public runs with the caller''s rights'
);

-- Fixture with ids no real row uses (see 001_schema.test.sql).
insert into public.areas (area_code, m49_code, name) values (4991, '991', 'Testland');
insert into public.faostat_items (item_code, name) values (99001, 'Test grain');
insert into public.crops (id, name, scientific_name) values ('test-grain', 'Test grain', 'Testum granum');
insert into public.crop_faostat_items (crop_id, item_code, match_method) values ('test-grain', 99001, 'producing-countries');
insert into public.producer_prices (area_code, item_code, year, usd_per_tonne) values (4991, 99001, 2024, 356.0);

set local role anon;
select is((select count(*)::int from public.crops where id = 'test-grain'), 1, 'anon reads crops');
select is((select count(*)::int from public.producer_prices where item_code = 99001), 1, 'anon reads producer_prices');
select is((select count(*)::int from public.crop_latest_prices where crop_id = 'test-grain'), 1, 'anon reads through the views');
select is((select count(*)::int from public.crop_price_series('test-grain', 4991)), 1, 'anon calls crop_price_series');
select throws_ok($$ insert into public.crops (id, name, scientific_name) values ('test-x', 'x', 'Testum x') $$, '42501', null, 'anon cannot insert a crop');
select throws_ok($$ update public.producer_prices set usd_per_tonne = 1 $$, '42501', null, 'anon cannot change a price');
select throws_ok($$ delete from public.crops $$, '42501', null, 'anon cannot delete crops');
select throws_ok($$ truncate public.producer_prices $$, '42501', null, 'anon cannot truncate prices');
select throws_ok($$ insert into public.data_sources (code, name, publisher, url) values ('x', 'x', 'x', 'x') $$, '42501', null, 'anon cannot add a data source');
reset role;

set local role authenticated;
select is((select count(*)::int from public.crops where id = 'test-grain'), 1, 'a signed-in user reads crops');
select throws_ok($$ insert into public.areas (area_code, m49_code, name) values (4993, '993', 'Thirdland') $$, '42501', null, 'a signed-in user cannot insert an area');
select throws_ok($$ update public.crops set name = 'x' $$, '42501', null, 'a signed-in user cannot change a crop');
select throws_ok($$ delete from public.producer_prices $$, '42501', null, 'a signed-in user cannot delete prices');
select throws_ok($$ truncate public.crops cascade $$, '42501', null, 'a signed-in user cannot truncate crops');
reset role;

set local role service_role;
select lives_ok($$ insert into public.areas (area_code, m49_code, name) values (4992, '992', 'Otherland') $$, 'the service role inserts (the loader)');
select lives_ok($$ update public.producer_prices set usd_per_tonne = 357 where area_code = 4991 $$, 'the service role updates');
select is((select usd_per_tonne from public.producer_prices where area_code = 4991), 357::numeric, 'the update is visible');
select lives_ok($$ delete from public.producer_prices where area_code = 4991 $$, 'the service role deletes');
reset role;

select * from finish();
rollback;
