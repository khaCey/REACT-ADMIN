import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FullPageLoading from './FullPageLoading'
import { isKhaceyStaff } from '../utils/staffAccess'

/** Restricts a route to staff named Khacey (not all admins). */
export default function KhaceyRoute({ children }) {
  const { staff, loading } = useAuth()

  if (loading) {
    return <FullPageLoading />
  }

  if (!isKhaceyStaff(staff)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
