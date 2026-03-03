import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { staff, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-green-600 animate-spin" />
      </div>
    )
  }

  if (!staff) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children
}
