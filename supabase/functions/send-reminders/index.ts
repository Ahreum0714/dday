// 매분 실행되는 예약 작업이 부르는 함수.
// 보낼 차례가 된 알림을 가져와서 각 사람의 기기로 웹 푸시를 보내요.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

let ready = false;
async function setup() {
  if (ready) return;
  const { data, error } = await sb.rpc("get_push_config");
  if (error) throw error;
  webpush.setVapidDetails(data.subject, data.public_key, data.private_key);
  ready = true;
}

const DAY = 86400000;
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const num = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / DAY;
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const occ = (y: number, m: number, d: number) => (m === 2 && d === 29 && !leap(y)) ? num(y, 2, 28) : num(y, m, d);
function kstDayNum(iso: string) {
  const t = new Date(new Date(iso).getTime() + 9 * 3600000);
  return num(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function fmt(n: number) {
  const t = new Date(n * DAY);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${t.getUTCFullYear()}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())} (${WD[t.getUTCDay()]})`;
}

type Due = { reminder_id: string; user_id: string; kind: string; title: string; dday_date: string; mode: string; repeat: boolean; fire_at: string };

function payload(r: Due) {
  const T = kstDayNum(r.fire_at);
  const [y, m, d] = r.dday_date.split("-").map(Number);
  const base = num(y, m, d);
  let label: string, target = base;
  if (r.mode === "count" && base <= T) {
    label = "+" + (T - base + 1).toLocaleString();
  } else {
    if (r.mode === "dday" && r.repeat && base < T) {
      const ty = new Date(T * DAY).getUTCFullYear();
      target = occ(ty, m, d);
      if (target < T) target = occ(ty + 1, m, d);
    }
    const diff = target - T;
    label = diff === 0 ? "D-DAY" : diff > 0 ? "D-" + diff.toLocaleString() : "D+" + (-diff).toLocaleString();
  }
  const lead = r.kind === "day0" ? "오늘이에요" : r.kind === "day1" ? "내일이에요" : r.kind === "day7" ? "일주일 남았어요" : "";
  const when = r.mode === "count" && base <= T ? `${fmt(base)} 시작` : fmt(target);
  return {
    title: `${r.title} ${label}`,
    body: lead ? `${lead} · ${when}` : when,
    tag: `${r.reminder_id}-${r.fire_at}`,
    url: "./",
  };
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  try {
    await setup();
    const { data: due, error } = await sb.rpc("claim_due_reminders");
    if (error) throw error;
    if (!due || !due.length) return json({ due: 0, sent: 0 });

    const users = [...new Set((due as Due[]).map((d) => d.user_id))];
    const { data: subs, error: e2 } = await sb.from("push_subscriptions")
      .select("endpoint,user_id,p256dh,auth").in("user_id", users);
    if (e2) throw e2;

    let sent = 0, removed = 0, failed = 0;
    for (const r of due as Due[]) {
      const body = JSON.stringify(payload(r));
      for (const s of (subs || []).filter((x) => x.user_id === r.user_id)) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 6 * 3600, urgency: "high" },
          );
          sent++;
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
            removed++;
          } else {
            failed++;
            console.error("push failed", code, String((err as Error).message || err));
          }
        }
      }
    }
    return json({ due: due.length, sent, removed, failed });
  } catch (err) {
    console.error(err);
    return json({ error: String((err as Error).message || err) }, 500);
  }
});
