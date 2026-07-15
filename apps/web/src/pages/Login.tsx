import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { message } from '@/components/ui/message';
import { login as apiLogin, register as apiRegister } from '@/api/auth';
import { tokenStorage } from '@/api/http';
import { Globe, Layers, Bot, Users } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('login');
  const fetchUser = useUserStore((s) => s.fetchUser);

  useEffect(() => {
    const token = tokenStorage.getToken(tokenStorage.keys.access);
    if (token) {
      navigate('/user/homepage', { replace: true });
    }
  }, [navigate]);

  // Login Schema
  const loginSchema = z.object({
    email: z.string().email({
      message: t('auth.errors.emailInvalid')
    }),
    password: z.string().min(6, {
      message: t('auth.errors.passwordMin')
    })
  });

  // Register Schema
  const registerSchema = z
    .object({
      username: z.string().min(2, {
        message: t('auth.errors.usernameMin')
      }),
      email: z.string().email({
        message: t('auth.errors.emailInvalid')
      }),
      password: z.string().min(6, {
        message: t('auth.errors.passwordMin')
      }),
      confirmPassword: z.string()
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('auth.errors.passwordMismatch'),
      path: ['confirmPassword']
    });

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: ''
    }
  });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: ''
    }
  });

  async function onLoginSubmit(values: z.infer<typeof loginSchema>) {
    const res = await apiLogin({
      email: values.email,
      password: values.password
    });
    if (res?.data?.access_token) {
      await fetchUser();
      message.success('登录成功');
      navigate('/user/homepage');
    } else {
      message.error(res?.message || '登录失败');
    }
  }

  async function onRegisterSubmit(values: z.infer<typeof registerSchema>) {
    const res = await apiRegister({
      email: values.email,
      password: values.password,
      username: values.username
    });
    if (res?.data?.access_token) {
      await fetchUser();
      message.success('注册成功');
      navigate('/user/homepage');
    } else {
      message.error(res?.message || '注册失败');
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background/90 to-background" />
      <div className="absolute inset-x-0 top-0 h-64 animated-aurora opacity-70" />
      <div className="absolute inset-x-0 bottom-0 h-64 animated-aurora opacity-70" />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-cyan-500/10 blur-3xl animated-blob" />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full bg-blue-600/10 blur-3xl animated-blob" />

      <div className="relative max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-14 items-center min-h-screen px-8 lg:px-20 py-10 animate-in fade-in duration-500">
        <div className="space-y-8 lg:space-y-10">
          <div className="inline-flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg" />
            <div className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
              智能化战例场景编排器
            </div>
          </div>
          <div className="text-5xl lg:text-6xl font-extrabold leading-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-muted-foreground">
            快速构建地理场景与剧本逻辑
          </div>
          <div className="text-muted-foreground max-w-2xl">
            集场景创作、脚本编排与智能体问答于一体，支持团队协作与素材管理，让内容生产更高效、更灵活。
          </div>
          <div className="grid grid-cols-2 gap-4 max-w-2xl">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2">
              <Globe className="h-4 w-4 text-cyan-300" />
              <span className="text-sm text-foreground">场景创作</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2">
              <Layers className="h-4 w-4 text-blue-300" />
              <span className="text-sm text-foreground">剧本逻辑</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2">
              <Bot className="h-4 w-4 text-cyan-300" />
              <span className="text-sm text-foreground">智能体问答</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2">
              <Users className="h-4 w-4 text-blue-300" />
              <span className="text-sm text-foreground">团队协作</span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            登录即可开始创作，支持从模板或空白项目快速起步。
          </div>
        </div>
        <Card className="w-full max-w-md lg:ml-auto border border-border bg-card/60 backdrop-blur-xl shadow-2xl">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
              {activeTab === 'login'
                ? t('auth.loginTitle')
                : t('auth.registerTitle')}
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              {activeTab === 'login'
                ? t('auth.loginDesc')
                : t('auth.registerDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 mb-6 bg-muted/50 border border-border rounded-lg">
                <TabsTrigger
                  value="login"
                  className="data-[state=active]:bg-background data-[state=active]:text-foreground"
                >
                  {t('auth.loginTitle')}
                </TabsTrigger>
                <TabsTrigger
                  value="register"
                  className="data-[state=active]:bg-background data-[state=active]:text-foreground"
                >
                  {t('auth.registerTitle')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <Form {...loginForm}>
                  <form
                    onSubmit={loginForm.handleSubmit(onLoginSubmit)}
                    className="space-y-4"
                  >
                    <FormField
                      control={loginForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">
                            {t('auth.email')}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="admin@example.com"
                              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">
                            {t('auth.password')}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="******"
                              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      className="w-full bg-cyan-600 hover:bg-cyan-700 text-foreground"
                    >
                      {t('auth.submitLogin')}
                    </Button>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="register">
                <Form {...registerForm}>
                  <form
                    onSubmit={registerForm.handleSubmit(onRegisterSubmit)}
                    className="space-y-4"
                  >
                    <FormField
                      control={registerForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">
                            {t('auth.username')}
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="John Doe"
                              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">
                            {t('auth.email')}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="john@example.com"
                              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">
                            {t('auth.password')}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="******"
                              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">
                            {t('auth.confirmPassword')}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="******"
                              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      className="w-full bg-cyan-600 hover:bg-cyan-700 text-foreground"
                    >
                      {t('auth.submitRegister')}
                    </Button>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
