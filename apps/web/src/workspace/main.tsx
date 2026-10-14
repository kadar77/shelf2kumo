import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { ShopListPage } from './pages/ShopListPage.tsx';
import { ShopWorkspacePage } from './pages/ShopWorkspacePage.tsx';
import './workspace.css';

const router = createBrowserRouter([
  { path: '/app', element: <ShopListPage /> },
  { path: '/app/shops/:shopId', element: <ShopWorkspacePage /> },
  { path: '*', element: <NotFoundPage /> },
]);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
