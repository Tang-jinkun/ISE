import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { useTranslation } from 'react-i18next';

export default function NotFound() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [stars, setStars] = useState<
    { top: number; left: number; delay: number }[]
  >([]);

  // Generate stars for background (matching Home page style)
  useEffect(() => {
    const starCount = 50;
    const newStars = Array.from({ length: starCount }).map(() => ({
      top: Math.random() * 100,
      left: Math.random() * 100,
      delay: Math.random() * 5
    }));
    setStars(newStars);
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground overflow-hidden relative">
      {/* Star Background */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        {stars.map((star, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-foreground rounded-full animate-pulse"
            style={{
              top: `${star.top}%`,
              left: `${star.left}%`,
              opacity: Math.random() * 0.7 + 0.3,
              animationDelay: `${star.delay}s`
            }}
          />
        ))}
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/50 to-background" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-6 px-4 text-center">
        <h1 className="text-9xl font-extrabold tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
          {t('notFound.title')}
        </h1>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
          {t('notFound.subtitle')}
        </h2>
        <p className="text-lg text-muted-foreground max-w-[500px]">
          {t('notFound.desc')}
        </p>

        <div className="mt-8">
          <Button
            onClick={() => navigate('/')}
            size="lg"
            className="text-lg px-8 py-6 rounded-full bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition-all hover:scale-105"
          >
            {t('common.backToHome')}
          </Button>
        </div>
      </div>

      {/* Decorative Planet/Circle */}
      <div className="absolute bottom-[-10%] right-[-5%] w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-[-10%] left-[-5%] w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
    </div>
  );
}
