import { Link, useLocation } from 'react-router-dom'
import { Users, UserCheck, History, Bell, Shield, LayoutDashboard, BookOpen } from 'lucide-react'
import { NOTIFICATIONS_WIP_DISABLED } from '../guides/wipFlags'
import { useAuth } from '../context/AuthContext'

export default function Sidebar({ collapsed }) {
  const location = useLocation()
  const { staff } = useAuth()
  const path = location.pathname
  const isAdmin = !!staff?.is_admin || String(staff?.name || '').trim().toLowerCase() === 'khacey'
  const isOperator = !!staff?.is_operator
  const canAccessStaff = isAdmin || isOperator

  return (
    <aside
      id="sidebar"
      className={`fixed top-16 left-0 h-screen w-64 bg-gray-50 border-r border-gray-200 transition-transform duration-300 z-40 ${
        collapsed ? '-translate-x-full' : 'translate-x-0'
      }`}
    >
      <div className="p-4">
        <ul className="space-y-1">
          <li>
            <Link
              to="/dashboard"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                path === '/dashboard'
                  ? 'bg-green-600 text-white'
                  : 'text-gray-700 hover:bg-green-100 hover:text-green-700'
              }`}
            >
              <LayoutDashboard className="w-5 h-5" />
              <span>Dashboard</span>
            </Link>
          </li>
          <li>
            <Link
              to="/students"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                path === '/students' || path.match(/^\/students\/\d+$/)
                  ? 'bg-green-600 text-white'
                  : 'text-gray-700 hover:bg-green-100 hover:text-green-700'
              }`}
            >
              <Users className="w-5 h-5" />
              <span>Students</span>
            </Link>
          </li>
          {canAccessStaff && (
          <li>
            <Link
              to="/staff"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                path === '/staff'
                  ? 'bg-green-600 text-white'
                  : 'text-gray-700 hover:bg-green-100 hover:text-green-700'
              }`}
            >
              <UserCheck className="w-5 h-5" />
              <span>Staff</span>
            </Link>
          </li>
          )}
          {!NOTIFICATIONS_WIP_DISABLED && (
          <li>
            <Link
              to="/notifications"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                path === '/notifications'
                  ? 'bg-green-600 text-white'
                  : 'text-gray-700 hover:bg-green-100 hover:text-green-700'
              }`}
            >
              <Bell className="w-5 h-5" />
              <span>Notifications</span>
            </Link>
          </li>
          )}
          <li>
            <Link
              to="/guides"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                path === '/guides' || path.startsWith('/guides/')
                  ? 'bg-green-600 text-white'
                  : 'text-gray-700 hover:bg-green-100 hover:text-green-700'
              }`}
            >
              <BookOpen className="w-5 h-5" />
              <span>Guides</span>
            </Link>
          </li>
          <li>
            <Link
              to="/change-history"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                path === '/change-history'
                  ? 'bg-green-600 text-white'
                  : 'text-gray-700 hover:bg-green-100 hover:text-green-700'
              }`}
            >
              <History className="w-5 h-5" />
              <span>Change History</span>
            </Link>
          </li>
          {isAdmin && (
            <li>
              <Link
                to="/admin"
                className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                  path === '/admin'
                    ? 'bg-green-600 text-white'
                    : 'text-gray-700 hover:bg-green-100 hover:text-green-700'
                }`}
              >
                <Shield className="w-5 h-5" />
                <span>Admin</span>
              </Link>
            </li>
          )}
        </ul>
      </div>
    </aside>
  )
}
