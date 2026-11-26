export const metadata = { title: "十字堂楽器店 練習室予約" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head><style>{`*,*::before,*::after{box-sizing:border-box}`}</style></head>
      <body style={{ fontFamily: "sans-serif", margin: 0, background: "#f6f6f4" }}>{children}</body>
    </html>
  );
}
