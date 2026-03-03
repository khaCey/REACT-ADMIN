import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import Sidebar from './Sidebar'
import FeatureListModal from './FeatureListModal'

export default function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [featureModalMode, setFeatureModalMode] = useState(null)

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
          <div className="flex-1 min-h-0 flex flex-col">
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
    </>
  )
}
