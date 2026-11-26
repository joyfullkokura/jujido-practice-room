-- Supabase の SQL Editor に貼って Run
-- ※ 以前の版を一度実行済みの場合は、先に次の1行を実行してから（テストデータは消えます）:
--   drop view if exists booked_slots; drop table if exists reservations, rooms;

-- ───────── 部屋 ─────────
create table rooms (
  id serial primary key,
  name text not null
);
insert into rooms (name) values ('2階 練習室');

-- Supabase は public のテーブルに anon へ全権限を自動付与するため、
-- RLS を有効にしないと誰でも部屋の追加・削除ができてしまう
alter table rooms enable row level security;
create policy "anyone can read rooms" on rooms
  for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on rooms from anon, authenticated;

-- ───────── 予約 ─────────
-- 個人情報は名前と学校名だけ
create table reservations (
  id bigserial primary key,
  room_id int not null references rooms(id),
  date date not null,
  start_hour int not null check (start_hour between 10 and 20),  -- アプリの枠 10:00〜20:00開始 と一致
  name text not null check (char_length(name) between 1 and 50),
  school text check (char_length(school) <= 50),
  source text check (char_length(source) <= 50),                  -- QRコードの流入元 (?from=○○中)
  created_at timestamptz not null default now(),
  unique (room_id, date, start_hour) -- ダブルブッキング防止
);

-- RLS: 誰でも予約の追加はできるが、他人の名前などは読めない・変更/削除もできない
alter table reservations enable row level security;
create policy "anyone can reserve" on reservations
  for insert to anon, authenticated
  with check (date >= (now() at time zone 'Asia/Tokyo')::date);  -- 過去の日付は不可

-- 権限も絞る（RLS と二重の守り）：読み取り・変更・削除は不可、
-- 追加は決められた列だけ（id や created_at は書き換えさせない）
revoke all on reservations from anon, authenticated;
grant insert (room_id, date, start_hour, name, school, source)
  on reservations to anon, authenticated;
grant usage on sequence reservations_id_seq to anon, authenticated;

-- ───────── 空き状況だけを公開するビュー（個人情報は含めない） ─────────
-- ビューは作成者(postgres)の権限で動くので、anon は reservations を読めなくても
-- このビュー経由で「埋まっている枠」だけは読める。
-- （Supabase の Advisor が "Security Definer View" と警告を出しますが、意図した設定です）
create view booked_slots as
  select room_id, date, start_hour from reservations;

-- 重要: 単純なビューは UPDATE/DELETE もできてしまい、しかも作成者権限で動くため、
-- 自動付与された権限のままだと anon がビュー経由で全予約を削除できる。SELECT だけに絞る。
revoke all on booked_slots from anon, authenticated;
grant select on booked_slots to anon, authenticated;
