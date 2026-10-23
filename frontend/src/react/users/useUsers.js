import { useCallback, useEffect, useRef, useState } from 'react'
import { loadUsers, createUser, updateUser, resetUserPassword } from '../../services/admin-users-service.js'
import { clearSession } from '../../services/account-session.js'
import { documentNavigation } from '../../services/document-navigation.js'

function endSession(owner) {
  owner.stop()
  clearSession()
  documentNavigation.replace('/')
}

export function useUsers(currentUserId) {
  const [list, setList] = useState({ users: [], serverTime: null, lastLoaded: null, unconfirmed: false, loading: true, error: '' })
  const lifetime = useRef(null)
  const refresh = useCallback(async () => {
    const owner = lifetime.current
    if (!owner?.active || owner.read || owner.write) return
    const controller = new AbortController()
    owner.read = controller
    setList(previous => ({ ...previous, loading: true }))
    try {
      const response = await loadUsers({ signal: controller.signal })
      if (controller.signal.aborted || !owner.active) return
      setList({ users: response.users, serverTime: response.serverTime, lastLoaded: response.serverTime, unconfirmed: false, loading: false, error: '' })
    } catch (error) {
      if (controller.signal.aborted || !owner.active) return
      if ([401, 403].includes(error.status)) { endSession(owner); return }
      setList(previous => ({ ...previous, loading: false, unconfirmed: true, error: `Status pengguna belum dapat diperbarui. ${error.message}` }))
    } finally {
      if (owner.read === controller) owner.read = null
    }
  }, [])

  useEffect(() => {
    const owner = { active: true, read: null, write: null }
    lifetime.current = owner
    void refresh()
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    const timer = window.setInterval(visible, 15_000)
    const stop = () => {
      owner.active = false
      owner.read?.abort()
      owner.write?.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
    owner.stop = stop
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('pagehide', stop)
    return () => { stop(); window.removeEventListener('pagehide', stop) }
  }, [refresh])

  const save = useCallback(async (selected, mode, payload) => {
    const owner = lifetime.current
    if (!owner?.active || owner.write) return null
    owner.read?.abort()
    owner.read = null
    const controller = new AbortController()
    owner.write = controller
    try {
      const options = { signal: controller.signal }
      const result = mode === 'password' ? await resetUserPassword(selected.id, payload, options)
        : selected ? await updateUser(selected.id, payload, options) : await createUser(payload, options)
      if (controller.signal.aborted || !owner.active) return null
      if (result.sessionsRevoked && result.user.id === currentUserId) {
        endSession(owner); return null
      }
      return result
    } catch (error) {
      if (controller.signal.aborted || !owner.active) return null
      if ([401, 403].includes(error.status)) { endSession(owner); return null }
      throw error
    } finally {
      if (owner.write === controller) owner.write = null
      if (owner.active && !controller.signal.aborted) void refresh()
    }
  }, [currentUserId, refresh])

  return { ...list, refresh, save }
}
