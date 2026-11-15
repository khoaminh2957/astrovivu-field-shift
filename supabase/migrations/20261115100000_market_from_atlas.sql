-- The market tables now follow the crop atlas of the repository (data/crops/atlas/, described in
-- docs/CROP_DATA.md and column by column in data/crops/atlas/columns.csv) instead of the crop sheet
-- the first schema was written for. Three atlas tables are mirrored with their own column names:
-- crops, items, crop_country. Countries get their ISO code, the key the atlas uses.
--
-- Nothing is converted. The earlier tables held other crops under other keys, and every row of
-- this database comes from files of the repository and from FAOSTAT: `npm run db:load` writes
-- all of it again.

drop function public.crop_price_series(text, integer);
drop view public.crop_latest_prices;
drop view public.crop_prices;
drop table public.producer_prices;
drop table public.crop_countries;
drop table public.crop_faostat_items;
drop table public.crops;
drop table public.faostat_items;
truncate public.areas, public.data_sources;

-- ---------------------------------------------------------------------------------------------
-- Provenance and countries
-- ---------------------------------------------------------------------------------------------

alter table public.data_sources
  add column licence text,
  -- Day the file was downloaded, as the build that used it recorded.
  add column accessed_on date,
  add column sha256 text check (sha256 ~ '^[0-9a-f]{64}$');
comment on table public.data_sources is 'Provenance of every dataset behind this database: the sources of the crop atlas (data/crops/atlas/sources.csv) and FAOSTAT producer prices.';

alter table public.areas add column iso3 text unique check (iso3 ~ '^[A-Z]{3}$');
comment on column public.areas.iso3 is 'ISO 3166-1 alpha-3, the country key of the crop atlas. Null for an area that is not an atlas country (a former state such as the USSR): its prices are kept, no crop-country row refers to it.';

-- ---------------------------------------------------------------------------------------------
-- Mirrors of the crop atlas. Column names, meanings and rules: data/crops/atlas/columns.csv.
-- ---------------------------------------------------------------------------------------------

create table public.items (
  faostat_item_code     integer primary key,
  faostat_item          text not null,
  cpc_code              text,
  item_class            text not null check (item_class in ('single', 'group')),
  class_reason          text,
  fao_definition_name   text,
  definition            text,
  definition_sources    text,
  taxa_named            text,
  n_crops               integer check (n_crops >= 0),
  crop_ids              text,
  member_crop_ids       text,
  spam_crop             text,
  n_countries_producing integer check (n_countries_producing >= 0),
  world_area_ha         numeric check (world_area_ha >= 0),
  world_production_t    numeric check (world_production_t >= 0)
);
comment on table public.items is 'FAOSTAT crop items (atlas table items.csv). item_class = group: the item covers several genera or is a residual class, and its quantities and its price are not those of any one species.';

create table public.crops (
  crop_id                     text primary key check (crop_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ecocrop_id                  integer,
  scientific_name             text not null,
  authority                   text,
  name_en                     text,
  name_en_source              text,
  name_ecocrop_first          text,
  name_vi                     text,
  common_names                text,
  synonyms                    text,
  family                      text,
  life_form                   text,
  physiology                  text,
  habit                       text,
  category                    text,
  life_span                   text,
  plant_attributes            text,
  uses_main                   text,
  -- The limits below are those of the atlas build (scripts/crops/atlas/ecocrop.ts, RANGES): a value
  -- outside them was dropped there, so one arriving here means the two have drifted apart.
  temp_opt_min_c              numeric check (temp_opt_min_c between -60 and 60),
  temp_opt_max_c              numeric check (temp_opt_max_c between -60 and 60),
  temp_abs_min_c              numeric check (temp_abs_min_c between -60 and 60),
  temp_abs_max_c              numeric check (temp_abs_max_c between -60 and 60),
  rain_opt_min_mm             numeric check (rain_opt_min_mm between 0 and 12000),
  rain_opt_max_mm             numeric check (rain_opt_max_mm between 0 and 12000),
  rain_abs_min_mm             numeric check (rain_abs_min_mm between 0 and 12000),
  rain_abs_max_mm             numeric check (rain_abs_max_mm between 0 and 12000),
  ph_opt_min                  numeric check (ph_opt_min between 0 and 14),
  ph_opt_max                  numeric check (ph_opt_max between 0 and 14),
  ph_abs_min                  numeric check (ph_abs_min between 0 and 14),
  ph_abs_max                  numeric check (ph_abs_max between 0 and 14),
  soil_depth_opt              text,
  soil_depth_abs              text,
  soil_texture_opt            text,
  soil_texture_abs            text,
  soil_fertility_opt          text,
  soil_fertility_abs          text,
  soil_salinity_opt           text,
  soil_salinity_abs           text,
  soil_drainage_opt           text,
  soil_drainage_abs           text,
  soil_al_toxicity_opt        text,
  soil_al_toxicity_abs        text,
  light_opt_min               text,
  light_opt_max               text,
  light_abs_min               text,
  light_abs_max               text,
  latitude_opt_min_deg        numeric check (latitude_opt_min_deg between 0 and 90),
  latitude_opt_max_deg        numeric check (latitude_opt_max_deg between 0 and 90),
  latitude_abs_min_deg        numeric check (latitude_abs_min_deg between 0 and 90),
  latitude_abs_max_deg        numeric check (latitude_abs_max_deg between 0 and 90),
  altitude_opt_min_m          numeric check (altitude_opt_min_m between -500 and 9000),
  altitude_opt_max_m          numeric check (altitude_opt_max_m between -500 and 9000),
  altitude_abs_min_m          numeric check (altitude_abs_min_m between -500 and 9000),
  altitude_abs_max_m          numeric check (altitude_abs_max_m between -500 and 9000),
  climate_zones               text,
  photoperiod                 text,
  killing_temp_rest_c         numeric check (killing_temp_rest_c between -90 and 60),
  killing_temp_early_growth_c numeric check (killing_temp_early_growth_c between -90 and 60),
  cycle_min_days              integer check (cycle_min_days between 1 and 366),
  cycle_max_days              integer check (cycle_max_days between 1 and 366),
  ecocrop_cleaning            text,
  faostat_item_code           integer references public.items (faostat_item_code),
  faostat_item                text,
  cpc_code                    text,
  faostat_other_item_codes    text,
  match                       text not null check (match in ('exact', 'group', 'none')),
  match_method                text,
  matched_common_name         text,
  item_shared_by_n_crops      integer check (item_shared_by_n_crops >= 1),
  spam_crop                   text,
  spam_crop_name              text,
  spam_class                  text,
  evidence                    text,
  commonness                  text check (commonness in ('global', 'widespread', 'regional', 'local')),
  n_countries_producing       integer check (n_countries_producing >= 0),
  world_area_ha               numeric check (world_area_ha >= 0),
  world_production_t          numeric check (world_production_t >= 0),
  data_years                  text,
  curated                     boolean not null,
  urban_candidate             text,
  urban_candidate_rule        text,
  -- A crop the atlas attaches to no item says so, and the other way round.
  check ((match = 'none') = (faostat_item_code is null))
);
comment on table public.crops is 'Kept crops of the atlas (crops.csv). match = exact: the FAOSTAT item is this species or names only its genus. group: the item covers more than this crop. none: no item names it, so it has no FAOSTAT quantity and no price.';
comment on column public.crops.item_shared_by_n_crops is 'Kept crops attached to the same FAOSTAT item. Above 1, the quantities and the price of the item are shared by these crops and cannot be split.';

-- A crop can be counted under several items (maize grain and green corn). The atlas names one item
-- in crops.faostat_item_code and the others in crops.faostat_other_item_codes; this table holds
-- both as rows, so that a price can be joined to its crop.
create table public.crop_items (
  crop_id           text not null references public.crops (crop_id) on delete cascade,
  faostat_item_code integer not null references public.items (faostat_item_code) on delete cascade,
  is_primary        boolean not null,
  primary key (crop_id, faostat_item_code)
);
create index crop_items_item_idx on public.crop_items (faostat_item_code);
create unique index crop_items_one_primary_idx on public.crop_items (crop_id) where is_primary;
comment on table public.crop_items is 'Crop to FAOSTAT item, one row per pair. is_primary: the item the atlas attaches the crop to.';

create table public.crop_country (
  crop_id                             text not null references public.crops (crop_id) on delete cascade,
  iso3                                text not null references public.areas (iso3),
  country                             text not null,
  faostat_item_code                   text,
  match                               text not null check (match in ('exact', 'group')),
  item_reported                       boolean not null,
  area_ha                             numeric check (area_ha >= 0),
  production_t                        numeric check (production_t >= 0),
  yield_t_ha                          numeric check (yield_t_ha >= 0),
  year_from                           integer,
  year_to                             integer,
  share_of_country_harvested_area_pct numeric check (share_of_country_harvested_area_pct between 0 and 100),
  rank_in_country                     integer check (rank_in_country >= 1),
  level                               text not null check (level in ('major', 'common', 'minor', 'present', 'absent', 'unknown')),
  source                              text,
  primary key (crop_id, iso3)
);
create index crop_country_iso3_level_idx on public.crop_country (iso3, level);
comment on table public.crop_country is 'One row per kept crop and country (crop_country.csv): how much of it the country grows. level = unknown for a group crop: the country reports the group item, the species is not known.';
comment on column public.crop_country.faostat_item_code is 'Item or items the quantities come from, largest first, separated by ";".';

-- ---------------------------------------------------------------------------------------------
-- FAOSTAT producer prices: what farmers received at the farm gate. One row per area, item, year
-- and month; month 0 is the annual value. The four measures of FAOSTAT sit side by side.
-- ---------------------------------------------------------------------------------------------

create table public.producer_prices (
  area_code         integer not null references public.areas (area_code),
  faostat_item_code integer not null references public.items (faostat_item_code) on delete cascade,
  year              smallint not null check (year between 1960 and 2100),
  month             smallint not null default 0 check (month between 0 and 12),
  -- Local currency in use that year / current local currency / US dollars, per tonne.
  lcu_per_tonne     numeric check (lcu_per_tonne >= 0),
  slc_per_tonne     numeric check (slc_per_tonne >= 0),
  usd_per_tonne     numeric check (usd_per_tonne >= 0),
  -- Producer price index, 2014-2016 = 100.
  price_index       numeric check (price_index >= 0),
  -- FAOSTAT flags: A official, E estimated, I imputed, X from an international organisation, B break in the series.
  lcu_flag          text,
  slc_flag          text,
  usd_flag          text,
  index_flag        text,
  primary key (area_code, faostat_item_code, year, month),
  check (num_nonnulls(lcu_per_tonne, slc_per_tonne, usd_per_tonne, price_index) > 0)
);
comment on table public.producer_prices is 'FAOSTAT Producer Prices (domain PP) of the atlas items. month = 0 is the annual value.';

-- The primary key serves "one country, all items"; this one serves "one item, all countries".
create index producer_prices_item_year_idx on public.producer_prices (faostat_item_code, year desc, area_code) where month = 0;

-- ---------------------------------------------------------------------------------------------
-- What a client reads. The views run with the caller's rights (security_invoker), so the row
-- level security of the tables below them still applies.
-- ---------------------------------------------------------------------------------------------

create view public.crop_prices
with (security_invoker = true) as
select
  c.crop_id,
  c.scientific_name,
  c.name_en,
  a.iso3,
  a.name as country,
  p.year,
  p.usd_per_tonne,
  p.lcu_per_tonne,
  p.slc_per_tonne,
  p.price_index,
  p.usd_flag,
  p.lcu_flag,
  l.faostat_item_code,
  i.faostat_item,
  l.is_primary as is_primary_item,
  i.item_class,
  c.match,
  -- The atlas counts the crops of the item it attaches the crop to; for another item of the crop it gives no count.
  case when l.is_primary then c.item_shared_by_n_crops end as item_shared_by_n_crops,
  cc.level,
  cc.item_reported,
  p.area_code
from public.crop_items l
join public.crops c on c.crop_id = l.crop_id
join public.items i on i.faostat_item_code = l.faostat_item_code
join public.producer_prices p on p.faostat_item_code = l.faostat_item_code and p.month = 0
join public.areas a on a.area_code = p.area_code
left join public.crop_country cc on cc.crop_id = l.crop_id and cc.iso3 = a.iso3;
comment on view public.crop_prices is 'Annual producer prices per atlas crop, item and country. The price is that of the FAOSTAT item: it is the price of this crop alone only when match = exact and item_shared_by_n_crops = 1. level says how much of the crop the country grows (crop_country).';

create view public.crop_latest_prices
with (security_invoker = true) as
select distinct on (crop_id, faostat_item_code, area_code) *
from public.crop_prices
where usd_per_tonne is not null or lcu_per_tonne is not null
order by crop_id, faostat_item_code, area_code, year desc;
comment on view public.crop_latest_prices is 'Most recent annual producer price per atlas crop, item and country.';

create function public.crop_price_series(p_crop_id text, p_iso3 text)
returns table (
  year smallint,
  faostat_item_code integer,
  faostat_item text,
  is_primary_item boolean,
  usd_per_tonne numeric,
  lcu_per_tonne numeric,
  slc_per_tonne numeric,
  price_index numeric,
  usd_flag text,
  item_class text,
  match text,
  item_shared_by_n_crops integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.year, l.faostat_item_code, i.faostat_item, l.is_primary, p.usd_per_tonne, p.lcu_per_tonne, p.slc_per_tonne, p.price_index, p.usd_flag,
    i.item_class, c.match, case when l.is_primary then c.item_shared_by_n_crops end
  from public.crop_items l
  join public.crops c on c.crop_id = l.crop_id
  join public.items i on i.faostat_item_code = l.faostat_item_code
  join public.producer_prices p on p.faostat_item_code = l.faostat_item_code and p.month = 0
  join public.areas a on a.area_code = p.area_code
  where l.crop_id = p_crop_id and a.iso3 = p_iso3
  order by l.is_primary desc, l.faostat_item_code, p.year;
$$;
comment on function public.crop_price_series is 'Annual producer prices of one atlas crop in one country (ISO 3166-1 alpha-3), the crop''s own item first, oldest year first.';

-- ---------------------------------------------------------------------------------------------
-- Public reference data: anyone may read, nobody writes through the Data API. The loader uses the
-- service role. data_sources and areas keep the policies of 20261115000400.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['items', 'crops', 'crop_items', 'crop_country', 'producer_prices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('create policy "Public read" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end
$$;

revoke all on table public.crop_prices, public.crop_latest_prices from anon, authenticated;
grant select on table public.crop_prices, public.crop_latest_prices to anon, authenticated, service_role;

revoke all on function public.crop_price_series(text, text) from public;
grant execute on function public.crop_price_series(text, text) to anon, authenticated, service_role;
