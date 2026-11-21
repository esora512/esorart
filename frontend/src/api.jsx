import useSWR from 'swr'
import Markdown from 'react-markdown'

export const API = import.meta.env.VITE_API_URL
export const GOOGLE = import.meta.env.VITE_GOOGLE_CLIENT_ID
export const TITLE = import.meta.env.VITE_TITLE || 'Art feed'

export const token = {
  get: () => { try { return localStorage.getItem('token') } catch { return null } },
  set: (t) => { try { localStorage.setItem('token', t) } catch { /* private mode */ } },
}

export async function api(path, method = 'GET', body) {
  const form = body instanceof FormData
  const r = await fetch(API + path, {
    method,
    body: form ? body : body && JSON.stringify(body),
    headers: { Authorization: `Bearer ${token.get()}`, ...(body && !form && { 'Content-Type': 'application/json' }) },
  })
  if (!r.ok) {
    const e = new Error((await r.json().catch(() => ({}))).detail || r.statusText)
    e.status = r.status
    throw e
  }
  return r.json()
}

export const useApi = (path) => useSWR(path, api, { shouldRetryOnError: false })
export const img = (path) => API + path

// Markdown for descriptions; links open in a new tab. Raw HTML is not rendered.
export const Md = ({ children }) => (
  <div className="md">
    <Markdown components={{ a: (p) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}>{children}</Markdown>
  </div>
)
