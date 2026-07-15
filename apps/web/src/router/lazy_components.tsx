import { lazy } from 'react';

const Home = lazy(() => import('@/pages/Home'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const Login = lazy(() => import('@/pages/Login'));
const Script = lazy(() => import('@/pages/Script'));
const Scene = lazy(() => import('@/pages/Scene'));
export const Preview = lazy(() => import('@/pages/Preview'));
export const User = lazy(() => import('@/pages/User/RealIndex'));
export const UserHomePage = lazy(() => import('@/pages/User/views/HomePage'));
export const UserMyRoom = lazy(() => import('@/pages/User/views/MyRoomPage'));
export const UserShareManage = lazy(
  () => import('@/pages/User/views/ShareManage')
);
export const UserTeamWork = lazy(() => import('@/pages/User/views/TeamWork'));
export const UserGroupInfo = lazy(() => import('@/pages/User/views/GroupInfo'));
export const UserMemberManage = lazy(
  () => import('@/pages/User/views/MemberManage')
);
export const UserManagePage = lazy(
  () => import('@/pages/User/views/ManagePage')
);
export const UserGenerativeAI = lazy(
  () => import('@/pages/User/views/GenerativeAI')
);
export const UserKnowledgeBasePage = lazy(
  () => import('@/pages/User/views/KnowledgeBasePage')
);
export const UserUserInfo = lazy(() => import('@/pages/User/views/UserInfo'));
export const NewScript = lazy(() => import('@/pages/newScript'));

export { Home, Login, NotFound, Scene, Script };
