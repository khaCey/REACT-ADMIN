import { Link, useLocation } from 'react-router-dom'
import {
  Users,
  UserCheck,
  History,
  Bell,
  Shield,
  LayoutDashboard,
  MessageSquare,
  AlertCircle,
  Calendar,
  Coffee,
} from 'lucide-react'
import { MESSAGES_WIP_DISABLED, NOTIFICATIONS_WIP_DISABLED } from '../guides/wipFlags'
import { useAuth } from '../context/AuthContext'

const navItemClass = (active) =>
  `flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors cursor-pointer ${
    active
      ? 'bg-green-600 text-white'
      : 'text-gray-700 hover:bg-green-100 hover:text-green-700'
  }`

export default function Sidebar({
  collapsed,
  onOpenUnpaid,
  onOpenUnscheduled,
  onOpenHiatus,
}) {
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
            <Link to="/dashboard" className={navItemClass(path === '/dashboard')}>
              <LayoutDashboard className="w-5 h-5" />
              <span>Dashboard</span>
            </Link>
          </li>
          <li>
            <Link
              to="/students"
              className={navItemClass(path === '/students' || !!path.match(/^\/students\/\d+$/))}
            >
              <Users className="w-5 h-5" />
              <span>Students</span>
            </Link>
          </li>
          {canAccessStaff && (
            <li>
              <Link to="/staff" className={navItemClass(path === '/staff')}>
                <UserCheck className="w-5 h-5" />
                <span>Staff</span>
              </Link>
            </li>
          )}
          {!NOTIFICATIONS_WIP_DISABLED && (
            <li>
              <Link to="/notifications" className={navItemClass(path === '/notifications')}>
                <Bell className="w-5 h-5" />
                <span>Notifications</span>
              </Link>
            </li>
          )}
          {!MESSAGES_WIP_DISABLED && (
            <li>
              <Link to="/messages" className={navItemClass(path === '/messages')}>
                <MessageSquare className="w-5 h-5" />
                <span>Messages</span>
              </Link>
            </li>
          )}
          <li>
            <Link to="/change-history" className={navItemClass(path === '/change-history')}>
              <History className="w-5 h-5" />
              <span>Change History</span>
            </Link>
          </li>
          {isAdmin && (
            <li>
              <Link to="/admin" className={navItemClass(path === '/admin')}>
                <Shield className="w-5 h-5" />
                <span>Admin</span>
              </Link>
            </li>
          )}
        </ul>

        {(onOpenUnpaid || onOpenUnscheduled || onOpenHiatus) && (
          <div className="mt-4 border-t border-gray-200 pt-4">
            <ul className="space-y-1">
              {onOpenUnpaid && (
                <li>
                  <button
                    type="button"
                    onClick={onOpenUnpaid}
                    className={`${navItemClass(false)} w-full text-left`}
                  >
                    <AlertCircle className="w-5 h-5" />
                    <span>未納</span>
                  </button>
                </li>
              )}
              {onOpenUnscheduled && (
                <li>
                  <button
                    type="button"
                    onClick={onOpenUnscheduled}
                    className={`${navItemClass(false)} w-full text-left`}
                  >
                    <Calendar className="w-5 h-5" />
                    <span>未定</span>
                  </button>
                </li>
              )}
              {onOpenHiatus && (
                <li>
                  <button
                    type="button"
                    onClick={onOpenHiatus}
                    className={`${navItemClass(false)} w-full text-left`}
                  >
                    <Coffee className="w-5 h-5" />
                    <span>休会中</span>
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </aside>
  )
}
