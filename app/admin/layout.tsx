import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "管理 | 十字堂楽器店 練習室予約",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
