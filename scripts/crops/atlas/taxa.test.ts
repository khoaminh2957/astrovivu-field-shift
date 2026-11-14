import { describe, expect, it } from 'vitest';
import { bestMatch, commodityTerms, commonNameMatches, extractMentions, matchMention, parseScientificName, singular, synonymTaxa, taxonKey } from './taxa';

const keys = (html: string, known?: string[]) => extractMentions(html, known ? new Set(known) : undefined).map(taxonKey);

describe('parseScientificName', () => {
  it('reads binomials, infraspecific ranks, hybrids and genus-only names', () => {
    expect(parseScientificName('Coffea canephora')).toEqual({ genus: 'coffea', species: 'canephora' });
    expect(parseScientificName('Vigna unguiculata ssp. sesquipedalis')).toEqual({ genus: 'vigna', species: 'unguiculata', infra: 'sesquipedalis' });
    expect(parseScientificName('Brassica oleracea var. botrytis')).toEqual({ genus: 'brassica', species: 'oleracea', infra: 'botrytis' });
    expect(parseScientificName('Fragaria x ananassa')).toEqual({ genus: 'fragaria', species: 'ananassa' });
    expect(parseScientificName('Citrus sp.')).toEqual({ genus: 'citrus' });
    expect(parseScientificName('')).toBeNull();
  });

  it('reads EcoCrop synonym lists and skips authority fragments', () => {
    const syn = synonymTaxa('Triticum cereale Schrank, Baier. Fl. 1: 387 (1789), Triticum hybernum L., Sp. Pl. 86 (1753)');
    expect(syn.map(taxonKey)).toEqual(['triticum cereale', 'triticum hybernum']);
    expect(synonymTaxa('Citrus aurantium L. var. sinensis L. (1753).')[0]).toEqual({ genus: 'citrus', species: 'aurantium', infra: 'sinensis' });
  });
});

describe('extractMentions', () => {
  it('expands abbreviations with the genus named before them', () => {
    const html = '<i>Triticum spp.:</i><br>common <i>(T. aestivum)</i><br>durum <i>(T. durum)</i>';
    expect(keys(html)).toEqual(['triticum *', 'triticum aestivum', 'triticum durum']);
  });

  it('keeps varieties and reads several genera in one run', () => {
    expect(keys('<i>Lactuca sativa;</i> witloof chicory <i>(Cichorium intybus var. foliosum);</i> endive <i>(C. endivia var. crispa)</i>')).toEqual([
      'lactuca sativa',
      'cichorium intybus foliosum',
      'cichorium endivia crispa',
    ]);
  });

  it('does not take English phrases for plants, in or out of italics', () => {
    expect(keys('<I>Zea mays</i> Corn, Indian corn, mealies')).toEqual(['zea mays']);
    expect(keys('<I>Zea mays</i> Corn, Indian corn, mealies', ['zea'])).toEqual(['zea mays']);
  });

  it('reads `Genus spp.` from plain text and bare genera from italics, not families', () => {
    expect(keys('Coffea spp. (<i>arabica, robusta, liberica</i>)')).toEqual(['coffea *']);
    expect(keys('fruit of various species of <i>Sapindaceae</i>, soursop and other species of <i>Annona</i>')).toEqual(['annona *']);
    expect(keys('Phaseolus and Vigna spp.')).toEqual(['phaseolus *', 'vigna *']);
  });

  it('reads names the page left outside italics only for genera EcoCrop knows', () => {
    const html = 'two-row barley <i>(H. disticum)</i> six-row barley </i>(H. hexasticum)</i> <B>X</B> Hordeum spp.';
    expect(keys('Anacardium occidentale')).toEqual([]);
    expect(keys('Anacardium occidentale', ['anacardium'])).toEqual(['anacardium occidentale']);
    expect(keys(`Hordeum spp. ${html}`, ['hordeum'])).toContain('hordeum hexasticum');
  });

  it('keeps the vernacular name printed in front of a bracketed scientific name', () => {
    const m = extractMentions('Including inter alia: breadfruit <I>(Artocarpus incisa);</I> durian <I>(Durio zibethinus);</I>');
    expect(m.map((x) => [taxonKey(x), x.label])).toEqual([
      ['artocarpus incisa', 'breadfruit'],
      ['durio zibethinus', 'durian'],
    ]);
  });
});

describe('matchMention', () => {
  const species = (name: string, synonyms = '') => ({ name: parseScientificName(name)!, synonyms: synonymTaxa(synonyms) });

  it('ranks variety > species = synonym > species-variety > genus', () => {
    expect(matchMention({ genus: 'brassica', species: 'oleracea', infra: 'botrytis' }, species('Brassica oleracea var. botrytis'))).toBe('variety');
    expect(matchMention({ genus: 'zea', species: 'mays' }, species('Zea mays ssp. mays'))).toBe('species');
    expect(matchMention({ genus: 'hibiscus', species: 'esculentus' }, species('Abelmoschus esculentus', 'Hibiscus esculentus L.'))).toBe('synonym');
    expect(matchMention({ genus: 'beta', species: 'vulgaris', infra: 'altissima' }, species('Beta vulgaris'))).toBe('species-variety');
    expect(matchMention({ genus: 'coffea' }, species('Coffea canephora'))).toBe('genus');
  });

  it('does not join two different varieties of one species, nor different species of one genus', () => {
    expect(matchMention({ genus: 'brassica', species: 'oleracea', infra: 'botrytis' }, species('Brassica oleracea var. capitata'))).toBeNull();
    expect(matchMention({ genus: 'beta', species: 'vulgaris', infra: 'altissima' }, species('Beta vulgaris var. cicla'))).toBeNull();
    expect(matchMention({ genus: 'abelmoschus', species: 'esculentus' }, species('Abelmoschus manihot'))).toBeNull();
  });

  it('treats a synonym given as a variety as that variety only', () => {
    const sweetOrange = species('Citrus sinensis', 'Citrus aurantium L. var. sinensis L.');
    expect(matchMention({ genus: 'citrus', species: 'aurantium' }, sweetOrange)).toBeNull();
    expect(matchMention({ genus: 'citrus', species: 'aurantium', infra: 'sinensis' }, sweetOrange)).toBe('synonym');
  });

  it('bestMatch returns the strongest relation and the mention behind it', () => {
    const mentions = extractMentions('<i>Oryza spp.</i>, mainly <i>oryza sativa</i>');
    expect(bestMatch(mentions, species('Oryza sativa'))?.kind).toBe('species');
    expect(bestMatch(mentions, species('Oryza glaberrima'))?.kind).toBe('genus');
    expect(bestMatch(mentions, species('Zea mays'))).toBeNull();
  });
});

describe('common-name fallback', () => {
  it('splits an item name into singular commodity terms without its qualifiers', () => {
    expect(commodityTerms('Mangoes, guavas and mangosteens')).toEqual(['mango', 'guava', 'mangosteen']);
    expect(commodityTerms('Chick peas, dry')).toEqual(['chick pea']);
    expect(commodityTerms('Onions and shallots, dry (excluding dehydrated)')).toEqual(['onion', 'shallot']);
    expect(commodityTerms('Other vegetables, fresh n.e.c.')).toEqual(['other vegetable']);
    expect(singular('berries')).toBe('berry');
    expect(singular('tomatoes')).toBe('tomato');
    expect(singular('citrus')).toBe('citrus');
  });

  it('matches whole names only, ignoring spaces and plurals', () => {
    expect(commonNameMatches(['soja', 'soya bean', 'soybean'], commodityTerms('Soya beans'))).toBe('soya bean');
    expect(commonNameMatches(['chickpea', 'garbanzo'], commodityTerms('Chick peas, dry'))).toBe('chickpea');
    expect(commonNameMatches(['wild rice'], commodityTerms('Rice'))).toBeNull();
    expect(commonNameMatches(['air potato'], commodityTerms('Potatoes'))).toBeNull();
  });
});
