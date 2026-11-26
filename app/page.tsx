"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const ROOM_ID = 1;
const HOURS = Array.from({ length: 11 }, (_, i) => 10 + i); // 10:00〜20:00開始の1時間枠

export default function Home() {
  const [date, setDate] = useState(new Date().toLocaleDateString("sv-SE"));
  const [booked, setBooked] = useState<number[]>([]);
  const [hour, setHour] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const { data } = await supabase
      .from("booked_slots").select("start_hour")
      .eq("room_id", ROOM_ID).eq("date", date);
    setBooked((data ?? []).map((r) => r.start_hour));
  }

  useEffect(() => { setHour(null); setMsg(""); load(); }, [date]);

  async function reserve() {
    if (hour === null || !name) return setMsg("時間と名前を入れてください");
    const source = new URLSearchParams(location.search).get("from"); // QRごとの流入元
    const { error } = await supabase.from("reservations")
      .insert({ room_id: ROOM_ID, date, start_hour: hour, name, school, source });
    if (error?.code === "23505") setMsg("その枠はちょうど埋まりました。別の時間を選んでください。");
    else if (error) setMsg("予約できませんでした：" + error.message);
    else { setMsg(`${date} ${hour}:00〜 の予約が完了しました！`); setHour(null); load(); }
  }

  const btn = (active: boolean, disabled: boolean) => ({
    padding: "12px 0", borderRadius: 8, border: "1px solid #ccc", fontSize: 18,
    background: disabled ? "#ddd" : active ? "#1f4e8c" : "#fff",
    color: disabled ? "#888" : active ? "#fff" : "#222",
  });

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16, fontSize: 18 }}>
      <h1 style={{ fontSize: 24 }}>十字堂楽器店 練習室予約</h1>
      <label>日付<br />
        <input type="date" value={date} min={new Date().toLocaleDateString("sv-SE")} onChange={(e) => setDate(e.target.value)}
          style={{ fontSize: 18, padding: 10, width: "100%" }} />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, margin: "16px 0" }}>
        {HOURS.map((h) => {
          const taken = booked.includes(h);
          return (
            <button key={h} disabled={taken} onClick={() => setHour(h)} style={btn(hour === h, taken)}>
              {h}:00{taken ? " 予約済" : ""}
            </button>
          );
        })}
      </div>
      <input placeholder="名前（必須）" value={name} onChange={(e) => setName(e.target.value)}
        style={{ fontSize: 18, padding: 10, width: "100%", marginBottom: 8 }} />
      <input placeholder="学校名" value={school} onChange={(e) => setSchool(e.target.value)}
        style={{ fontSize: 18, padding: 10, width: "100%", marginBottom: 12 }} />
      <button onClick={reserve} style={{ ...btn(true, false), width: "100%" }}>予約する</button>
      {msg && <p style={{ fontWeight: "bold" }}>{msg}</p>}
    </main>
  );
}
