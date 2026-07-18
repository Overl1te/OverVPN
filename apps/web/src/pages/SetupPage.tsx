import { Navigate } from 'react-router-dom';

/** Setup wizard page retired in favor of the spotlight panel tour. */
export function SetupPage() {
  return <Navigate to="/dashboard" replace />;
}
