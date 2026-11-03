// Server-side error diagnostics for the log only. Nothing from here is ever sent to the browser.
// Messages are redacted (connection strings, URLs, tokens, e-mail addresses, long secrets) and truncated.
const MAX_MESSAGE_LENGTH = 300
const MAX_CAUSE_DEPTH = 3
const MAX_STACK_FRAMES = 6

export function redact(text) {
  return String(text ?? '')
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/\b(?:bearer|basic)\s+\S+/gi, '[auth]')
    .replace(/\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_]+/g, '[key]')
    .replace(/\b(?:password|passwd|pwd|secret|token|key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH)
}

function describeOne(error) {
  if (error === null || typeof error !== 'object') return `${typeof error}: ${redact(error)}`

  const parts = [error.name ?? 'Error']

  for (const field of ['code', 'severity', 'type', 'errno', 'syscall']) {
    if (error[field] !== undefined && typeof error[field] !== 'object') parts.push(`${field}=${redact(error[field])}`)
  }

  if (error.message) parts.push(`message="${redact(error.message)}"`)

  return parts.join(' ')
}

// Only the first frames, with absolute paths reduced to project-relative ones.
function describeStack(error) {
  if (typeof error?.stack !== 'string') return ''

  const root = process.cwd()

  return error.stack
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => redact(line.replaceAll(root, '.')).replace(/^\s*at\s*/, '  at '))
    .join('\n')
}

/** One log line with cause chain; a short stack is added outside production. */
export function describeError(error, env = process.env) {
  const chain = []
  let current = error

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current !== undefined && current !== null; depth += 1) {
    chain.push(describeOne(current))
    current = current.cause ?? current.sourceError
  }

  const line = chain.join(' <- caused by: ')
  const stack = env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production' ? '' : describeStack(error)

  return stack ? `${line}\n${stack}` : line
}

export function logError(label, error) {
  console.error(`${label} failed: ${describeError(error)}`)
}
