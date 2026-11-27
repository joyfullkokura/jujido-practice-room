-- 009: 試作用の「2階 練習室A／B」を削除し、8教室を公開。一般の予約画面向けの料金表示関数
-- Supabase の SQL Editor に貼って Run。何度実行しても同じ結果になります。
-- 削除した予約・部屋は変更履歴（audit_log）に「SQL Editor（システム）」として残ります。

-- ───────── 1. 試作用の2部屋と、その予約（テスト予約を含む）を削除 ─────────
-- 予約が残っていると外部キーで部屋を消せないので、予約 → 部屋の順に消す（予約不可枠は部屋と一緒に自動で消える）
delete from reservations
 where room_id in (select id from rooms where name in ('2階 練習室A', '2階 練習室B'));
delete from rooms where name in ('2階 練習室A', '2階 練習室B');

-- ───────── 2. 一般の予約画面に出す部屋 ─────────
-- ここに書いた部屋を「公開」にする。一般の人に予約させない部屋は、その行を消してから実行する
-- （ここに書かない部屋の公開／非公開は変えない。あとから管理画面の「設定 → 教室」でも変えられる）
update rooms set is_public = true
 where name in (
   'L-1',
   'M-3',
   'L-2',
   'S-5',
   'M-2',
   'M-1',
   'S-6',
   'ホール'
 );

-- ───────── 3. 一般の予約画面に出す料金（税込）だけを返す関数 ─────────
-- quote_price は管理者用（区分・割引などを指定できる）なので、一般の人には「公開中の部屋・一般貸出・1人」の税込額だけを返す
-- 料金設定で「一般予約を有料にする」がオフのとき、部屋が公開されていないとき、時間が正しくないときは null（画面に料金を出さない）
create or replace function public.public_quote(p_room_id int, p_start_at timestamptz, p_end_at timestamptz) returns int
language plpgsql stable security definer set search_path = public
as $$
declare
  v_charge boolean;
  v_total int;
begin
  if not exists (select 1 from rooms where id = p_room_id and is_public) then return null; end if;
  select public_charge into v_charge from price_settings where id = 1;
  if not coalesce(v_charge, true) then return null; end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at or p_end_at - p_start_at > interval '3 hours' then return null; end if;
  select q.total into v_total from quote_price('rental', p_room_id, p_start_at, p_end_at, 1, '{}', 0, null) q;
  return v_total;
end;
$$;
revoke execute on function public.public_quote(int, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.public_quote(int, timestamptz, timestamptz) to anon, authenticated;
