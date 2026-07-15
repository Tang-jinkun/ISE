interface PageProps {
  title: string;
  children: React.ReactNode;
}

export function Page({ title, children }: PageProps) {
  return (
    <>
      <title>{title} | 智能化战例场景编排器</title>
      {children}
    </>
  );
}
