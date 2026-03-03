import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Students from './pages/Students'
import StudentDetail from './pages/StudentDetail'
import Staff from './pages/Staff'
import ChangeHistory from './pages/ChangeHistory'
import Notifications from './pages/Notifications'
import Login from './pages/Login'

function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/students" replace />} />
        <Route path="students" element={<Students />} />
        <Route path="students/:id" element={<StudentDetail />} />
        <Route path="staff" element={<Staff />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="change-history" element={<ChangeHistory />} />
      </Route>
      <Route path="*" element={<Navigate to="/students" replace />} />
    </Routes>
  )
}

export default App
