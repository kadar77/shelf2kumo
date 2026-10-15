import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { Outlet, createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { LoginPage, ResetPasswordPage, SignupPage } from './auth/AuthPages.tsx';
import { AuthProvider, LoadingScreen, RequireAuth } from './auth/AuthProvider.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import './workspace.css';

// Shop pages pull in Firestore and Storage; load them only after sign-in.
const ShopListPage = lazy(() => import('./pages/ShopListPage.tsx').then((m) => ({ default: m.ShopListPage })));
const ShopWorkspacePage = lazy(() => import('./pages/ShopWorkspacePage.tsx').then((m) => ({ default: m.ShopWorkspacePage })));

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
            <Suspense fallback={<LoadingScreen />}>
              <Outlet />
            </Suspense>
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
