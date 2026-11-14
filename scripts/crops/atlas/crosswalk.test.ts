import { describe, expect, it } from 'vitest';
import { buildCrosswalk, buildSpamCrosswalk, isNecName, spamCropFor, type CropItem, type SpeciesIn } from './crosswalk';
import { parseFaodefPage, parseCpc, parseM49, parseGeoNames, parseSpamReadme } from './definitions';
import { cleanSpecies, numberIn } from './ecocrop';
import { extractMentions, parseScientificName, synonymTaxa } from './taxa';

// The fixtures below are test inputs shaped like the sources, not data: nothing here reaches the atlas.
const item = (code: number, name: string, html: string, area: number, openList = false): CropItem => ({
  code,
  cpc: '',
  name,
  faodefName: '',
  definition: '',
  definitionSources: [],
  mentions: extractMentions(html),
  openList,
  worldAreaHa: area,
  worldProductionT: area,
  countries: 1,
});
const sp = (id: number, name: string, opts: { synonyms?: string; commonNames?: string[]; cultivated?: boolean } = {}): SpeciesIn => ({
  id,
  taxon: parseScientificName(name),
  synonyms: synonymTaxa(opts.synonyms ?? ''),
  commonNames: opts.commonNames ?? [],
  cultivated: opts.cultivated ?? true,
});

describe('buildCrosswalk', () => {
  const items = [
    item(27, 'Rice', '<i>Oryza spp.</i>, mainly <i>oryza sativa</i>', 100),
    item(656, 'Coffee, green', 'Coffea spp. (<i>arabica, robusta</i>)', 50),
    item(187, 'Peas, dry', '<i>Pisum sativum</i>', 30),
    item(417, 'Peas, green', '<i>Pisum sativum</i>', 10),
    item(372, 'Lettuce and chicory', '<i>Lactuca sativa; Cichorium intybus</i>', 20),
    item(603, 'Other tropical fruits, n.e.c.', 'Including inter alia: durian <i>(Durio zibethinus)</i>', 40, true),
    item(236, 'Soya beans', '<i>Glycine soja</i>', 90),
    item(242, 'Groundnuts, excluding shelled', '<i>Arachis hypogaea</i>', 60),
    item(430, 'Okra', '<i>Abelmoschus esculentus; Hibiscus esculentus</i>', 5),
  ];
  const species = [
    sp(1, 'Oryza sativa'),
    sp(2, 'Oryza glaberrima'),
    sp(3, 'Oryza rufipogon', { cultivated: false }),
    sp(4, 'Coffea arabica'),
    sp(5, 'Coffea canephora'),
    sp(6, 'Pisum sativum'),
    sp(7, 'Lactuca sativa'),
    sp(8, 'Cichorium intybus'),
    sp(9, 'Durio zibethinus'),
    sp(10, 'Glycine max', { commonNames: ['soja', 'soya bean'] }),
    sp(11, 'Arachis hypogaea', { commonNames: ['groundnut', 'peanut'] }),
    sp(12, 'Apios americana', { commonNames: ['groundnut', 'potato bean'] }),
    sp(13, 'Abelmoschus esculentus', { synonyms: 'Hibiscus esculentus L.' }),
    sp(14, 'Abelmoschus manihot', { commonNames: ['aibika'] }),
  ];
  const xw = buildCrosswalk(items, species);
  const m = (id: number) => xw.species.get(id)!;

  it('classes an item by the genera of the EcoCrop species its definition resolves to', () => {
    expect(xw.itemClass.get(27)!.class).toBe('single');
    expect(xw.itemClass.get(430)!).toMatchObject({ class: 'single', genera: ['abelmoschus'] });
    expect(xw.itemClass.get(372)!.class).toBe('group');
    expect(xw.itemClass.get(603)!.class).toBe('group');
    expect(isNecName('Other vegetables, fresh n.e.c.')).toBe(true);
    expect(isNecName('Cereals n.e.c.')).toBe(true);
    expect(isNecName('Rice')).toBe(false);
  });

  it('gives the item to the species the definition singles out; its congeners become members', () => {
    expect(m(1)).toMatchObject({ match: 'exact', method: 'species', items: [27] });
    expect(m(2)).toMatchObject({ match: 'group', method: 'genus', items: [27] });
  });

  it('shares a purely genus-level item among the species EcoCrop calls cultivated, and no others', () => {
    expect(m(4)).toMatchObject({ match: 'exact', method: 'genus', items: [656] });
    expect(m(5)).toMatchObject({ match: 'exact', method: 'genus', items: [656] });
    expect(m(3).match).toBe('none');
  });

  it('attaches all items of one species, the largest first', () => {
    expect(m(6)).toMatchObject({ match: 'exact', items: [187, 417], primary: 187 });
  });

  it('marks members of a multi-genus or residual item as group, with the FAO vernacular name', () => {
    expect(m(7)).toMatchObject({ match: 'group', items: [372] });
    expect(m(9)).toMatchObject({ match: 'group', method: 'species', items: [603], label: 'durian' });
  });

  it('matches by synonym', () => {
    expect(m(13)).toMatchObject({ match: 'exact', items: [430] });
    expect(m(14).match).toBe('none');
  });

  it('falls back to the common name only where the definition resolved to no EcoCrop species', () => {
    expect(m(10)).toMatchObject({ match: 'exact', method: 'name', items: [236], matchedName: 'soya bean' });
    expect(m(11)).toMatchObject({ match: 'exact', method: 'species' });
    // Same vernacular name as the peanut, different plant: not attached.
    expect(m(12).match).toBe('none');
  });
});

describe('SPAM crosswalk', () => {
  const crops = [
    { id: 1, code: 'mill', name: 'Small Millet' },
    { id: 2, code: 'pmil', name: 'Pearl Millet' },
    { id: 3, code: 'toma', name: 'Tomato' },
    { id: 4, code: 'citr', name: 'Citrus' },
    { id: 5, code: 'vege', name: 'Other Vegetables' },
    { id: 6, code: 'trof', name: 'Other Tropical Fruit' },
  ];
  const table = [
    { crop: 'mill', item: 79 },
    { crop: 'vege', item: 388 },
    { crop: 'vege', item: 358 },
    { crop: 'trof', item: 490 },
    { crop: 'trof', item: 571 },
  ];
  const names = new Map([
    [79, 'Millet'],
    [388, 'Tomatoes'],
    [358, 'Cabbages'],
    [490, 'Oranges'],
    [571, 'Mangoes, guavas and mangosteens'],
  ]);
  const out = buildSpamCrosswalk(crops, table, names, new Map([[490, 'Citrus fruits']]));
  const by = (code: string) => out.find((c) => c.code === code)!;

  it('takes the table where it has the crop and the crop name where it does not', () => {
    expect(by('mill')).toMatchObject({ items: [79], method: 'mapspamc', class: 'individual' });
    expect(by('pmil')).toMatchObject({ items: [79], method: 'name' });
    expect(by('toma')).toMatchObject({ items: [388], method: 'name', class: 'individual' });
    expect(by('citr')).toMatchObject({ items: [490], method: 'name' });
  });

  it('moves an item out of the residual class once it has a crop of its own', () => {
    expect(by('vege')).toMatchObject({ items: [358], class: 'residual' });
    expect(by('trof').items).toEqual([571]);
  });

  it('splits a shared item by the SPAM name found in the common names, else keeps the table crop', () => {
    const shared = [by('mill'), by('pmil')];
    expect(spamCropFor(shared, ['bajra', 'pearl millet'])?.code).toBe('pmil');
    expect(spamCropFor(shared, ['finger millet'])?.code).toBe('mill');
    expect(spamCropFor([], ['x'])).toBeNull();
    const coffee = [
      { id: 1, code: 'coff', name: 'Arabic Coffee', items: [656], method: 'mapspamc' as const, class: 'individual' as const },
      { id: 2, code: 'rcof', name: 'Robust Coffee', items: [656], method: 'name' as const, class: 'individual' as const },
    ];
    expect(spamCropFor(coffee, ['cafe', 'robusta coffee'])?.code).toBe('rcof');
    expect(spamCropFor(coffee, ['coffee'])?.code).toBe('coff');
  });
});

describe('source parsers', () => {
  it('reads an FAO definition row: code, name, taxa, open list', () => {
    const html =
      '<TR ALIGN=LEFT><TD>0430</TD><TD><B> OKRA</b>\n<i>Abelmoschus esculentus; Hibiscus\nesculentus</i></TD><TD>\nAlso called gombo.\n</TD></TR>' +
      '<TR ALIGN=LEFT><TD>0603</TD><TD><B>\nFRUIT, TROPICAL (FRESH) NES</b>\nIncluding inter alia:\ndurian <I>(Durio zibethinus);</I></TD><TD>Trade may include <i>(Zea mays)</i></TD></TR>' +
      '<TR><TD>Code</TD><TD>Commodity</TD></TR>';
    const rows = parseFaodefPage(html);
    expect(rows.map((r) => [r.code, r.name, r.openList, r.mentions.length])).toEqual([
      [430, 'OKRA', false, 2],
      [603, 'FRUIT, TROPICAL (FRESH) NES', true, 1],
    ]);
  });

  it('reads CPC notes up to "does not include"', () => {
    const csv = '"code","broader","label_en","note"\n"01312","0131","Bananas","This subclass includes: - bananas, <i>Musa sapientum</i> This subclass does not include: - plantains, <i>Musa paradisiaca</i>, cf. 01313"\n';
    const c = parseCpc(csv).get('01312')!;
    expect(c.parent).toBe('0131');
    expect(c.mentions.map((m) => m.species)).toEqual(['sapientum']);
  });

  it('reads the code lists', () => {
    expect(parseM49('<tr><td>001</td><td>World</td><td>Viet Nam</td><td>704</td><td>VN</td><td>VNM</td></tr>').get('704')).toEqual({ iso3: 'VNM', name: 'Viet Nam' });
    expect(parseGeoNames('#ISO\tISO3\nVN\tVNM\t704\tVM\tVietnam\tHanoi\n')[0]).toEqual({ iso3: 'VNM', numeric: '704', fips: 'VM', name: 'Vietnam' });
    expect(parseSpamReadme('ID   SPAM name\tCrop name\n1\twhea\tWheat\n33\trcof\tRobust Coffee\n')).toEqual([
      { id: 1, code: 'whea', name: 'Wheat' },
      { id: 33, code: 'rcof', name: 'Robust Coffee' },
    ]);
  });
});

describe('EcoCrop cleaning', () => {
  it('turns missing markers and implausible values into nothing, and never repairs', () => {
    expect(numberIn('-', 0, 14)).toBeNull();
    expect(numberIn('no input', -90, 60)).toBeNull();
    expect(numberIn('5.5', 0, 14)).toBe(5.5);
    const dropped: string[] = [];
    expect(numberIn('4000', -60, 60, (r) => dropped.push(r))).toBeNull();
    expect(numberIn('1,500', 1, 366, (r) => dropped.push(r))).toBeNull();
    expect(dropped).toEqual(['4000', '1,500']);
  });

  it('cleans a row: numbers, verbatim classes, notes, cultivated flag', () => {
    const s = cleanSpecies({
      ecocrop_id: '7',
      name: 'Testus plantus',
      family: 'Magnoliopsida:Rosidae:Fabales:Leguminosae',
      synonyms: '',
      common_names: 'alpha, beta',
      desc_plant_attributes: 'grown on small scale, harvested from wild',
      eco_temperat_requir_opt_min: '18',
      eco_temperat_requir_opt_max: '30',
      eco_temperat_requir_abs_min: '10',
      eco_temperat_requir_abs_max: '4000',
      eco_soil_ph_opt_min: '5.5',
      eco_soil_ph_opt_max: '7',
      eco_soil_ph_abs_min: '4.5',
      eco_soil_ph_abs_max: '---',
      eco_latitude_abs_min: '36',
      eco_latitude_abs_max: '2200',
      eco_soil_depth_opt: 'medium (50-150 cm)',
      cult_cycle_min: '0',
      cult_cycle_max: '120',
      clim_killing_temp_during_rest: 'no input',
    });
    expect(s.temp).toEqual([18, 30, 10, null]);
    expect(s.ph).toEqual([5.5, 7, 4.5, null]);
    expect(s.latitude).toEqual([null, null, 36, null]);
    expect(s.soil.depth).toEqual(['medium (50-150 cm)', '']);
    expect([s.cycleMin, s.cycleMax, s.killingTempRest]).toEqual([null, 120, null]);
    expect(s.family).toBe('Leguminosae');
    expect(s.cultivated).toBe(true);
    expect(s.cleaning).toEqual(['temperature abs max "4000" dropped (outside -60..60)', 'latitude abs max "2200" dropped (outside 0..90)']);
  });
});
