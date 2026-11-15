import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';

export const metadata: Metadata = { title: 'luyenthuyettrinh.com', description: 'Luyện thuyết trình cùng AI' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = (await cookies()).get('ui_lang')?.value === 'en' ? 'en' : 'vi';
  return (
    <html lang={lang}>
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
