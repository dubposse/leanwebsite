// Server-side source of truth for prices. Never trust amounts sent by the client.
// Amounts are final prices in integer cents, charged unchanged; no tax is calculated or shown separately.
export const CURRENCY = 'EUR'

export const packages = Object.freeze({
  'artist-band-code-and-go': {
    code: 'artist-band-code-and-go',
    builderSlug: 'artist-band',
    name: 'Code & Go',
    amountCents: 3900,
  },
  'artist-band-rundum-sorglos': {
    code: 'artist-band-rundum-sorglos',
    builderSlug: 'artist-band',
    name: 'Rundum sorglos',
    amountCents: 7900,
  },
  'business-pure-code': {
    code: 'business-pure-code',
    builderSlug: 'business',
    name: 'Pure Code',
    amountCents: 29900,
  },
  'business-rundum-sorglos': {
    code: 'business-rundum-sorglos',
    builderSlug: 'business',
    name: 'Rundum sorglos',
    amountCents: 47900,
  },
})

export function getPackage(code) {
  return Object.hasOwn(packages, code) ? packages[code] : null
}

export function getPackagesForBuilder(builderSlug) {
  return Object.values(packages).filter((item) => item.builderSlug === builderSlug)
}
