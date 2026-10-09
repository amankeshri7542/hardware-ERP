import { Navigate, Outlet, Link, useLocation } from 'react-router-dom';
import { Result, Button } from 'antd';
import useAuthStore from '../store/authStore';
import { canAccessPath, homePath } from '../utils/access';

export default function PrivateRoute() {
  const { isAuthenticated, user } = useAuthStore();
  const { pathname } = useLocation();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!canAccessPath(user, pathname)) {
    return <Result status="403" title="This page is unavailable for your account"
      subTitle="Your account can view the product catalog. Billing and other restricted pages are unavailable for this account."
      extra={<Link to={homePath(user)}><Button type="primary">Open product catalog</Button></Link>} />;
  }
  return <Outlet />;
}
