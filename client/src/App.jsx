import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import StudentDetail from './pages/StudentDetail'
import Staff from './pages/Staff'
import ChangeHistory from './pages/ChangeHistory'
import Admin from './pages/Admin'
import Notifications from './pages/Notifications'
import Login from './pages/Login'
import { GuideTourProvider } from './context/GuideTourContext'

function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <GuideTourProvider>
              <Layout />
            </GuideTourProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/students" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="students/:id" element={<StudentDetail />} />
        <Route path="staff" element={<Staff />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="change-history" element={<ChangeHistory />} />
        <Route path="admin" element={<AdminRoute><Admin /></AdminRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/students" replace />} />
    </Routes>
  )
}

export default App
