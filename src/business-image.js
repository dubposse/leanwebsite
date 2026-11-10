const IMAGE_DATA_URL = /^data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const LOGO_DATA_URL = /^data:image\/(?:jpeg|webp|png);base64,[A-Za-z0-9+/]+={0,2}$/

export function imageByteLength(value, { logo = false } = {}) {
  if (typeof value !== 'string' || !(logo ? LOGO_DATA_URL : IMAGE_DATA_URL).test(value)) return null
  const payload = value.slice(value.indexOf(',') + 1)
  if (payload.length % 4 !== 0) return null
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  const last = payload.charCodeAt(payload.length - padding - 1)
  const lastValue = last >= 65 && last <= 90 ? last - 65
    : last >= 97 && last <= 122 ? last - 71
      : last >= 48 && last <= 57 ? last + 4
        : last === 43 ? 62
          : last === 47 ? 63
            : -1
  if (lastValue < 0 || (padding === 2 && lastValue % 16 !== 0) || (padding === 1 && lastValue % 4 !== 0)) return null
  return Math.floor(payload.length * 3 / 4) - padding
}

export function isImageDataUrl(value, options) {
  return value === '' || imageByteLength(value, options) !== null
}

export function encodeBusinessLogo(canvas, image, { maxImageBytes, fitsDraft }) {
  const check = (value) => {
    const bytes = imageByteLength(value, { logo: true })
    if (bytes === null) throw new Error('Das Logo konnte nicht als Bild gespeichert werden. Bitte wähle ein anderes Bild.')
    if (bytes > maxImageBytes) return 'image'
    if (!fitsDraft(value)) return 'request'
    return ''
  }
  let issue = 'image'
  let png
  let webpUnsupported = false
  for (const quality of [0.9, 0.82, 0.72, 0.62]) {
    let value
    try {
      value = canvas.toDataURL('image/webp', quality)
    } catch {
      webpUnsupported = true
      break
    }
    if (!value.startsWith('data:image/webp;base64,') || imageByteLength(value, { logo: true }) === null) {
      if (value.startsWith('data:image/png;base64,') && imageByteLength(value, { logo: true }) !== null) png = value
      webpUnsupported = true
      break
    }
    issue = check(value)
    if (!issue) return value
  }
  if (!webpUnsupported) {
    throw new Error(issue === 'request'
      ? 'Das Bild passt auch nach zusätzlicher Komprimierung nicht in das Draft-Limit von 4 MiB. Entferne oder verkleinere zuerst andere Bilder.'
      : 'Das Bild ist auch nach zusätzlicher Komprimierung größer als 1,5 MiB. Bitte wähle ein kleineres Bild.')
  }
  if (!png) {
    try {
      png = canvas.toDataURL('image/png')
    } catch {
      throw new Error('Das Logo konnte nicht als PNG gespeichert werden. Bitte wähle ein anderes Bild.')
    }
  }
  const initialWidth = canvas.width
  const initialHeight = canvas.height
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!png.startsWith('data:image/png;base64,')) {
      throw new Error('Das Logo konnte nicht als PNG gespeichert werden. Bitte wähle ein anderes Bild.')
    }
    issue = check(png)
    if (!issue) return png
    if (attempt === 7) break
    const scale = 0.7 ** (attempt + 1)
    const width = Math.max(1, Math.round(initialWidth * scale))
    const height = Math.max(1, Math.round(initialHeight * scale))
    if (width === canvas.width && height === canvas.height) break
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Die Bildverarbeitung ist in diesem Browser nicht verfügbar.')
    context.drawImage(image, 0, 0, width, height)
    try {
      png = canvas.toDataURL('image/png')
    } catch {
      throw new Error('Das Logo konnte nicht als PNG gespeichert werden. Bitte wähle ein anderes Bild.')
    }
  }
  throw new Error(issue === 'request'
    ? 'Das Logo passt auch nach dem Verkleinern nicht in das Draft-Limit von 4 MiB. Entferne oder verkleinere zuerst andere Bilder.'
    : 'Das Logo ist auch nach dem Verkleinern größer als 1,5 MiB. Bitte wähle ein kleineres Bild.')
}
