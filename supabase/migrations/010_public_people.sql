-- 010: 一般の予約画面で人数を選べるようにする（予約関数・料金表示関数に人数を追加）
-- Supabase の SQL Editor に貼って Run。データは変わりません。何度実行しても同じ結果になります。
-- 引数を増やすため、古い関数は作り直す。人数を省くと1人（今公開中の画面は、実行の前後どちらでもそのまま動く）

-- ───────── 1. 一般の予約：人数（1人〜部屋の定員） ─────────
drop function if exists public.create_reservation(int, timestamptz, timestamptz, text, text, text);
create or replace function public.create_reservation(
  p_room_id  int,
  p_start_at timestamptz,
  p_end_at   timestamptz,
  p_name     text,
  p_school   text default null,
  p_source   text default null,
  p_people   int  default 1
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  s timestamp := p_start_at at time zone 'Asia/Tokyo';
  e timestamp := p_end_at   at time zone 'Asia/Tokyo';
  v_open  time := '10:00';
  v_close time := '21:00';
  v_closed boolean := false;
  v_charge boolean := true;
  v_capacity int;
begin
  p_name   := btrim(coalesce(p_name, ''));
  p_school := nullif(btrim(coalesce(p_school, '')), '');
  p_source := nullif(btrim(coalesce(p_source, '')), '');
  p_people := coalesce(p_people, 1);

  if not exists (select 1 from rooms where id = p_room_id and is_public) then
    raise exception 'この部屋は予約できません';
  end if;
  if p_name = '' then
    raise exception '名前を入力してください';
  end if;
  select capacity into v_capacity from rooms where id = p_room_id;
  if p_people < 1 or p_people > 200 then
    raise exception '人数を確認してください';
  end if;
  if v_capacity is not null and p_people > v_capacity then
    raise exception 'この部屋の定員は %人です', v_capacity;
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception '開始と終了の時刻を確認してください';
  end if;
  if extract(second from s) <> 0 or extract(minute from s)::int % 15 <> 0
     or extract(second from e) <> 0 or extract(minute from e)::int % 15 <> 0 then
    raise exception '時刻は15分単位で指定してください';
  end if;
  if p_end_at - p_start_at < interval '30 minutes' then
    raise exception '予約は30分以上でお願いします';
  end if;
  if p_end_at - p_start_at > interval '3 hours' then
    raise exception '1回の予約は3時間までです';
  end if;

  select open_time, close_time, is_closed into v_open, v_close, v_closed
    from business_hours where weekday = extract(dow from s)::int;
  if v_closed then
    raise exception 'この日は定休日です';
  end if;
  if s < s::date + coalesce(v_open, '10:00') or e > s::date + coalesce(v_close, '21:00') then
    raise exception '予約できる時間は %〜% です', to_char(coalesce(v_open, '10:00'), 'FMHH24:MI'), to_char(coalesce(v_close, '21:00'), 'FMHH24:MI');
  end if;
  if exists (select 1 from closures c
              where (c.room_id is null or c.room_id = p_room_id)
                and tstzrange(c.start_at, c.end_at, '[)') && tstzrange(p_start_at, p_end_at, '[)')) then
    raise exception 'その時間は予約を受け付けていません';
  end if;
  if p_start_at <= now() then
    raise exception '過ぎた時間は予約できません';
  end if;

  select public_charge into v_charge from price_settings where id = 1;
  if coalesce(v_charge, true) then
    insert into reservations (room_id, start_at, end_at, name, school, source, people)
    values (p_room_id, p_start_at, p_end_at, p_name, p_school, p_source, p_people)
    returning id into v_id;
  else
    insert into reservations (room_id, start_at, end_at, name, school, source, people, payment, price_override)
    values (p_room_id, p_start_at, p_end_at, p_name, p_school, p_source, p_people, 'free', 0)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.create_reservation(int, timestamptz, timestamptz, text, text, text, int) from public, anon, authenticated;
grant execute on function public.create_reservation(int, timestamptz, timestamptz, text, text, text, int) to anon, authenticated;

-- ───────── 2. 一般向けの料金表示：人数で変わる（一般教室は2人目から追加料金。ホールは人数で変わらない） ─────────
drop function if exists public.public_quote(int, timestamptz, timestamptz);
create or replace function public.public_quote(p_room_id int, p_start_at timestamptz, p_end_at timestamptz, p_people int default 1) returns int
language plpgsql stable security definer set search_path = public
as $$
declare
  v_charge boolean;
  v_capacity int;
  v_total int;
begin
  if not exists (select 1 from rooms where id = p_room_id and is_public) then return null; end if;
  select public_charge into v_charge from price_settings where id = 1;
  if not coalesce(v_charge, true) then return null; end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at or p_end_at - p_start_at > interval '3 hours' then return null; end if;
  select capacity into v_capacity from rooms where id = p_room_id;
  if coalesce(p_people, 1) < 1 or (v_capacity is not null and p_people > v_capacity) then return null; end if;
  select q.total into v_total from quote_price('rental', p_room_id, p_start_at, p_end_at, coalesce(p_people, 1), '{}', 0, null) q;
  return v_total;
end;
$$;
revoke execute on function public.public_quote(int, timestamptz, timestamptz, int) from public, anon, authenticated;
grant execute on function public.public_quote(int, timestamptz, timestamptz, int) to anon, authenticated;
