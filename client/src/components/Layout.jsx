import { useState, useEffect, useCallback } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { NOTIFICATIONS_WIP_DISABLED } from '../guides/wipFlags'
import Navbar from './Navbar'
import Sidebar from './Sidebar'
import FeatureListModal from './FeatureListModal'
import PostLoginUnreadModal from './PostLoginUnreadModal'

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { staff } = useAuth()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [featureModalMode, setFeatureModalMode] = useState(null)
  const [showPostLoginUnread, setShowPostLoginUnread] = useState(false)
  const isStudentsListPage = location.pathname === '/students'

  useEffect(() => {
    if (!location.state?.openPostLoginUnread) return
    setShowPostLoginUnread(true)
    const nextState = location.state ? { ...location.state } : {}
    delete nextState.openPostLoginUnread
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      {
        replace: true,
        state: Object.keys(nextState).length > 0 ? nextState : undefined,
      },
    )
  }, [
    location.state?.openPostLoginUnread,
    location.pathname,
    location.search,
    location.hash,
    navigate,
    location.state,
  ])

  const closePostLoginUnread = useCallback(() => {
    setShowPostLoginUnread(false)
  }, [])

  return (
    <>
      <Navbar
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
        onOpenUnpaid={() => setFeatureModalMode('unpaid')}
        onOpenUnscheduled={() => setFeatureModalMode('unscheduled')}
      />
      <Sidebar collapsed={sidebarCollapsed} />
      <main
        id="mainContent"
        className={`bg-gray-100 transition-all duration-300 sidebar-content flex flex-col ${
          sidebarCollapsed ? 'ml-0 w-full' : 'ml-64 w-[calc(100%-16rem)]'
        }`}
      >
        <div className="p-6 w-full flex flex-col h-full min-h-0">
          <div className={`flex-1 min-h-0 flex flex-col ${isStudentsListPage ? 'overflow-hidden' : 'overflow-y-auto'}`}>
            <Outlet />
          </div>
        </div>
      </main>
      {featureModalMode && (
        <FeatureListModal
          mode={featureModalMode}
          onClose={() => setFeatureModalMode(null)}
        />
      )}
      {showPostLoginUnread && staff && !NOTIFICATIONS_WIP_DISABLED && (
        <PostLoginUnreadModal open onClose={closePostLoginUnread} />
      )}
    </>
  )
}
