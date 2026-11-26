# 十字堂楽器店 練習室予約（試作）

1. Supabase の SQL Editor で `supabase/schema.sql` を実行
2. `.env.local` の `NEXT_PUBLIC_SUPABASE_KEY` に publishable key（anon key）を貼る
3. `npm install` → `npm run dev` → http://localhost:3000
4. `git init` して GitHub の joyfullkokura/jujido-practice-room に push → Vercel で Import
   （Vercel の Environment Variables にも .env.local と同じ2つを設定）

流入元の計測: QRコードのURLを `https://<ドメイン>/?from=○○中` にする
