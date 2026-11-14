-- Structure the app and the loader rely on.
begin;
select plan(29);

select has_table('public', t, format('table %s exists', t))
from unnest(array['data_sources', 'areas', 'faostat_items', 'crops', 'crop_faostat_items', 'crop_countries', 'producer_prices']) as t;
select has_view('public', 'crop_prices', 'view crop_prices exists');
select has_view('public', 'crop_latest_prices', 'view crop_latest_prices exists');
select has_function('public', 'crop_price_series', array['text', 'integer'], 'function crop_price_series(text, integer) exists');

select col_is_pk('public', 'crops', 'id', 'crops.id is the primary key');
select col_is_pk('public', 'producer_prices', array['area_code', 'item_code', 'year', 'month'], 'one price row per area, item, year and month');
select col_is_pk('public', 'crop_countries', array['crop_id', 'area_code'], 'one row per crop and producing country');
select fk_ok('public', 'crop_faostat_items', 'crop_id', 'public', 'crops', 'id', 'a link points at a crop');
select fk_ok('public', 'crop_faostat_items', 'item_code', 'public', 'faostat_items', 'item_code', 'a link points at an item');
select fk_ok('public', 'producer_prices', 'area_code', 'public', 'areas', 'area_code', 'a price points at an area');
select fk_ok('public', 'producer_prices', 'item_code', 'public', 'faostat_items', 'item_code', 'a price points at an item');

-- Fixture with ids no real row uses, so the tests pass on an empty database and on a seeded one.
insert into public.areas (area_code, m49_code, name) values (4991, '991', 'Testland'), (4992, '992', 'Otherland');
insert into public.faostat_items (item_code, cpc_code, name, is_residual) values (99001, 'T1', 'Test grain', false), (99002, 'T2', 'Other test vegetables, n.e.c.', true);
insert into public.crops (id, name, scientific_name) values ('test-grain', 'Test grain', 'Testum granum'), ('test-leaf', 'Test leaf', 'Testum folium'), ('test-leaf-red', 'Red test leaf', 'Testum folium var. rubrum');
insert into public.crop_faostat_items (crop_id, item_code, match_method) values ('test-grain', 99001, 'producing-countries'), ('test-leaf', 99002, 'producing-countries'), ('test-leaf-red', 99002, 'producing-countries');
insert into public.crop_countries (crop_id, area_code) values ('test-grain', 4991);
insert into public.producer_prices (area_code, item_code, year, month, lcu_per_tonne, usd_per_tonne, lcu_flag, usd_flag) values
  (4991, 99001, 2022, 0, 7000000, 311.4, 'A', 'A'),
  (4991, 99001, 2024, 0, 8900000, 356.0, 'A', 'A'),
  (4991, 99001, 2024, 3, 8800000, null, 'A', null),
  (4992, 99001, 2024, 0, 330.7, 330.7, 'A', 'A'),
  (4991, 99002, 2024, 0, 9000000, 359.4, 'A', 'A');

select is((select count(*)::int from public.crop_prices where crop_id = 'test-grain'), 3, 'crop_prices holds annual rows only');
select is((select usd_per_tonne from public.crop_latest_prices where crop_id = 'test-grain' and area_code = 4991), 356.0, 'crop_latest_prices returns the most recent year');
select is((select is_producer from public.crop_latest_prices where crop_id = 'test-grain' and area_code = 4992), false, 'a country outside the atlas list is not flagged as producer');
select is((select item_is_residual from public.crop_latest_prices where crop_id = 'test-leaf' and area_code = 4991), true, 'a price from a pooled FAOSTAT class is flagged');
select is((select item_crop_count from public.crop_latest_prices where crop_id = 'test-grain' and area_code = 4991), 1, 'an item linked to one crop counts one crop');
select is((select item_crop_count from public.crop_price_series('test-leaf-red', 4991)), 2, 'a price shared by two crops says so');
select results_eq(
  $$ select year::int, usd_per_tonne from public.crop_price_series('test-grain', 4991) $$,
  $$ values (2022, 311.4), (2024, 356.0) $$,
  'crop_price_series returns the annual series, oldest first'
);

select throws_ok($$ insert into public.crops (id, name, scientific_name) values ('Bad Id', 'x', 'y') $$, '23514', null, 'a crop id must be a slug');
select throws_ok($$ insert into public.crops (id, name, scientific_name, ph_opt_min) values ('test-x', 'x', 'Testum x', 15) $$, '23514', null, 'pH above 14 is rejected');
select throws_ok($$ insert into public.crops (id, name, scientific_name, lat_abs_max) values ('test-y', 'y', 'Testum y', 1800) $$, '23514', null, 'a latitude above 90 is rejected');
select throws_ok($$ insert into public.producer_prices (area_code, item_code, year, month, usd_per_tonne) values (4991, 99001, 2023, 13, 1) $$, '23514', null, 'month 13 is rejected');
select throws_ok($$ insert into public.producer_prices (area_code, item_code, year, month) values (4991, 99001, 2023, 0) $$, '23514', null, 'a price row needs at least one value');

select * from finish();
rollback;
