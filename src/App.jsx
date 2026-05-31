import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// ─── Terminal palette ─────────────────────────────────────────────────────────
const T = {
  bg:      "#090c10",
  surface: "#0d1117",
  surface2:"#161b22",
  border:  "#21262d",
  border2: "#30363d",
  text:    "#e6edf3",
  muted:   "#7d8590",
  dim:     "#484f58",
  green:   "#3fb950",
  red:     "#f85149",
  yellow:  "#d29922",
  blue:    "#58a6ff",
  purple:  "#bc8cff",
  mono:    "'JetBrains Mono', monospace",
};

const FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.25 } };

// ─── Static data ──────────────────────────────────────────────────────────────
const MOCK_RESULT = {
  stats: {
    hero: "Hero",
    total_hands: 847,
    total_net_bb: -142.5,
    bb_per_100: -16.8,
    vpip_pct: 31.2,
    pfr_pct: 21.4,
    three_bet_pct: 4.1,
    wtsd_pct: 28.6,
    cbet_flop_pct: 48.3,
    positions: {
      BTN: { hands: 142, bb_per_100: 12.4, vpip_pct: 48, pfr_pct: 38 },
      CO:  { hands: 138, bb_per_100: 3.1,  vpip_pct: 35, pfr_pct: 26 },
      HJ:  { hands: 141, bb_per_100: -4.2, vpip_pct: 27, pfr_pct: 19 },
      UTG: { hands: 139, bb_per_100: -8.7, vpip_pct: 18, pfr_pct: 13 },
      SB:  { hands: 143, bb_per_100: -22.1, vpip_pct: 38, pfr_pct: 14 },
      BB:  { hands: 144, bb_per_100: -11.3, vpip_pct: 42, pfr_pct: 8  },
    },
    losses_by_street: { preflop: -18.2, flop: -44.1, turn: -62.3, river: -17.9 },
  },
  analysis: {
    player_type: "Лузпассив с агрессией на поздних позициях",
    overall_assessment: "У тебя сильный BTN, но ты теряешь почти всё на SB и BB из-за чрезмерного колла на дефенсе. Слабая c-bet частота намекает на пассивность на постфлопе — ты позволяешь оппонентам реализовывать equity бесплатно.",
    leaks: [
      { rank: 1, title: "Слабая защита блайндов", severity: "high",
        explanation: "SB показывает -22 BB/100 — это катастрофа. VPIP 38% при PFR 14% означает ты коллируешь рейзы с рукой которую не умеешь играть постфлоп OOP. Это твой крупнейший источник потерь.",
        fix: "Сократи колл-диапазон на SB до 15-18% лучших рук. Всё остальное — либо 3-бет, либо фолд. Перестань быть коллинг-стейшн из позиции малого блайнда." },
      { rank: 2, title: "CBet флоп 48% — слишком низко", severity: "high",
        explanation: "Регуляр делает c-bet 58-65%. Ты делаешь на 15% реже — это значит ты проверяешь борды где должен давить. Оппоненты это замечают и атакуют твои чеки.",
        fix: "На сухих бордах (A72r, K83r) делай автоматический c-bet 75% от пота независимо от своих карт. Ты в позиции рейзера — у тебя range advantage." },
      { rank: 3, title: "3-bet 4.1% — оставляешь деньги на столе", severity: "medium",
        explanation: "Норма рега 6-8%. Ты ререйзишь слишком редко, что делает твой диапазон предсказуемым и позволяет оппонентам открываться широко против тебя.",
        fix: "Добавь блефовые 3-беты: A2s-A5s и руки типа K9s с BTN/CO против открытия EP. Это сделает твой диапазон непрозрачным и заставит оппонентов платить за кражи." },
    ],
    top_priority: "Исправь игру на SB — сократи колл-диапазон и перейди на стратегию 3-бет-или-фолд.",
  },
};

const SEVERITY = {
  high:   { label: "CRITICAL", color: T.red    },
  medium: { label: "MEDIUM",   color: T.yellow },
  low:    { label: "LOW",      color: T.green  },
};

const POS_ORDER = ["BTN","CO","HJ","UTG","SB","BB"];

// ─── Shared primitives ────────────────────────────────────────────────────────

const HR = ({ my = 16 }) => (
  <div style={{ borderTop: `1px solid ${T.border}`, margin: `${my}px 0` }} />
);

const Label = ({ children, color = T.muted }) => (
  <span style={{ fontFamily: T.mono, fontSize: 11, color, letterSpacing: "0.08em" }}>
    {children}
  </span>
);

const inputCss = {
  width: "100%", boxSizing: "border-box",
  background: T.bg, border: `1px solid ${T.border2}`,
  color: T.text, fontFamily: T.mono, fontSize: 13,
  padding: "8px 10px", outline: "none",
  borderRadius: 3, transition: "border-color 0.15s",
};

// ─── Stats table ──────────────────────────────────────────────────────────────

function StatsTable({ stats }) {
  const rows = [
    { key: "VPIP",      value: stats.vpip_pct,      norm: [22, 28] },
    { key: "PFR",       value: stats.pfr_pct,       norm: [18, 24] },
    { key: "3-BET",     value: stats.three_bet_pct, norm: [6, 10]  },
    { key: "WTSD",      value: stats.wtsd_pct,      norm: [24, 30] },
    { key: "CBET FLOP", value: stats.cbet_flop_pct, norm: [55, 70] },
  ];

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: T.mono }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${T.border}` }}>
          {["METRIC","VALUE","BENCHMARK","STATUS"].map(h => (
            <th key={h} style={{ textAlign: "left", padding: "5px 10px", fontSize: 10, color: T.dim, fontWeight: 400, letterSpacing: "0.08em" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, value, norm }) => {
          const inNorm = value >= norm[0] && value <= norm[1];
          const isHigh = value > norm[1];
          const statusColor = inNorm ? T.green : isHigh ? T.yellow : T.red;
          const statusText  = inNorm ? "✓ OK" : isHigh ? "▲ HIGH" : "▼ LOW";
          return (
            <tr key={key} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td style={{ padding: "7px 10px", fontSize: 11, color: T.muted, letterSpacing: "0.05em" }}>{key}</td>
              <td style={{ padding: "7px 10px", fontSize: 13, color: T.text, fontWeight: 700 }}>{value}%</td>
              <td style={{ padding: "7px 10px", fontSize: 12, color: T.dim }}>{norm[0]}–{norm[1]}%</td>
              <td style={{ padding: "7px 10px", fontSize: 12, color: statusColor, fontWeight: 700 }}>{statusText}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Positions table ──────────────────────────────────────────────────────────

function PositionsTable({ positions }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: T.mono }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${T.border}` }}>
          {["POS","HANDS","BB/100","VPIP","PFR"].map(h => (
            <th key={h} style={{ textAlign: "left", padding: "5px 10px", fontSize: 10, color: T.dim, fontWeight: 400, letterSpacing: "0.08em" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {POS_ORDER.filter(p => positions[p]).map(pos => {
          const d = positions[pos];
          const isLoss    = d.bb_per_100 < 0;
          const isBigLoss = d.bb_per_100 < -10;
          return (
            <tr key={pos} style={{
              borderBottom: `1px solid ${T.border}`,
              background: isBigLoss ? "rgba(248,81,73,0.05)" : "transparent",
            }}>
              <td style={{ padding: "7px 10px", fontSize: 11, color: T.muted, letterSpacing: "0.08em" }}>{pos}</td>
              <td style={{ padding: "7px 10px", fontSize: 13, color: T.muted }}>{d.hands}</td>
              <td style={{ padding: "7px 10px", fontSize: 13, fontWeight: 700, color: isLoss ? T.red : T.green }}>
                {d.bb_per_100 >= 0 ? "+" : ""}{d.bb_per_100.toFixed(1)}
                {d.bb_per_100 < -10 ? " ▼▼" : d.bb_per_100 < 0 ? " ▼" : ""}
              </td>
              <td style={{ padding: "7px 10px", fontSize: 12, color: T.muted }}>{d.vpip_pct}%</td>
              <td style={{ padding: "7px 10px", fontSize: 12, color: T.muted }}>{d.pfr_pct}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Street loss bars ─────────────────────────────────────────────────────────

function StreetBars({ losses }) {
  const streets = ["preflop","flop","turn","river"];
  const labels  = { preflop: "PREFLOP", flop: "FLOP   ", turn: "TURN   ", river: "RIVER  " };
  const maxAbs  = Math.max(...streets.map(s => Math.abs(losses[s] || 0)), 1);
  const W = 20;

  return (
    <div style={{ fontFamily: T.mono }}>
      {streets.map(s => {
        const val    = losses[s] || 0;
        const filled = Math.round(Math.abs(val) / maxAbs * W);
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
            <span style={{ fontSize: 10, color: T.muted, letterSpacing: "0.06em", minWidth: 56 }}>
              {labels[s]}
            </span>
            <span style={{ fontSize: 13, letterSpacing: "-0.5px", userSelect: "none" }}>
              <span style={{ color: T.red }}>{"█".repeat(filled)}</span>
              <span style={{ color: T.border2 }}>{"░".repeat(W - filled)}</span>
            </span>
            <span style={{ fontSize: 12, color: T.red, minWidth: 64, textAlign: "right" }}>
              {val.toFixed(1)} BB
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Leak section ─────────────────────────────────────────────────────────────

function LeakSection({ leak }) {
  const cfg = SEVERITY[leak.severity];
  return (
    <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 14, paddingBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>#{leak.rank}</span>
        <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: T.text }}>
          {leak.title.toUpperCase()}
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: cfg.color, letterSpacing: "0.04em" }}>
          [{cfg.label}]
        </span>
      </div>
      <p style={{ fontFamily: T.mono, fontSize: 12, color: T.muted, lineHeight: 1.7, margin: "0 0 10px" }}>
        {leak.explanation}
      </p>
      <div style={{
        background: "rgba(88,166,255,0.05)",
        borderLeft: `2px solid ${T.blue}`,
        padding: "8px 12px",
      }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.blue, fontWeight: 700, letterSpacing: "0.04em" }}>FIX → </span>
        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.text, lineHeight: 1.7 }}>{leak.fix}</span>
      </div>
    </div>
  );
}

// ─── Upload ────────────────────────────────────────────────────────────────────

function UploadView({ onAnalyze }) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile]         = useState(null);
  const [heroName, setHeroName] = useState("");
  const inputRef = useRef();
  const canSubmit = file && heroName.trim();

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  return (
    <motion.div {...FADE} style={{ maxWidth: 560, padding: "0 20px", fontFamily: T.mono }}>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 4 }}>
          POKER LEAK FINDER{" "}
          <span style={{ fontSize: 13, color: T.dim, fontWeight: 400 }}>v1.0</span>
        </div>
        <div style={{ fontSize: 11, color: T.dim, letterSpacing: "0.06em" }}>
          Анализ hand history · NL Cash · 6-max
        </div>
      </div>

      <HR my={0} />

      <div style={{ paddingTop: 20, marginBottom: 16 }}>
        <Label>файл hand history (.txt)</Label>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current.click()}
          style={{
            marginTop: 6,
            border: `1px dashed ${dragging ? T.blue : file ? T.border2 : T.border}`,
            borderRadius: 3,
            padding: "14px 16px",
            cursor: "pointer",
            background: dragging ? "rgba(88,166,255,0.04)" : T.bg,
            transition: "border-color 0.15s",
          }}>
          <input ref={inputRef} type="file" accept=".txt" style={{ display: "none" }}
            onChange={e => setFile(e.target.files[0])} />
          {file ? (
            <span style={{ fontSize: 13, color: T.green }}>
              ✓ {file.name}{" "}
              <span style={{ color: T.dim }}>({(file.size / 1024).toFixed(0)} KB)</span>
            </span>
          ) : (
            <span style={{ fontSize: 12, color: T.muted }}>
              перетащи файл или нажми для выбора
            </span>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Label>никнейм</Label>
        <input
          value={heroName}
          onChange={e => setHeroName(e.target.value)}
          placeholder="твой ник в покер-руме"
          style={{ ...inputCss, marginTop: 6 }}
          onFocus={e => e.target.style.borderColor = T.blue}
          onBlur={e => e.target.style.borderColor = T.border2}
          onKeyDown={e => e.key === "Enter" && canSubmit && onAnalyze(file, heroName)}
        />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          onClick={() => canSubmit && onAnalyze(file, heroName)}
          disabled={!canSubmit}
          style={{
            fontFamily: T.mono, fontSize: 13, fontWeight: 700,
            padding: "8px 18px",
            background: "transparent",
            border: `1px solid ${canSubmit ? T.border2 : T.border}`,
            color: canSubmit ? T.text : T.dim,
            cursor: canSubmit ? "pointer" : "not-allowed",
            borderRadius: 3, letterSpacing: "0.06em",
            transition: "border-color 0.15s",
          }}
          onMouseEnter={e => { if (canSubmit) e.target.style.borderColor = T.blue; }}
          onMouseLeave={e => { if (canSubmit) e.target.style.borderColor = T.border2; }}
        >
          ANALYZE
        </button>
        <button
          onClick={() => onAnalyze(null, "Demo")}
          style={{
            background: "none", border: "none",
            fontFamily: T.mono, fontSize: 12, color: T.dim,
            cursor: "pointer", letterSpacing: "0.04em",
          }}>
          или демо →
        </button>
      </div>

      <HR my={20} />

      <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.8, letterSpacing: "0.04em" }}>
        Будет найдено: leak-и · результат по позициям · BB/100 · советы
      </div>
    </motion.div>
  );
}

// ─── Result ────────────────────────────────────────────────────────────────────

function ResultView({ result, onBack }) {
  const { stats, analysis } = result;
  const wrColor = stats.bb_per_100 >= 0 ? T.green : T.red;

  return (
    <motion.div {...FADE} style={{ maxWidth: 900, padding: "0 20px", fontFamily: T.mono }}>

      {/* Status bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button onClick={onBack} style={{
            background: "none", border: `1px solid ${T.border}`,
            color: T.muted, fontFamily: T.mono, fontSize: 12,
            padding: "4px 10px", cursor: "pointer", borderRadius: 3,
          }}>← back</button>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
            [{stats.hero.toUpperCase()}]
          </span>
          <span style={{ fontSize: 12, color: T.muted }}>
            {stats.total_hands} hands · 6-max
          </span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: wrColor }}>
          winrate: {stats.bb_per_100 >= 0 ? "+" : ""}{stats.bb_per_100} BB/100{" "}
          {stats.bb_per_100 >= 0 ? "▲" : "▼"}
        </div>
      </div>

      <HR my={0} />

      {/* Two-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginTop: 16 }}>

        {/* Left column */}
        <div style={{ borderRight: `1px solid ${T.border}`, paddingRight: 24 }}>

          {/* Stats table */}
          <Label>КЛЮЧЕВЫЕ СТАТЫ</Label>
          <div style={{ marginTop: 8, marginBottom: 20 }}>
            <StatsTable stats={stats} />
          </div>

          {/* Assessment */}
          <Label>ОБЩАЯ ОЦЕНКА</Label>
          <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.7, margin: "8px 0 0" }}>
            {analysis.overall_assessment}
          </p>
        </div>

        {/* Right column */}
        <div style={{ paddingLeft: 24 }}>

          {/* Street losses */}
          <Label>ПОТЕРИ ПО УЛИЦАМ</Label>
          <div style={{ marginTop: 10, marginBottom: 20 }}>
            <StreetBars losses={stats.losses_by_street} />
          </div>

          {/* Positions */}
          <Label>РЕЗУЛЬТАТ ПО ПОЗИЦИЯМ</Label>
          <div style={{ marginTop: 8 }}>
            <PositionsTable positions={stats.positions} />
          </div>
        </div>
      </div>

      <HR my={20} />

      {/* Leaks */}
      <Label>АНАЛИЗ LEAK-ОВ</Label>
      <div style={{ marginTop: 4 }}>
        {analysis.leaks.map((leak, i) => <LeakSection key={i} leak={leak} />)}
      </div>

      {/* Priority */}
      <HR my={0} />
      <div style={{ padding: "12px 0", fontSize: 13, color: T.text }}>
        <span style={{ color: T.blue, fontWeight: 700 }}>▶ ПРИОРИТЕТ #1: </span>
        {analysis.top_priority}
      </div>
    </motion.div>
  );
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

function AuthView({ onSuccess }) {
  const [tab, setTab]       = useState("login");
  const [email, setEmail]   = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError("");
    if (!email || !password) { setError("заполни все поля"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/${tab}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "ошибка"); return; }
      onSuccess(data.token, data.email);
    } catch {
      setError("нет соединения с сервером");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div {...FADE} style={{ maxWidth: 380, padding: "0 20px", fontFamily: T.mono }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>
          POKER LEAK FINDER{" "}
          <span style={{ fontSize: 12, color: T.dim, fontWeight: 400 }}>v1.0</span>
        </div>
      </div>

      <HR my={0} />

      <div style={{ display: "flex", gap: 0, marginTop: 16, marginBottom: 20, borderBottom: `1px solid ${T.border}` }}>
        {["login","register"].map(t => (
          <button key={t} onClick={() => { setTab(t); setError(""); }}
            style={{
              background: "none", border: "none",
              borderBottom: `2px solid ${tab === t ? T.blue : "transparent"}`,
              color: tab === t ? T.text : T.muted,
              fontFamily: T.mono, fontSize: 12, fontWeight: tab === t ? 700 : 400,
              padding: "8px 14px", cursor: "pointer",
              letterSpacing: "0.06em", marginBottom: -1,
            }}>
            {t === "login" ? "LOGIN" : "REGISTER"}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <Label>email</Label>
        <input value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com" type="email"
          style={{ ...inputCss, marginTop: 5 }}
          onFocus={e => e.target.style.borderColor = T.blue}
          onBlur={e => e.target.style.borderColor = T.border2}
          onKeyDown={e => e.key === "Enter" && submit()} />
      </div>

      <div style={{ marginBottom: error ? 10 : 16 }}>
        <Label>password</Label>
        <input value={password} onChange={e => setPassword(e.target.value)}
          placeholder="••••••••" type="password"
          style={{ ...inputCss, marginTop: 5 }}
          onFocus={e => e.target.style.borderColor = T.blue}
          onBlur={e => e.target.style.borderColor = T.border2}
          onKeyDown={e => e.key === "Enter" && submit()} />
      </div>

      {error && (
        <div style={{ fontSize: 12, color: T.red, marginBottom: 12 }}>
          error: {error}
        </div>
      )}

      <button onClick={submit} disabled={loading}
        style={{
          fontFamily: T.mono, fontSize: 13, fontWeight: 700,
          padding: "8px 18px",
          background: "transparent",
          border: `1px solid ${T.border2}`,
          color: T.text, cursor: loading ? "wait" : "pointer",
          borderRadius: 3, letterSpacing: "0.06em",
        }}
        onMouseEnter={e => e.target.style.borderColor = T.blue}
        onMouseLeave={e => e.target.style.borderColor = T.border2}>
        {loading ? "..." : tab === "login" ? "LOGIN" : "REGISTER"}
      </button>
    </motion.div>
  );
}

// ─── History ───────────────────────────────────────────────────────────────────

function HistoryView({ token, onSelect, onBack }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setItems).catch(() => setItems([]));
  }, [token]);

  return (
    <motion.div {...FADE} style={{ maxWidth: 700, padding: "0 20px", fontFamily: T.mono }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <button onClick={onBack} style={{
          background: "none", border: `1px solid ${T.border}`,
          color: T.muted, fontFamily: T.mono, fontSize: 12,
          padding: "4px 10px", cursor: "pointer", borderRadius: 3,
        }}>← back</button>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: "0.04em" }}>
          ИСТОРИЯ АНАЛИЗОВ
        </span>
      </div>

      <HR my={0} />

      {items === null && (
        <div style={{ color: T.muted, fontSize: 12, padding: "20px 0" }}>loading...</div>
      )}
      {items?.length === 0 && (
        <div style={{ color: T.muted, fontSize: 12, padding: "20px 0" }}>анализов пока нет</div>
      )}

      {items && items.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              {["NICK","HANDS","BB/100","ТИП","ДАТА"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "5px 10px", fontSize: 10, color: T.dim, fontWeight: 400, letterSpacing: "0.08em" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id}
                onClick={() => onSelect({ stats: item.stats, analysis: item.analysis })}
                style={{ borderBottom: `1px solid ${T.border}`, cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = T.surface2}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "8px 10px", fontSize: 13, color: T.text, fontWeight: 700 }}>{item.hero_name}</td>
                <td style={{ padding: "8px 10px", fontSize: 12, color: T.muted }}>{item.hands_parsed}</td>
                <td style={{ padding: "8px 10px", fontSize: 13, fontWeight: 700, color: item.bb_per_100 >= 0 ? T.green : T.red }}>
                  {item.bb_per_100 >= 0 ? "+" : ""}{item.bb_per_100?.toFixed(1)}
                </td>
                <td style={{ padding: "8px 10px", fontSize: 11, color: T.muted }}>{item.player_type}</td>
                <td style={{ padding: "8px 10px", fontSize: 11, color: T.dim }}>
                  {new Date(item.created_at).toLocaleDateString("ru-RU")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </motion.div>
  );
}

// ─── Paywall ───────────────────────────────────────────────────────────────────

function PaywallView({ token, onBack, onSubscribed }) {
  const [iid, setIid]           = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError]       = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/payment/widget-config`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => setIid(d.iid || ""))
      .catch(() => {});
  }, [token]);

  const confirm = async () => {
    setConfirming(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/api/payment/confirm`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setError("ошибка подтверждения"); return; }
      setConfirmed(true);
      setTimeout(() => onSubscribed?.(), 1500);
    } catch {
      setError("нет соединения с сервером");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <motion.div {...FADE} style={{ maxWidth: 460, padding: "0 20px", fontFamily: T.mono }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.red, marginBottom: 4, letterSpacing: "0.04em" }}>
          ACCESS REQUIRED
        </div>
        <div style={{ fontSize: 12, color: T.muted }}>
          бесплатный анализ использован · оплати для продолжения
        </div>
      </div>

      <HR my={0} />

      <div style={{ marginTop: 12, marginBottom: 4 }}>
        <div style={{ fontSize: 10, color: T.dim, letterSpacing: "0.08em", marginBottom: 8 }}>
          ОПЛАТА · USDT / BTC / ETH / TON / и другие
        </div>

        {confirmed ? (
          <div style={{
            padding: "20px", border: `1px solid ${T.green}`,
            background: "rgba(63,185,80,0.05)", borderRadius: 3,
            fontSize: 13, color: T.green, textAlign: "center",
          }}>
            ✓ оплата подтверждена · подписка активирована
          </div>
        ) : (
          <>
            {iid ? (
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 3, overflow: "hidden" }}>
                <iframe
                  src={`https://nowpayments.io/embeds/payment-widget?iid=${iid}`}
                  width="100%"
                  height="500"
                  frameBorder="0"
                  scrolling="no"
                  style={{ display: "block", background: T.surface }}
                  title="NOWPayments"
                >
                  загрузка виджета...
                </iframe>
              </div>
            ) : (
              <div style={{
                padding: "20px", border: `1px dashed ${T.border2}`,
                borderRadius: 3, fontSize: 12, color: T.muted, textAlign: "center",
              }}>
                виджет оплаты не настроен ·{" "}
                <span style={{ color: T.dim }}>добавь NOWPAYMENTS_WIDGET_IID в .env</span>
              </div>
            )}

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>
                после оплаты нажми кнопку ниже чтобы активировать аккаунт
              </div>

              {error && (
                <div style={{ fontSize: 12, color: T.red, marginBottom: 8 }}>error: {error}</div>
              )}

              <button
                onClick={confirm}
                disabled={confirming}
                style={{
                  fontFamily: T.mono, fontSize: 12, fontWeight: 700,
                  padding: "8px 18px",
                  background: "transparent",
                  border: `1px solid ${T.green}`,
                  color: T.green,
                  cursor: confirming ? "wait" : "pointer", borderRadius: 3,
                  letterSpacing: "0.06em",
                }}
                onMouseEnter={e => e.target.style.background = "rgba(63,185,80,0.06)"}
                onMouseLeave={e => e.target.style.background = "transparent"}
              >
                {confirming ? "..." : "✓ Я ОПЛАТИЛ — АКТИВИРОВАТЬ"}
              </button>
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={onBack} style={{
          background: "none", border: "none",
          fontFamily: T.mono, fontSize: 12, color: T.dim,
          cursor: "pointer", letterSpacing: "0.04em",
        }}>← вернуться назад</button>
      </div>
    </motion.div>
  );
}

// ─── Loading ───────────────────────────────────────────────────────────────────

function LoadingView() {
  const steps = [
    "> parsing hand history...",
    "> computing statistics...",
    "> analyzing leaks...",
    "> preparing report...",
  ];
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setStep(s => Math.min(s + 1, steps.length - 1)), 900);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ padding: "40px 20px", fontFamily: T.mono }}>
      {steps.slice(0, step + 1).map((s, i) => (
        <div key={i} style={{
          fontSize: 13, marginBottom: 6,
          color: i === step ? T.text : T.dim,
        }}>
          {s}{i === step ? <span style={{ animation: "blink 1s infinite" }}> ▌</span> : " ✓"}
        </div>
      ))}
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [token, setToken]         = useState(() => localStorage.getItem("token") || "");
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem("userEmail") || "");
  const [view, setView]           = useState(() => localStorage.getItem("token") ? "upload" : "auth");
  const [result, setResult]       = useState(null);

  useEffect(() => {
    localStorage.setItem("token", token);
    localStorage.setItem("userEmail", userEmail);
  }, [token, userEmail]);

  const handleAuthSuccess = (t, email) => { setToken(t); setUserEmail(email); setView("upload"); };
  const handleLogout      = () => { setToken(""); setUserEmail(""); setView("auth"); };

  const handleAnalyze = async (file, heroName) => {
    if (!file) { setResult(MOCK_RESULT); setView("result"); return; }
    setView("loading");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("hero_name", heroName);
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST", body: formData,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 402) { setView("paywall"); return; }
      if (!res.ok) throw new Error("ошибка сервера");
      const data = await res.json();
      setResult(data);
      setView("result");
    } catch (e) {
      alert("error: " + e.message);
      setView("upload");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: T.mono }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{`* { box-sizing: border-box; } @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>

      {/* Nav */}
      {view !== "auth" && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "10px 20px", borderBottom: `1px solid ${T.border}`,
        }}>
          <button onClick={() => setView("upload")} style={{
            background: "none", border: "none",
            fontFamily: T.mono, fontSize: 13, fontWeight: 700,
            color: T.text, cursor: "pointer", letterSpacing: "0.04em",
          }}>
            LEAKFINDER
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, color: T.dim }}>{userEmail}</span>
            {["История","Выйти"].map((label, i) => (
              <button key={label}
                onClick={i === 0 ? () => setView("history") : handleLogout}
                style={{
                  background: "none", border: `1px solid ${T.border}`,
                  fontFamily: T.mono, fontSize: 11, color: T.muted,
                  padding: "4px 10px", cursor: "pointer", borderRadius: 3,
                  letterSpacing: "0.06em",
                }}
                onMouseEnter={e => e.target.style.borderColor = T.border2}
                onMouseLeave={e => e.target.style.borderColor = T.border}>
                {label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: "32px 0 60px" }}>
        <AnimatePresence mode="wait">
          {view === "auth"    && <AuthView    key="auth" onSuccess={handleAuthSuccess} />}
          {view === "upload"  && <UploadView  key="up"   onAnalyze={handleAnalyze} />}
          {view === "loading" && <LoadingView key="ld" />}
          {view === "result"  && <ResultView  key="rs"   result={result} onBack={() => setView("upload")} />}
          {view === "paywall" && <PaywallView key="pw"   token={token} onBack={() => setView("upload")} onSubscribed={() => setView("upload")} />}
          {view === "history" && (
            <HistoryView key="hist" token={token}
              onSelect={r => { setResult(r); setView("result"); }}
              onBack={() => setView("upload")}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
