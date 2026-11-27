-- 007: 管理者用の関数を一般の人（anon）から呼べないようにする
-- Supabase では新しく作った関数に anon・authenticated への実行権限が個別に付くため、
-- 006 の「revoke ... from public」だけでは anon の権限が残っていた（test-security で検出）。
-- データは変わりません。何度実行しても同じ結果になります。
revoke execute on function public.quote_price(text, int, timestamptz, timestamptz, int, text[], int, int) from anon;
revoke execute on function public.create_series(int, date, int, int, int, date, jsonb, boolean)           from anon;
revoke execute on function public.search_free_rooms(date, int, int, int, text)                            from anon;
-- トリガー用の関数は誰も直接呼ばない
revoke execute on function public.set_price()        from public, anon, authenticated;
revoke execute on function public.set_cancelled_at() from public, anon, authenticated;

-- 今後この schema に作る関数には、anon・authenticated の実行権限を自動で付けない（必要な関数だけ個別に grant する）
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
