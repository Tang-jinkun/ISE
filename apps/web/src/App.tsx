import './styles/global.css';
import { ThemeProvider } from './components/theme/ThemeProvider';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { AppRouter } from './router';
import Header from '@/components/common/Header';

const Layout = () => {
  const location = useLocation();
  const isHomePage = location.pathname === '/';

  return (
    <>
      {isHomePage && <Header />}
      <AppRouter />
    </>
  );
};

const App = () => {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Layout />
      </BrowserRouter>
    </ThemeProvider>
  );
};

export default App;
