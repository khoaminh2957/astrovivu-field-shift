-- Reference tables for the market data: FAOSTAT areas and items, the crop atlas, and the link
-- between the two. Read by the app through the Data API; written only by scripts/market/load.ts
-- with the service role. See docs/DATABASE.md.

create table public.data_sources (
  code text primary key,
  name text not null,
  publisher text not null,
  url text not null,
  -- Date the publisher gives for the release that was loaded (not the day it was loaded).
  released_on date,
  loaded_at timestamptz not null default now(),
  row_count integer check (row_count >= 0),
  notes text
);
comment on table public.data_sources is 'Provenance of every dataset loaded into this database: publisher, release and load time.';

create table public.areas (
  area_code integer primary key,
  m49_code text not null,
  name text not null unique
);
comment on table public.areas is 'Countries and territories as coded by FAOSTAT (area codes below 5000; regional aggregates are not loaded).';
comment on column public.areas.m49_code is 'UN M49 code as text: leading zeros are significant.';

create table public.faostat_items (
  item_code integer primary key,
  cpc_code text,
  name text not null,
  -- Residual classes ("n.e.c.", "Other ...") pool many species: their price is not a crop price.
  is_residual boolean not null default false
);
comment on table public.faostat_items is 'FAOSTAT commodity items; the same item code is used by the production and the price domains.';

create table public.crops (
  -- Slug of the scientific name: the id the app already uses for the EcoCrop catalogue.
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  scientific_name text not null unique,
  plant_attributes text[] not null default '{}',
  soil_depth_opt text check (soil_depth_opt in ('very-shallow', 'shallow', 'medium', 'deep')),
  soil_depth_abs text check (soil_depth_abs in ('very-shallow', 'shallow', 'medium', 'deep')),
  temp_opt_min numeric check (temp_opt_min between -30 and 60),
  temp_opt_max numeric check (temp_opt_max between -30 and 60),
  temp_abs_min numeric check (temp_abs_min between -30 and 60),
  temp_abs_max numeric check (temp_abs_max between -30 and 60),
  soil_texture_opt text[] not null default '{}',
  soil_texture_abs text[] not null default '{}',
  rain_opt_min numeric check (rain_opt_min between 0 and 12000),
  rain_opt_max numeric check (rain_opt_max between 0 and 12000),
  rain_abs_min numeric check (rain_abs_min between 0 and 12000),
  rain_abs_max numeric check (rain_abs_max between 0 and 12000),
  soil_fertility_opt text check (soil_fertility_opt in ('low', 'moderate', 'high')),
  soil_fertility_abs text check (soil_fertility_abs in ('low', 'moderate', 'high')),
  -- Absolute latitude (degrees from the equator), as published by EcoCrop.
  lat_opt_min numeric check (lat_opt_min between 0 and 90),
  lat_opt_max numeric check (lat_opt_max between 0 and 90),
  lat_abs_min numeric check (lat_abs_min between 0 and 90),
  lat_abs_max numeric check (lat_abs_max between 0 and 90),
  altitude_abs_max numeric check (altitude_abs_max between 0 and 6000),
  soil_salinity_opt text check (soil_salinity_opt in ('low', 'medium', 'high')),
  soil_salinity_abs text check (soil_salinity_abs in ('low', 'medium', 'high')),
  ph_opt_min numeric check (ph_opt_min between 0 and 14),
  ph_opt_max numeric check (ph_opt_max between 0 and 14),
  ph_abs_min numeric check (ph_abs_min between 0 and 14),
  ph_abs_max numeric check (ph_abs_max between 0 and 14),
  soil_drainage_opt text[] not null default '{}',
  soil_drainage_abs text[] not null default '{}',
  light_opt_min text,
  light_opt_max text,
  light_abs_min text,
  light_abs_max text,
  -- Köppen-Trewartha codes: Ar, Aw, Bs, Bw, Cf, Cs, Cw, Dc, Df, Do, Dw, E.
  climate_zones text[] not null default '{}',
  cycle_min_days integer check (cycle_min_days between 1 and 366),
  cycle_max_days integer check (cycle_max_days between 1 and 366),
  -- What the loader changed or could not trust in the source row. Empty for a clean row.
  quality_notes text[] not null default '{}'
);
comment on table public.crops is 'Crop atlas: ecological requirements per crop (FAO EcoCrop values selected by the team).';
comment on column public.crops.quality_notes is 'Corrections and doubts recorded by the loader, e.g. swapped columns in the source.';

create table public.crop_faostat_items (
  crop_id text primary key references public.crops (id) on delete cascade,
  item_code integer not null references public.faostat_items (item_code),
  -- How the link was established; "producing-countries" = the atlas country list equals the item's.
  match_method text not null,
  tie_note text
);
comment on table public.crop_faostat_items is 'One FAOSTAT item per atlas crop. Several crops may share an item.';
create index crop_faostat_items_item_code_idx on public.crop_faostat_items (item_code);

create table public.crop_countries (
  crop_id text not null references public.crops (id) on delete cascade,
  area_code integer not null references public.areas (area_code),
  primary key (crop_id, area_code)
);
comment on table public.crop_countries is 'Countries the atlas lists as producers of the crop (FAOSTAT production above zero, 2019-2024).';
create index crop_countries_area_code_idx on public.crop_countries (area_code);
