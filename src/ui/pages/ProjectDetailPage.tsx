import { Navigate, useParams } from 'react-router-dom';

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  return <Navigate to={`/new-recap?job=${encodeURIComponent(projectId)}`} replace />;
}
