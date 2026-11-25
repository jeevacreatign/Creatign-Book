// Reports module routes.
import { Route, Routes } from 'react-router-dom';
import ReportsHome from './ReportsHome';
import ReportView from './ReportView';

export default function Reports() {
  return (
    <Routes>
      <Route index element={<ReportsHome />} />
      <Route path=":key" element={<ReportView />} />
    </Routes>
  );
}
