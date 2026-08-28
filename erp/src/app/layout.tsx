import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "ERP 시스템",
  description: "사내 업무 효율화 시스템",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${plusJakartaSans.variable} ${inter.variable} h-full antialiased`}
      /* 테마 인라인 스크립트가 하이드레이션 전에 .dark를 붙인다 — 서버 HTML과 달라지는 것이
         설계(쿠키는 클라이언트만 안다)라 <html>의 클래스 비교 경고만 끈다(next-themes와 같은 해법) */
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* 개인별 테마(소방계획서_29 S1-2) — 첫 페인트 전에 쿠키(erp-theme)를 읽어 .dark를 붙인다.
            서버에서 cookies()를 읽지 않는 이유: 이 레이아웃과 /login이 정적 렌더인데
            쿠키 판독은 그걸 동적으로 바꾼다. 인라인 동기 스크립트는 파싱 중 실행되므로
            본문 페인트보다 먼저다(FOUC 없음). 값 어휘가 'dark' 하나뿐이라 부분일치로 충분하다. */}
        <script dangerouslySetInnerHTML={{ __html:
          "try{if(document.cookie.split('; ').includes('erp-theme=dark'))document.documentElement.classList.add('dark')}catch(e){}",
        }} />
        {children}
      </body>
    </html>
  );
}
