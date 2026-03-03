import { Link, useLocation } from 'react-router-dom'
import { Users, UserCheck, History } from 'lucide-react'

export default function Sidebar({ collapsed }) {
  const location = useLocation()
  const path = location.pathname

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
        </ul>
      </div>
    </aside>
  )
}
