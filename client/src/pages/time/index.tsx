// Time Tracking module routes: /time-tracking/projects/* and /time-tracking/timesheet.
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProjectForm, ProjectList, ProjectRoute } from './Projects';
import Timesheet from './Timesheet';

export default function TimeTracking() {
  return (
    <Routes>
      <Route path="timesheet" element={<Timesheet />} />
      <Route path="projects" element={<ProjectList />} />
      <Route path="projects/new" element={<ProjectForm key="new" />} />
      <Route path="projects/:id/edit" element={<ProjectForm />} />
      <Route path="projects/:id" element={<ProjectRoute />} />
      <Route path="*" element={<Navigate to="/time-tracking/projects" replace />} />
    </Routes>
  );
}
