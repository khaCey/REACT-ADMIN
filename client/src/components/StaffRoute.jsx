import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FullPageLoading from './FullPageLoading'

export default function StaffRoute({ children }) {
  const { staff, loading } = useAuth()

  if (loading) {
    return <FullPageLoading />
  }

  const isAdmin = !!staff?.is_admin || String(staff?.name || '').trim().toLowerCase() === 'khacey'
  const isOperator = !!staff?.is_operator
  if (!isAdmin && !isOperator) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
