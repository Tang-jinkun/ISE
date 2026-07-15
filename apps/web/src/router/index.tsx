import { Loading } from '@/components/ui/loading';
import { lazy, Suspense, type JSX } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  Home,
  Login,
  NewScript,
  NotFound,
  Preview,
  Scene,
  Script,
  User,
  UserGenerativeAI,
  UserGroupInfo,
  UserHomePage,
  UserKnowledgeBasePage,
  UserManagePage,
  UserMemberManage,
  UserMyRoom,
  UserShareManage,
  UserTeamWork,
  UserUserInfo
} from './lazy_components';

const RuntimeHarness = lazy(() => import('@/pages/RuntimeHarness'));
const runtimeHarnessEnabled =
  import.meta.env.DEV || String(import.meta.env.MODE) === 'test';

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const location = useLocation();
  const token =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('access_token')
      : null;

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
};

export function AppRouter() {
  return (
    <Suspense fallback={<Loading text="LOADING RESOURCES" />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/scene"
          element={
            <RequireAuth>
              <Scene />
            </RequireAuth>
          }
        />
        <Route
          path="/preview"
          element={
            <RequireAuth>
              <Preview />
            </RequireAuth>
          }
        />
        <Route
          path="/script"
          element={
            <RequireAuth>
              <Script />
            </RequireAuth>
          }
        />
        <Route
          path="/new-script"
          element={
            <RequireAuth>
              <NewScript />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<Login />} />
        {runtimeHarnessEnabled && (
          <Route path="/runtime-harness" element={<RuntimeHarness />} />
        )}
        <Route
          path="/user"
          element={
            <RequireAuth>
              <User />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="homepage" replace />} />
          <Route path="homepage" element={<UserHomePage />} />
          <Route path="myroom" element={<UserMyRoom />} />
          <Route path="sharemanage" element={<UserShareManage />} />
          <Route path="teamwork" element={<UserTeamWork />} />
          <Route path="groupinfo" element={<UserGroupInfo />} />
          <Route path="membermanage" element={<UserMemberManage />} />
          <Route path="managepage" element={<UserManagePage />} />
          <Route path="generativeai" element={<UserGenerativeAI />} />
          <Route path="knowledgebase" element={<UserKnowledgeBasePage />} />
          <Route path="userinfo" element={<UserUserInfo />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
