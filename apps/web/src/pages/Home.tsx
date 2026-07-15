import sectionBg1 from '@/assets/home/section_bg1.png';
import sectionBg2 from '@/assets/home/section_bg2.png';
import {
  ArrowRight,
  Code,
  Globe,
  Layers,
  Share2,
  Users,
  Zap
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';

export default function Home() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleGoWorkspace = () => {
    navigate('/user/homepage');
  };

  const handleCreateScene = () => {
    const newId = Math.random().toString(36).substring(7);
    navigate(`/scencenew/${newId}`);
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden selection:bg-blue-500/30">
      {/* Background Gradients/Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-500/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-0 right-0 w-[800px] h-[600px] bg-purple-500/10 blur-[100px] rounded-full" />
      </div>

      {/* Main Hero Section */}
      <main className="flex-1 relative z-10">
        <section className="relative min-h-[90vh] flex flex-col items-center justify-center text-center px-4 pt-20">
          <div className="max-w-4xl mx-auto space-y-8 animate-fade-in-up delay-100">
            <h2 className="text-6xl md:text-8xl font-bold tracking-tight leading-tight">
              {t('home.hero.title')}
            </h2>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {t('home.hero.subtitle')}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10">
              <Button
                onClick={handleCreateScene}
                size="lg"
                className="h-14 px-8 text-lg rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 transition-all duration-300 font-semibold shadow-[0_0_20px_rgba(255,255,255,0.3)]"
              >
                {t('home.hero.experience')}
              </Button>
              <Button
                onClick={handleGoWorkspace}
                size="lg"
                variant="outline"
                className="h-14 px-8 text-lg rounded-full border-border text-foreground hover:bg-accent hover:border-border transition-all duration-300 bg-transparent backdrop-blur-sm"
              >
                {t('home.hero.enterSpace')}
              </Button>
            </div>
          </div>

          {/* Globe/Visual Placeholder */}
          <div className="mt-20 relative w-full max-w-5xl aspect-[2/1] rounded-t-3xl border border-border bg-card/50 backdrop-blur-md overflow-hidden shadow-2xl animate-fade-in-up delay-300">
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Globe className="w-24 h-24 mx-auto mb-4 opacity-20 animate-spin-slow" />
                <p className="text-sm font-mono opacity-50">
                  3D Interactive Scene Placeholder
                </p>
              </div>
            </div>
            {/* Grid Overlay */}
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-12 border-y border-border bg-card/30 backdrop-blur-sm">
          <div className="container mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
              {[
                { label: t('home.stats.users'), value: '10k+' },
                { label: t('home.stats.scenes'), value: '50k+' },
                { label: t('home.stats.assets'), value: '1M+' }
              ].map((stat, index) => (
                <div key={index} className="space-y-2">
                  <div className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                    {stat.value}
                  </div>
                  <div className="text-muted-foreground font-medium">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Feature Section 1 (Image Left) */}
        <section className="py-32 relative">
          <div className="container mx-auto px-6">
            <div className="grid lg:grid-cols-2 gap-20 items-center">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-2xl blur opacity-25 group-hover:opacity-75 transition duration-1000"></div>
                <div className="relative rounded-2xl overflow-hidden border border-border bg-card shadow-2xl aspect-video">
                  <img
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    src={sectionBg1}
                    alt="Feature 1"
                  />
                </div>
              </div>
              <div className="space-y-8">
                <div className="inline-flex items-center gap-2 text-blue-400 font-medium">
                  <Layers className="w-5 h-5" />
                  <span>{t('home.feature1.tag')}</span>
                </div>
                <h3 className="text-4xl md:text-5xl font-bold leading-tight">
                  {t('home.feature1.title')}
                </h3>
                <p className="text-xl text-muted-foreground leading-relaxed">
                  {t('home.feature1.desc')}
                </p>
                <div className="pt-4">
                  <Button className="text-blue-400 p-0 text-lg hover:text-blue-300">
                    Learn more <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Productivity Grid (Bento Box) */}
        <section className="py-32 bg-muted/30">
          <div className="container mx-auto px-6">
            <div className="text-center max-w-3xl mx-auto mb-20 space-y-4">
              <h2 className="text-4xl md:text-5xl font-bold">
                {t('home.productivity.title')}
              </h2>
              <p className="text-xl text-muted-foreground">
                {t('home.productivity.subtitle')}
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {/* Card 1 */}
              <div className="p-8 rounded-3xl border border-border bg-card/50 hover:bg-card transition-colors space-y-4 group">
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 group-hover:scale-110 transition-transform">
                  <Zap className="w-6 h-6" />
                </div>
                <h4 className="text-xl font-bold">
                  {t('home.productivity.item1.title')}
                </h4>
                <p className="text-muted-foreground leading-relaxed">
                  {t('home.productivity.item1.desc')}
                </p>
              </div>

              {/* Card 2 */}
              <div className="p-8 rounded-3xl border border-border bg-card/50 hover:bg-card transition-colors space-y-4 group">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                  <Users className="w-6 h-6" />
                </div>
                <h4 className="text-xl font-bold">
                  {t('home.productivity.item2.title')}
                </h4>
                <p className="text-muted-foreground leading-relaxed">
                  {t('home.productivity.item2.desc')}
                </p>
              </div>

              {/* Card 3 */}
              <div className="p-8 rounded-3xl border border-border bg-card/50 hover:bg-card transition-colors space-y-4 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                  <Share2 className="w-6 h-6" />
                </div>
                <h4 className="text-xl font-bold">
                  {t('home.productivity.item3.title')}
                </h4>
                <p className="text-muted-foreground leading-relaxed">
                  {t('home.productivity.item3.desc')}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Section 2 (Image Right) */}
        <section className="py-32 relative">
          <div className="container mx-auto px-6">
            <div className="grid lg:grid-cols-2 gap-20 items-center md:flex-row-reverse">
              <div className="space-y-8 order-2 lg:order-1">
                <div className="inline-flex items-center gap-2 text-primary font-medium">
                  <Globe className="w-5 h-5" />
                  <span>{t('home.feature2.tag')}</span>
                </div>
                <h3 className="text-4xl md:text-5xl font-bold leading-tight">
                  {t('home.feature2.title')}
                </h3>
                <p className="text-xl text-muted-foreground leading-relaxed">
                  {t('home.feature2.desc')}
                </p>
                <div className="pt-4">
                  <Button className="text-primary p-0 text-lg hover:text-primary/80">
                    View Documentation <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                </div>
              </div>
              <div className="relative group order-1 lg:order-2">
                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl blur opacity-25 group-hover:opacity-75 transition duration-1000"></div>
                <div className="relative rounded-2xl overflow-hidden border border-border bg-card shadow-2xl aspect-video">
                  <img
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    src={sectionBg2}
                    alt="Feature 2"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-32 border-t border-border relative overflow-hidden">
          <div className="absolute inset-0 bg-blue-500/5 radial-gradient"></div>
          <div className="container mx-auto px-6 text-center relative z-10">
            <h2 className="text-5xl md:text-7xl font-bold tracking-tight mb-8">
              {t('home.cta.title')}
            </h2>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto mb-12">
              {t('home.cta.subtitle')}
            </p>
            <Button
              onClick={() => navigate('/login')}
              size="lg"
              className="h-16 px-10 text-xl rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-xl hover:shadow-2xl hover:-translate-y-1"
            >
              {t('home.cta.button')}
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-12 border-t border-border bg-background text-muted-foreground">
        <div className="container mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="col-span-1 md:col-span-2">
              <div className="text-2xl font-bold text-foreground mb-4">GeoScene</div>
              <p className="max-w-xs">
                The next generation platform for creating and sharing immersive
                geographic scenes.
              </p>
            </div>
            <div>
              <h4 className="font-bold text-foreground mb-4">Product</h4>
              <ul className="space-y-2">
                <li className="hover:text-foreground cursor-pointer">Features</li>
                <li className="hover:text-foreground cursor-pointer">Enterprise</li>
                <li className="hover:text-foreground cursor-pointer">Security</li>
                <li className="hover:text-foreground cursor-pointer">Roadmap</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-foreground mb-4">Company</h4>
              <ul className="space-y-2">
                <li className="hover:text-foreground cursor-pointer">About</li>
                <li className="hover:text-foreground cursor-pointer">Blog</li>
                <li className="hover:text-foreground cursor-pointer">Careers</li>
                <li className="hover:text-foreground cursor-pointer">Contact</li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center">
            <p>{t('home.footer')}</p>
            <div className="flex gap-4 mt-4 md:mt-0">
              <Globe className="w-5 h-5 hover:text-foreground cursor-pointer" />
              <Share2 className="w-5 h-5 hover:text-foreground cursor-pointer" />
              <Code className="w-5 h-5 hover:text-foreground cursor-pointer" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
