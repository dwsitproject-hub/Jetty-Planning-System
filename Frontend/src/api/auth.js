import { apiPost, setSelectedPortId } from './client.js'

export async function login(username, password) {
  const data = await apiPost('/auth/login', { username, password })
  if (data?.token) {
    localStorage.setItem('jps_token', data.token)
  }
  return data
}

export function logout() {
  localStorage.removeItem('jps_token')
  setSelectedPortId(null)
}

export function getToken() {
  return localStorage.getItem('jps_token')
}

export function isLoggedIn() {
  return Boolean(getToken())
}
