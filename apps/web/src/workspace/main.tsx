import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Outlet, createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { LoginPage, ResetPasswordPage, SignupPage } from './auth/AuthPages.tsx';
import { AuthProvider, RequireAuth } from './auth/AuthProvider.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { ShopListPage } from './pages/ShopListPage.tsx';
import { ShopWorkspacePage } from './pages/ShopWorkspacePage.tsx';
import './workspace.css';

const router = createBrowserRouter([
  {
    element: (
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    ),
    children: [
      { path: '/app/login', element: <LoginPage /> },
      { path: '/app/signup', element: <SignupPage /> },
      { path: '/app/reset', element: <ResetPasswordPage /> },
      {
        element: (
          <RequireAuth>
            <Outlet />
          </RequireAuth>
        ),
        children: [
          { path: '/app', element: <ShopListPage /> },
          { path: '/app/shops/:shopId', element: <ShopWorkspacePage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
