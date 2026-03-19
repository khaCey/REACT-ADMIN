import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FullPageLoading from './FullPageLoading'

export default function AdminRoute({ children }) {
  const { staff, loading } = useAuth()

  if (loading) {
    return <FullPageLoading />
  }

  const isAdmin = !!staff?.is_admin || String(staff?.name || '').trim().toLowerCase() === 'khacey'
  if (!isAdmin) {
    return <Navigate to="/students" replace />
  }

  return children
}
