import { createBrowserRouter, Navigate } from 'react-router';
import { ProjectLayout } from './pages/ProjectLayout.js';
import { ProjectsPage } from './pages/ProjectsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { InboxPage } from './pages/InboxPage.js';
import { CharactersPage } from './pages/CharactersPage.js';
import { LocationsPage } from './pages/LocationsPage.js';
import { PlotPage } from './pages/PlotPage.js';
import { ParametersPage } from './pages/ParametersPage.js';
import { ManuscriptPage } from './pages/ManuscriptPage.js';
import { GeneratePage } from './pages/GeneratePage.js';
import { RunsPage } from './pages/RunsPage.js';
import { RunDetailPage } from './pages/RunDetailPage.js';
import { ExportPage } from './pages/ExportPage.js';

export const router = createBrowserRouter([
  { path: '/', element: <ProjectsPage /> },
  { path: '/settings', element: <SettingsPage /> },
  {
    path: '/p/:projectId',
    element: <ProjectLayout />,
    children: [
      { index: true, element: <Navigate to="overview" replace /> },
      { path: 'overview', element: <OverviewPage /> },
      { path: 'inbox', element: <InboxPage /> },
      { path: 'characters', element: <CharactersPage /> },
      { path: 'locations', element: <LocationsPage /> },
      { path: 'plot', element: <PlotPage /> },
      { path: 'parameters', element: <ParametersPage /> },
      { path: 'manuscript', element: <ManuscriptPage /> },
      { path: 'generate', element: <GeneratePage /> },
      { path: 'runs', element: <RunsPage /> },
      { path: 'runs/:runId', element: <RunDetailPage /> },
      { path: 'export', element: <ExportPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
