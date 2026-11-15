-- Structure the app and the loader rely on.
begin;
select plan(47);

select has_table('public', t, format('table %s exists', t))
from unnest(array['data_sources', 'areas', 'items', 'crops', 'crop_items', 'crop_country', 'producer_prices']) as t;
select hasnt_table('public', t, format('table %s of the first schema is gone', t))
from unnest(array['faostat_items', 'crop_faostat_items', 'crop_countries']) as t;
select has_view('public', 'crop_prices', 'view crop_prices exists');
select has_view('public', 'crop_latest_prices', 'view crop_latest_prices exists');
select has_function('public', 'crop_price_series', array['text', 'text'], 'function crop_price_series(crop, iso3) exists');

select col_is_pk('public', 'crops', 'crop_id', 'crops.crop_id is the primary key');
select col_is_pk('public', 'items', 'faostat_item_code', 'items.faostat_item_code is the primary key');
select col_is_pk('public', 'crop_items', array['crop_id', 'faostat_item_code'], 'one row per crop and item');
select col_is_pk('public', 'crop_country', array['crop_id', 'iso3'], 'one row per crop and country');
select col_is_pk('public', 'producer_prices', array['area_code', 'faostat_item_code', 'year', 'month'], 'one price row per area, item, year and month');
select fk_ok('public', 'crops', 'faostat_item_code', 'public', 'items', 'faostat_item_code', 'a crop points at its item');
select fk_ok('public', 'crop_items', 'crop_id', 'public', 'crops', 'crop_id', 'a link points at a crop');
select fk_ok('public', 'crop_items', 'faostat_item_code', 'public', 'items', 'faostat_item_code', 'a link points at an item');
select fk_ok('public', 'crop_country', 'crop_id', 'public', 'crops', 'crop_id', 'a crop-country row points at a crop');
select fk_ok('public', 'crop_country', 'iso3', 'public', 'areas', 'iso3', 'a crop-country row points at a country');
select fk_ok('public', 'producer_prices', 'area_code', 'public', 'areas', 'area_code', 'a price points at an area');
select fk_ok('public', 'producer_prices', 'faostat_item_code', 'public', 'items', 'faostat_item_code', 'a price points at an item');

-- Fixture with ids no real row uses, so the tests pass on an empty database and on a seeded one.
-- XTA and XTB are in the range ISO 3166 leaves to users; 4993 is an area without an ISO code.
insert into public.areas (area_code, m49_code, name, iso3) values (4991, '991', 'Testland', 'XTA'), (4992, '992', 'Otherland', 'XTB'), (4993, '993', 'Formerland', null);
insert into public.items (faostat_item_code, faostat_item, item_class) values
  (99001, 'Test grain', 'single'), (99002, 'Test grain, green', 'single'), (99003, 'Other test vegetables, n.e.c.', 'group');
insert into public.crops (crop_id, scientific_name, match, faostat_item_code, item_shared_by_n_crops, curated) values
  ('test-grain', 'Testum granum', 'exact', 99001, 1, true),
  ('test-leaf', 'Testum folium', 'group', 99003, 2, false),
  ('test-leaf-red', 'Testum folium var. rubrum', 'group', 99003, 2, false),
  ('test-wild', 'Testum ferum', 'none', null, null, false);
insert into public.crop_items (crop_id, faostat_item_code, is_primary) values
  ('test-grain', 99001, true), ('test-grain', 99002, false), ('test-leaf', 99003, true), ('test-leaf-red', 99003, true);
insert into public.crop_country (crop_id, iso3, country, faostat_item_code, match, item_reported, area_ha, level) values
  ('test-grain', 'XTA', 'Testland', '99001;99002', 'exact', true, 120000, 'major'),
  ('test-grain', 'XTB', 'Otherland', '99001;99002', 'exact', false, null, 'absent'),
  ('test-leaf', 'XTA', 'Testland', '99003', 'group', true, null, 'unknown');
insert into public.producer_prices (area_code, faostat_item_code, year, month, lcu_per_tonne, usd_per_tonne, lcu_flag, usd_flag) values
  (4991, 99001, 2022, 0, 7000000, 311.4, 'A', 'A'),
  (4991, 99001, 2024, 0, 8900000, 356.0, 'A', 'A'),
  (4991, 99001, 2024, 3, 8800000, null, 'A', null),
  (4991, 99002, 2024, 0, 20000000, 800.0, 'A', 'A'),
  (4992, 99001, 2024, 0, 330.7, 330.7, 'A', 'A'),
  (4993, 99001, 1991, 0, 90, null, 'A', null),
  (4991, 99003, 2024, 0, 9000000, 359.4, 'A', 'A');

select is((select count(*)::int from public.crop_prices where crop_id = 'test-grain' and faostat_item_code = 99001 and iso3 = 'XTA'), 2, 'crop_prices holds annual rows only');
select is((select usd_per_tonne from public.crop_latest_prices where crop_id = 'test-grain' and is_primary_item and iso3 = 'XTA'), 356.0, 'crop_latest_prices returns the most recent year');
select is((select level from public.crop_latest_prices where crop_id = 'test-grain' and is_primary_item and iso3 = 'XTA'), 'major', 'a price carries how much of the crop the country grows');
select is((select level from public.crop_latest_prices where crop_id = 'test-grain' and is_primary_item and iso3 = 'XTB'), 'absent', 'a price reported where the crop is not grown says so');
select is((select count(*)::int from public.crop_latest_prices where crop_id = 'test-grain' and iso3 = 'XTA'), 2, 'a crop with two items has a latest price for each');
select is((select item_shared_by_n_crops from public.crop_latest_prices where crop_id = 'test-grain' and not is_primary_item and iso3 = 'XTA'), null, 'the crop count is given for the crop''s own item only');
select is(
  (select array[item_class, match, level] from public.crop_latest_prices where crop_id = 'test-leaf' and iso3 = 'XTA'),
  array['group', 'group', 'unknown'],
  'a price of a group item is flagged, and the level of the crop is unknown'
);
select is((select item_shared_by_n_crops from public.crop_latest_prices where crop_id = 'test-leaf-red' and iso3 = 'XTA'), 2, 'a price shared by two crops says so');
select is((select count(*)::int from public.crop_prices where crop_id = 'test-wild'), 0, 'a crop without an item has no price');
select is((select count(*)::int from public.crop_prices where crop_id = 'test-grain' and iso3 is null), 1, 'a price of an area without an ISO code is kept, without a level');
select results_eq(
  $$ select year::int, faostat_item_code, is_primary_item, usd_per_tonne from public.crop_price_series('test-grain', 'XTA') $$,
  $$ values (2022, 99001, true, 311.4), (2024, 99001, true, 356.0), (2024, 99002, false, 800.0) $$,
  'crop_price_series returns the crop''s own item first, oldest year first'
);

select throws_ok($$ insert into public.crops (crop_id, scientific_name, match, curated) values ('Bad Id', 'y', 'none', false) $$, '23514', null, 'a crop id must be a slug');
select throws_ok($$ insert into public.crops (crop_id, scientific_name, match, curated, ph_opt_min) values ('test-x', 'Testum x', 'none', false, 15) $$, '23514', null, 'pH above 14 is rejected');
select throws_ok($$ insert into public.crops (crop_id, scientific_name, match, curated, latitude_abs_max_deg) values ('test-y', 'Testum y', 'none', false, 1800) $$, '23514', null, 'a latitude above 90 is rejected');
select throws_ok($$ insert into public.crops (crop_id, scientific_name, match, curated, faostat_item_code) values ('test-z', 'Testum z', 'none', false, 99001) $$, '23514', null, 'match = none and an item contradict each other');
select throws_ok($$ insert into public.crop_items (crop_id, faostat_item_code, is_primary) values ('test-leaf', 99001, true) $$, '23505', null, 'a crop has one primary item');
select throws_ok($$ insert into public.crop_country (crop_id, iso3, country, match, item_reported, level) values ('test-leaf', 'XTB', 'Otherland', 'group', true, 'often') $$, '23514', null, 'a level outside the atlas vocabulary is rejected');
select throws_ok($$ insert into public.areas (area_code, m49_code, name, iso3) values (4994, '994', 'Lowerland', 'xt') $$, '23514', null, 'an ISO code is three capital letters');
select throws_ok($$ insert into public.producer_prices (area_code, faostat_item_code, year, month, usd_per_tonne) values (4991, 99001, 2023, 13, 1) $$, '23514', null, 'month 13 is rejected');
select throws_ok($$ insert into public.producer_prices (area_code, faostat_item_code, year, month) values (4991, 99001, 2023, 0) $$, '23514', null, 'a price row needs at least one value');

-- A crop or an item the atlas no longer holds is deleted by the loader; what hangs on it goes too.
delete from public.crops where crop_id = 'test-leaf-red';
delete from public.items where faostat_item_code = 99002;
select is((select count(*)::int from public.crop_items where crop_id = 'test-leaf-red' or faostat_item_code = 99002), 0, 'deleting a crop or an item deletes its links');
select is((select count(*)::int from public.producer_prices where faostat_item_code = 99002), 0, 'deleting an item deletes its prices');

select * from finish();
rollback;
