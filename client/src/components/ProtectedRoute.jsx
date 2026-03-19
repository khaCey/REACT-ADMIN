import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FullPageLoading from './FullPageLoading'

export default function ProtectedRoute({ children }) {
  const { staff, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <FullPageLoading />
  }

  if (!staff) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children
}
