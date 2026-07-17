import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import CommunityBanner from './components/CommunityBanner';
import InstanceManagementPage from './pages/InstanceManagementPage';
import EmbeddedDashboardsPage from './pages/EmbeddedDashboardsPage';

const App: React.FC = () => (
  <div className="community-plugin-layout">
    {/* [SHARED] Do not remove — all community plugins must display the CommunityBanner */}
    <CommunityBanner />
    <div className="community-plugin-content">
      <Routes>
        <Route path="/" element={<Navigate to="instance" replace />} />
        <Route path="instance/*" element={<InstanceManagementPage />} />
        <Route path="dashboards/*" element={<EmbeddedDashboardsPage />} />
      </Routes>
    </div>
  </div>
);

export default App;
