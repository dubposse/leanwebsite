const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/

export function isCopyableArtistBandLink(value, kind = 'url') {
  if (typeof value !== 'string' || !value || value !== value.trim()) return false
  if (kind === 'email') return EMAIL_PATTERN.test(value)

  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

export async function copyArtistBandLink(value, kind, clipboard) {
  if (!isCopyableArtistBandLink(value, kind)) {
    return { success: false, message: 'Bitte gib eine gültige Zieladresse ein.' }
  }
  if (!clipboard?.writeText) {
    return { success: false, message: 'Kopieren nicht verfügbar. Markiere die Adresse und kopiere sie manuell.' }
  }

  try {
    await clipboard.writeText(value)
    return {
      success: true,
      message: kind === 'email'
        ? 'Booking-E-Mail kopiert.'
        : 'Link kopiert. Öffne die Adresse in einem neuen Browser-Tab, um sie zu prüfen.',
    }
  } catch {
    return { success: false, message: 'Kopieren nicht möglich. Markiere die Adresse und kopiere sie manuell.' }
  }
}
