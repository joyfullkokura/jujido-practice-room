# 十字堂楽器店 練習室予約

Next.js 16 (App Router) + Supabase + Tailwind CSS。本番: https://jujido-practice-room.vercel.app （main に push すると Vercel が自動デプロイ）

- 予約画面: `/`　管理者ページ: `/admin`（Supabase Auth のメール＋パスワード。admins に登録されたユーザーのみ）

## DB（Supabase の SQL Editor で、上から順に1回ずつ実行）
1. `supabase/schema.sql`（初回のみ）
2. `supabase/migrations/001_multi_slot.sql` … 連続枠の予約（予約は関数 `create_reservation` 経由のみ）
3. `supabase/migrations/002_rooms.sql` … 複数の部屋（色・定員・説明・並び順・公開/非公開）
4. `supabase/migrations/003_time_range.sql` … 予約を開始〜終了（15分単位）で保持、重複は排他制約で防止
5. `supabase/migrations/004_admin.sql` … 管理者（admins / is_admin）、営業時間、予約不可枠
6. `supabase/migrations/005_booking_fields.sql` … 予約の区分・講師・コース・人数・支払状況など、仮予約／利用済み、削除（論理削除）、8教室（非公開）
7. `supabase/migrations/006_pricing_series.sql` … 料金設定・ホール楽器、料金計算（quote_price）と予約への記録、定期レッスン（create_series）、空き教室検索（search_free_rooms）
8. `supabase/migrations/007_revoke_anon_functions.sql` … 管理者用の関数（料金計算・定期登録・空き検索）を一般の人から呼べないようにする
9. `supabase/migrations/008_audit_settings.sql` … 変更履歴（audit_log・トリガーで自動記録、管理者だけ閲覧、書き換え不可）、集計・予約表の時間帯の設定（shop_settings）

管理者の追加（SQL Editor）: `insert into admins (user_id) select id from auth.users where email = '…' on conflict do nothing;`

## ローカル開発
1. `.env.local` に `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_KEY`（publishable key）
2. `npm install` → `npm run dev` → http://localhost:3000

## 確認用スクリプト
- 権限テスト: `node --env-file=.env.local --env-file=.env.test.local scripts/test-security.mjs`（.env.test.local に TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD / TEST_USER_EMAIL / TEST_USER_PASSWORD）
  - テスト予約は 2099 年に入る。削除: `delete from reservations where name = '__TEST__';`
- 画面の動作テスト（ドラッグ選択・時刻リスト。サンプルデータ使用）: `npm run dev` を起動して `node scripts/test-ui.mjs`
- 管理画面のスクリーンショット（サンプルデータ使用）: `npm run dev` を起動して `node scripts/screenshot-admin.mjs <保存先>`
- スクリーンショット: `node scripts/screenshot.mjs http://localhost:3000 screenshots [2026-11-27T15:20:00+09:00] [--mock]`（--mock はサンプルデータで表示）
  （初回は `npx playwright install chromium`）

流入元の計測: QRコードのURLを `https://<ドメイン>/?from=○○中` にする
