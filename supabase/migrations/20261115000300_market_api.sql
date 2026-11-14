-- What the app reads. The views run with the caller's rights (security_invoker), so the row
-- level security of the tables below them still applies.

create view public.crop_prices
with (security_invoker = true) as
select
  m.crop_id,
  c.name as crop_name,
  p.area_code,
  a.name as area_name,
  p.year,
  p.usd_per_tonne,
  p.lcu_per_tonne,
  p.slc_per_tonne,
  p.price_index,
  p.usd_flag,
  p.lcu_flag,
  m.item_code,
  i.name as item_name,
  i.is_residual as item_is_residual,
  n.crops as item_crop_count,
  (cc.crop_id is not null) as is_producer
from public.crop_faostat_items m
join public.crops c on c.id = m.crop_id
join public.faostat_items i on i.item_code = m.item_code
join (select item_code, count(*)::integer as crops from public.crop_faostat_items group by item_code) n on n.item_code = m.item_code
join public.producer_prices p on p.item_code = m.item_code and p.month = 0
join public.areas a on a.area_code = p.area_code
left join public.crop_countries cc on cc.crop_id = m.crop_id and cc.area_code = p.area_code;
comment on view public.crop_prices is 'Annual producer prices per atlas crop and country. The price is that of the FAOSTAT item: when item_is_residual is true or item_crop_count is above 1, several crops share it and it is not the price of this crop alone.';

create view public.crop_latest_prices
with (security_invoker = true) as
select distinct on (crop_id, area_code) *
from public.crop_prices
where usd_per_tonne is not null or lcu_per_tonne is not null
order by crop_id, area_code, year desc;
comment on view public.crop_latest_prices is 'Most recent annual producer price per atlas crop and country.';

create function public.crop_price_series(p_crop_id text, p_area_code integer)
returns table (
  year smallint,
  usd_per_tonne numeric,
  lcu_per_tonne numeric,
  slc_per_tonne numeric,
  price_index numeric,
  usd_flag text,
  item_name text,
  item_is_residual boolean,
  item_crop_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.year, p.usd_per_tonne, p.lcu_per_tonne, p.slc_per_tonne, p.price_index, p.usd_flag, i.name, i.is_residual,
    (select count(*)::integer from public.crop_faostat_items s where s.item_code = m.item_code)
  from public.crop_faostat_items m
  join public.faostat_items i on i.item_code = m.item_code
  join public.producer_prices p on p.item_code = m.item_code and p.month = 0
  where m.crop_id = p_crop_id and p.area_code = p_area_code
  order by p.year;
$$;
comment on function public.crop_price_series is 'Annual producer prices of one atlas crop in one country, oldest first.';
