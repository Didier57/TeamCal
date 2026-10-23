export const EUROPEAN_COUNTRY_CODES = [
  'AL',
  'AD',
  'AT',
  'BY',
  'BE',
  'BA',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IS',
  'IE',
  'IT',
  'XK',
  'LV',
  'LI',
  'LT',
  'LU',
  'MT',
  'MD',
  'MC',
  'ME',
  'NL',
  'MK',
  'NO',
  'PL',
  'PT',
  'RO',
  'RU',
  'SM',
  'RS',
  'SK',
  'SI',
  'ES',
  'SE',
  'CH',
  'TR',
  'UA',
  'GB',
  'VA'
];

const fallbackNames: Record<string, string> = {
  LU: 'Luxembourg',
  FR: 'France',
  BE: 'Belgique',
  DE: 'Allemagne',
  CH: 'Suisse',
  GB: 'Royaume-Uni',
  NL: 'Pays-Bas'
};

export function countryLabel(code: string, locale: string): string {
  try {
    const display = new Intl.DisplayNames([locale], { type: 'region' });
    return display.of(code) ?? fallbackNames[code] ?? code;
  } catch {
    return fallbackNames[code] ?? code;
  }
}
