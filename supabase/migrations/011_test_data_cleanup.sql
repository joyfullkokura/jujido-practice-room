-- 011: 権限テスト（scripts/test-security.mjs）で作ったデータの後片付け
-- Supabase の SQL Editor に貼って Run。何度実行しても同じ結果になります。
-- 消すのは「名前・理由が __TEST__ で、2099年以降」のテストデータだけ。本物の予約には触れない。
-- 削除したことは変更履歴（audit_log）に残る。

-- ───────── 1. 今たまっているテストデータを消す（一度だけ。SQL Editor から実行するのと同じ内容） ─────────
delete from reservations where name = '__TEST__' and start_at >= '2099-01-01';
delete from closures     where reason = '__TEST__' and start_at >= '2099-01-01';
delete from rooms r      where r.name = '__TEST__' and not exists (select 1 from reservations x where x.room_id = r.id);
delete from hall_extras  where name like '\_\_TEST\_\_%';

-- ───────── 2. テストの最後に呼ぶ関数（管理者だけ。対象は上と同じテストデータに限る） ─────────
-- 予約は管理者でも API から物理削除できない設計なので、テスト用のデータだけを消せる専用の関数を用意する
create or replace function public.delete_test_data()
returns table (n_reservations int, n_closures int, n_rooms int, n_hall_extras int)
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception '管理者だけが使えます'; end if;
  delete from reservations where name = '__TEST__' and start_at >= '2099-01-01';
  get diagnostics n_reservations = row_count;
  delete from closures where reason = '__TEST__' and start_at >= '2099-01-01';
  get diagnostics n_closures = row_count;
  delete from rooms r where r.name = '__TEST__' and not exists (select 1 from reservations x where x.room_id = r.id);
  get diagnostics n_rooms = row_count;
  delete from hall_extras where name like '\_\_TEST\_\_%';
  get diagnostics n_hall_extras = row_count;
  return next;
end;
$$;
revoke execute on function public.delete_test_data() from public, anon, authenticated;
grant execute on function public.delete_test_data() to authenticated;
