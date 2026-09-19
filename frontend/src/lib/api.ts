export interface HealthResponse {
  status: 'ok'
  service: string
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/v1/health', { signal })
  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`)
  }
  const data: unknown = await response.json()
  if (
    typeof data !== 'object' || data === null ||
    !('status' in data) || data.status !== 'ok' ||
    !('service' in data) || typeof data.service !== 'string'
  ) {
    throw new Error('Unexpected health response from the API')
  }
  return { status: data.status, service: data.service }
}
