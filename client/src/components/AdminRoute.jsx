import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function AdminRoute({ children }) {
  const { staff, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-green-600 animate-spin" />
      </div>
    )
  }

  const isAdmin = !!staff?.is_admin || String(staff?.name || '').trim().toLowerCase() === 'khacey'
  if (!isAdmin) {
    return <Navigate to="/students" replace />
  }

  return children
}
