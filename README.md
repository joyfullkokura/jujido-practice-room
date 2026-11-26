# 十字堂楽器店 練習室予約

Next.js 16 (App Router) + Supabase + Tailwind CSS。本番: https://jujido-practice-room.vercel.app （main に push すると Vercel が自動デプロイ）

## DB（Supabase の SQL Editor で、上から順に1回ずつ実行）
1. `supabase/schema.sql`（初回のみ）
2. `supabase/migrations/001_multi_slot.sql` … 連続枠の予約（予約は関数 `create_reservation` 経由のみ）

## ローカル開発
1. `.env.local` に `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_KEY`（publishable key）
2. `npm install` → `npm run dev` → http://localhost:3000

## 確認用スクリプト
- 権限テスト（一般利用者の立場）: `node --env-file=.env.local scripts/test-security.mjs`
  - テスト予約は 2099 年に入る。削除: `delete from reservations where name = '__TEST__';`
- スクリーンショット: `node scripts/screenshot.mjs http://localhost:3000 screenshots [2026-11-27T15:20:00+09:00]`
  （初回は `npx playwright install chromium`）

流入元の計測: QRコードのURLを `https://<ドメイン>/?from=○○中` にする
