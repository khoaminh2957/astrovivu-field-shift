-- FAOSTAT producer prices: what farmers received at the farm gate. One row per area, item, year
-- and month; month 0 is the annual value. The four measures of FAOSTAT sit side by side.

create table public.producer_prices (
  area_code integer not null references public.areas (area_code),
  item_code integer not null references public.faostat_items (item_code),
  year smallint not null check (year between 1960 and 2100),
  month smallint not null default 0 check (month between 0 and 12),
  -- Local currency in use that year / current local currency / US dollars, per tonne.
  lcu_per_tonne numeric check (lcu_per_tonne >= 0),
  slc_per_tonne numeric check (slc_per_tonne >= 0),
  usd_per_tonne numeric check (usd_per_tonne >= 0),
  -- Producer price index, 2014-2016 = 100.
  price_index numeric check (price_index >= 0),
  -- FAOSTAT flags: A official, E estimated, I imputed, X external, B series break.
  lcu_flag text,
  slc_flag text,
  usd_flag text,
  index_flag text,
  primary key (area_code, item_code, year, month),
  check (num_nonnulls(lcu_per_tonne, slc_per_tonne, usd_per_tonne, price_index) > 0)
);
comment on table public.producer_prices is 'FAOSTAT Producer Prices (domain PP). month = 0 is the annual value.';

-- The primary key serves "one country, all items"; this one serves "one item, all countries".
create index producer_prices_item_year_idx on public.producer_prices (item_code, year desc, area_code) where month = 0;
