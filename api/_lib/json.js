export function sendJson(response, statusCode, payload) {
  return response.status(statusCode).json(payload)
}
