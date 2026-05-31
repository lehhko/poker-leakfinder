import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

const SUITS = ["♠", "♥", "♦", "♣"];

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
      SB:  { hands: 143, bb_per_100: -22.1,vpip_pct: 38, pfr_pct: 14 },
      BB:  { hands: 144, bb_per_100: -11.3,vpip_pct: 42, pfr_pct: 8  },
    },
    losses_by_street: { preflop: -18.2, flop: -44.1, turn: -62.3, river: -17.9 },
  },
  analysis: {
    player_type: "Лузпассив с агрессией на поздних позициях",
    overall_assessment: "У тебя сильный BTN, но ты теряешь почти всё на SB и BB из-за чрезмерного колла на дефенсе. Слабая c-bet частота намекает на пассивность на постфлопе — ты позволяешь оппонентам реализовывать equity бесплатно.",
    leaks: [
      {
        rank: 1,
        title: "Слабая защита блайндов",
        explanation: "SB показывает -22 BB/100 — это катастрофа. VPIP 38% при PFR 14% означает ты коллируешь рейзы с рукой которую не умеешь играть постфлоп OOP. Это твой крупнейший источник потерь.",
        fix: "Сократи колл-диапазон на SB до 15-18% лучших рук. Всё остальное — либо 3-бет, либо фолд. Перестань быть коллинг-стейшн из позиции малого блайнда.",
        severity: "high"
      },
      {
        rank: 2,
        title: "CBet флоп 48% — слишком низко",
        explanation: "Регуляр делает c-bet 58-65%. Ты делаешь на 15% реже — это значит ты проверяешь борды где должен давить. Оппоненты это замечают и атакуют твои чеки.",
        fix: "На сухих бордах (A72r, K83r) делай автоматический c-bet 75% от пота независимо от своих карт. Ты в позиции рейзера — у тебя range advantage.",
        severity: "high"
      },
      {
        rank: 3,
        title: "3-bet 4.1% — оставляешь деньги на столе",
        explanation: "Норма рега 6-8%. Ты ререйзишь слишком редко, что делает твой диапазон предсказуемым и позволяет оппонентам открываться широко против тебя.",
        fix: "Добавь блефовые 3-беты: A2s-A5s и руки типа K9s с BTN/CO против открытия EP. Это сделает твой диапазон непрозрачным и заставит оппонентов платить за кражи.",
        severity: "medium"
      }
    ],
    top_priority: "Исправь игру на SB — сократи колл-диапазон и перейди на стратегию 3-бет-или-фолд."
  }
};

const SEVERITY_CONFIG = {
  high:   { label: "критично", color: "#e05252", bg: "rgba(224,82,82,0.08)"   },
  medium: { label: "важно",    color: "#d4884a", bg: "rgba(212,136,74,0.08)"  },
  low:    { label: "заметно",  color: "#7ab87a", bg: "rgba(122,184,122,0.08)" },
};

const POS_ORDER = ["BTN","CO","HJ","UTG","SB","BB"];

function SuitPattern() {
  return (
    <div style={{
      position:"absolute", inset:0, overflow:"hidden", pointerEvents:"none", opacity:0.03
    }}>
      {Array.from({length: 80}).map((_,i) => (
        <span key={i} style={{
          position:"absolute",
          left: `${(i * 137.5) % 100}%`,
          top:  `${(i * 97.3)  % 100}%`,
          fontSize: `${14 + (i % 3) * 8}px`,
          color: "#c9a84c",
          transform: `rotate(${(i * 45) % 360}deg)`,
          fontFamily: "serif",
        }}>{SUITS[i % 4]}</span>
      ))}
    </div>
  );
}

function StatBar({ label, value, min, max, norm }) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const normLow  = ((norm[0] - min) / (max - min)) * 100;
  const normHigh = ((norm[1] - min) / (max - min)) * 100;
  const inNorm = value >= norm[0] && value <= norm[1];

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span style={{ fontSize:12, color:"#8a8070", letterSpacing:"0.06em", textTransform:"uppercase" }}>{label}</span>
        <span style={{
          fontSize:13, fontWeight:600,
          color: inNorm ? "#c9a84c" : "#e05252",
          fontFamily:"'DM Mono', monospace"
        }}>{value}%</span>
      </div>
      <div style={{ height:6, background:"rgba(255,255,255,0.06)", borderRadius:3, position:"relative" }}>
        <div style={{
          position:"absolute", left:`${normLow}%`, width:`${normHigh - normLow}%`,
          height:"100%", background:"rgba(201,168,76,0.15)", borderRadius:3
        }}/>
        <motion.div
          initial={{ width:0 }}
          animate={{ width:`${pct}%` }}
          transition={{ duration:1, ease:"easeOut", delay: 0.3 }}
          style={{
            height:"100%", borderRadius:3,
            background: inNorm ? "#c9a84c" : "#e05252",
          }}
        />
        <div style={{
          position:"absolute", top:-2, left:`${pct}%`, transform:"translateX(-50%)",
          width:10, height:10, borderRadius:"50%",
          background: inNorm ? "#c9a84c" : "#e05252",
          border:"2px solid #1a1610",
        }}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
        <span style={{ fontSize:10, color:"#4a4540" }}>{min}%</span>
        <span style={{ fontSize:10, color:"#5a5245" }}>норма {norm[0]}–{norm[1]}%</span>
        <span style={{ fontSize:10, color:"#4a4540" }}>{max}%</span>
      </div>
    </div>
  );
}

function PositionGrid({ positions }) {
  const maxAbs = Math.max(...Object.values(positions).map(p => Math.abs(p.bb_per_100)));
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
      {POS_ORDER.filter(p => positions[p]).map((pos, i) => {
        const d = positions[pos];
        const isPos = d.bb_per_100 >= 0;
        const intensity = Math.abs(d.bb_per_100) / maxAbs;
        return (
          <motion.div key={pos}
            initial={{ opacity:0, y:10 }}
            animate={{ opacity:1, y:0 }}
            transition={{ delay: i * 0.07 }}
            style={{
              padding:"12px 10px",
              background: isPos
                ? `rgba(122,184,122,${0.04 + intensity * 0.08})`
                : `rgba(224,82,82,${0.04 + intensity * 0.08})`,
              border: `1px solid ${isPos ? "rgba(122,184,122,0.2)" : "rgba(224,82,82,0.2)"}`,
              borderRadius:8,
              textAlign:"center",
            }}
          >
            <div style={{ fontSize:11, color:"#8a8070", letterSpacing:"0.1em", marginBottom:4 }}>{pos}</div>
            <div style={{
              fontSize:16, fontWeight:700,
              color: isPos ? "#7ab87a" : "#e05252",
              fontFamily:"'DM Mono', monospace"
            }}>
              {isPos ? "+" : ""}{d.bb_per_100.toFixed(1)}
            </div>
            <div style={{ fontSize:10, color:"#5a5245", marginTop:2 }}>BB/100</div>
            <div style={{ fontSize:10, color:"#6a6055", marginTop:4 }}>
              {d.hands} раздач
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function LeakCard({ leak, index }) {
  const [open, setOpen] = useState(index === 0);
  const cfg = SEVERITY_CONFIG[leak.severity];

  return (
    <motion.div
      initial={{ opacity:0, x:-20 }}
      animate={{ opacity:1, x:0 }}
      transition={{ delay: index * 0.12 }}
      style={{
        border:`1px solid rgba(255,255,255,0.08)`,
        borderLeft:`3px solid ${cfg.color}`,
        borderRadius:"0 8px 8px 0",
        marginBottom:10,
        background:"rgba(255,255,255,0.02)",
        overflow:"hidden",
        cursor:"pointer",
      }}
      onClick={() => setOpen(o => !o)}
    >
      <div style={{ padding:"14px 16px", display:"flex", alignItems:"center", gap:12 }}>
        <div style={{
          width:28, height:28, borderRadius:"50%",
          background: cfg.bg,
          border:`1px solid ${cfg.color}`,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:13, fontWeight:700, color:cfg.color,
          flexShrink:0, fontFamily:"'DM Mono', monospace"
        }}>{leak.rank}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:600, color:"#e8dfc8", marginBottom:2 }}>{leak.title}</div>
          <div style={{ fontSize:11, color:cfg.color, letterSpacing:"0.05em" }}>
            {cfg.label.toUpperCase()}
          </div>
        </div>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          style={{ color:"#5a5245", fontSize:12 }}
        >▾</motion.div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height:0, opacity:0 }}
            animate={{ height:"auto", opacity:1 }}
            exit={{ height:0, opacity:0 }}
            transition={{ duration:0.2 }}
          >
            <div style={{ padding:"0 16px 16px", borderTop:"1px solid rgba(255,255,255,0.05)" }}>
              <p style={{ fontSize:13, color:"#8a8070", lineHeight:1.7, margin:"12px 0 10px" }}>
                {leak.explanation}
              </p>
              <div style={{
                background:"rgba(201,168,76,0.06)",
                border:"1px solid rgba(201,168,76,0.15)",
                borderRadius:6, padding:"10px 12px"
              }}>
                <div style={{ fontSize:10, color:"#c9a84c", letterSpacing:"0.1em", marginBottom:5 }}>
                  ЧТО ДЕЛАТЬ
                </div>
                <p style={{ fontSize:13, color:"#c8c0a8", lineHeight:1.7, margin:0 }}>
                  {leak.fix}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StreetLossBar({ losses }) {
  const streets = ["preflop","flop","turn","river"];
  const labels = { preflop:"Префлоп", flop:"Флоп", turn:"Терн", river:"Ривер" };
  const maxLoss = Math.max(...streets.map(s => Math.abs(losses[s] || 0)));

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {streets.map((s, i) => {
        const val = losses[s] || 0;
        const pct = maxLoss > 0 ? Math.abs(val) / maxLoss * 100 : 0;
        const isLoss = val < 0;
        return (
          <div key={s} style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ width:60, fontSize:11, color:"#8a8070", textAlign:"right" }}>{labels[s]}</span>
            <div style={{ flex:1, height:8, background:"rgba(255,255,255,0.04)", borderRadius:4 }}>
              <motion.div
                initial={{ width:0 }}
                animate={{ width:`${pct}%` }}
                transition={{ duration:0.8, delay: i * 0.1 }}
                style={{
                  height:"100%", borderRadius:4,
                  background: isLoss ? "#e05252" : "#7ab87a"
                }}
              />
            </div>
            <span style={{
              width:52, fontSize:12, fontFamily:"'DM Mono', monospace",
              color: isLoss ? "#e05252" : "#7ab87a", textAlign:"right"
            }}>{val > 0 ? "+" : ""}{val.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}

function UploadView({ onAnalyze }) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState(null);
  const [heroName, setHeroName] = useState("");
  const inputRef = useRef();

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  return (
    <div style={{ maxWidth:520, margin:"0 auto", padding:"0 16px" }}>
      <motion.div
        initial={{ opacity:0, y:30 }}
        animate={{ opacity:1, y:0 }}
        transition={{ duration:0.6 }}
      >
        <div style={{ textAlign:"center", marginBottom:48 }}>
          <div style={{ fontSize:40, letterSpacing:"-0.02em", marginBottom:12 }}>
            <span style={{ color:"#c9a84c" }}>♠</span>
            <span style={{ color:"#e8dfc8", margin:"0 8px" }}>Leak</span>
            <span style={{ color:"#c9a84c" }}>finder</span>
          </div>
          <p style={{ color:"#8a8070", fontSize:14, lineHeight:1.6, maxWidth:380, margin:"0 auto" }}>
            Загрузи историю игр с PokerStars — узнай где именно теряешь деньги. Разбор за 30 секунд.
          </p>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current.click()}
          style={{
            border: `2px dashed ${dragging ? "#c9a84c" : file ? "rgba(201,168,76,0.4)" : "rgba(255,255,255,0.1)"}`,
            borderRadius:16,
            padding:"40px 24px",
            textAlign:"center",
            cursor:"pointer",
            background: dragging ? "rgba(201,168,76,0.05)" : "rgba(255,255,255,0.02)",
            transition:"all 0.2s",
            marginBottom:20,
          }}
        >
          <input ref={inputRef} type="file" accept=".txt" style={{ display:"none" }}
            onChange={e => setFile(e.target.files[0])} />
          <div style={{ fontSize:32, marginBottom:12, opacity:0.6 }}>
            {file ? "♠" : "↑"}
          </div>
          {file ? (
            <>
              <div style={{ color:"#c9a84c", fontWeight:600, marginBottom:4 }}>{file.name}</div>
              <div style={{ color:"#8a8070", fontSize:12 }}>{(file.size / 1024).toFixed(0)} KB · нажми чтобы заменить</div>
            </>
          ) : (
            <>
              <div style={{ color:"#e8dfc8", fontWeight:500, marginBottom:6 }}>
                Перетащи .txt файл или кликни
              </div>
              <div style={{ color:"#5a5245", fontSize:12 }}>
                Hand history с PokerStars / GGPoker
              </div>
            </>
          )}
        </div>

        <div style={{ marginBottom:20 }}>
          <input
            value={heroName}
            onChange={e => setHeroName(e.target.value)}
            placeholder="Твой никнейм на покер-руме"
            style={{
              width:"100%", padding:"12px 16px",
              background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(255,255,255,0.1)",
              borderRadius:10, color:"#e8dfc8",
              fontSize:14, outline:"none",
              boxSizing:"border-box",
              fontFamily:"inherit",
            }}
          />
        </div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onAnalyze(file, heroName)}
          disabled={!file || !heroName.trim()}
          style={{
            width:"100%", padding:"14px",
            background: (!file || !heroName.trim())
              ? "rgba(201,168,76,0.2)"
              : "linear-gradient(135deg, #c9a84c, #a8863c)",
            border:"none", borderRadius:10,
            color: (!file || !heroName.trim()) ? "rgba(201,168,76,0.4)" : "#1a1610",
            fontSize:15, fontWeight:700,
            cursor:(!file || !heroName.trim()) ? "not-allowed" : "pointer",
            letterSpacing:"0.05em",
            fontFamily:"inherit",
          }}
        >
          НАЙТИ LEAK-И
        </motion.button>

        <div style={{ marginTop:16, textAlign:"center" }}>
          <button
            onClick={() => onAnalyze(null, "Demo")}
            style={{
              background:"none", border:"none",
              color:"#5a5245", fontSize:12,
              cursor:"pointer", textDecoration:"underline",
              fontFamily:"inherit"
            }}
          >
            посмотреть демо без файла
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ResultView({ result, onBack }) {
  const { stats, analysis } = result;
  const netPos = stats.total_net_bb >= 0;

  return (
    <motion.div
      initial={{ opacity:0 }}
      animate={{ opacity:1 }}
      transition={{ duration:0.4 }}
      style={{ maxWidth:680, margin:"0 auto", padding:"0 16px" }}
    >
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:32 }}>
        <button onClick={onBack} style={{
          background:"none", border:"1px solid rgba(255,255,255,0.1)",
          borderRadius:8, padding:"6px 12px",
          color:"#8a8070", cursor:"pointer", fontSize:12, fontFamily:"inherit"
        }}>← назад</button>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:"#e8dfc8" }}>{stats.hero}</div>
          <div style={{ fontSize:12, color:"#8a8070" }}>{stats.total_hands.toLocaleString()} раздач проанализировано</div>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:24 }}>
        {[
          { label:"Результат", val:`${netPos?"+":""}${stats.total_net_bb.toFixed(1)} BB`, col: netPos?"#7ab87a":"#e05252" },
          { label:"Winrate",   val:`${stats.bb_per_100 > 0 ? "+" : ""}${stats.bb_per_100} BB/100`, col: stats.bb_per_100 > 0 ? "#7ab87a":"#e05252" },
          { label:"Тип игры",  val: analysis.player_type, col:"#c9a84c", small:true },
        ].map((m,i) => (
          <motion.div key={i}
            initial={{ opacity:0, y:16 }}
            animate={{ opacity:1, y:0 }}
            transition={{ delay: i * 0.08 }}
            style={{
              background:"rgba(255,255,255,0.03)",
              border:"1px solid rgba(255,255,255,0.08)",
              borderRadius:12, padding:"14px 16px"
            }}
          >
            <div style={{ fontSize:10, color:"#5a5245", letterSpacing:"0.1em", marginBottom:6 }}>{m.label.toUpperCase()}</div>
            <div style={{
              fontSize: m.small ? 11 : 18,
              fontWeight:700, color:m.col,
              fontFamily: m.small ? "inherit" : "'DM Mono', monospace",
              lineHeight: m.small ? 1.4 : 1,
            }}>{m.val}</div>
          </motion.div>
        ))}
      </div>

      <div style={{
        background:"rgba(201,168,76,0.06)",
        border:"1px solid rgba(201,168,76,0.2)",
        borderRadius:12, padding:"14px 18px", marginBottom:24
      }}>
        <div style={{ fontSize:10, color:"#c9a84c", letterSpacing:"0.1em", marginBottom:8 }}>ОБЩАЯ ОЦЕНКА</div>
        <p style={{ fontSize:13, color:"#c8c0a8", lineHeight:1.7, margin:0 }}>{analysis.overall_assessment}</p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:24 }}>
        <div style={{
          background:"rgba(255,255,255,0.02)",
          border:"1px solid rgba(255,255,255,0.06)",
          borderRadius:12, padding:"18px"
        }}>
          <div style={{ fontSize:10, color:"#5a5245", letterSpacing:"0.1em", marginBottom:18 }}>КЛЮЧЕВЫЕ СТАТЫ</div>
          <StatBar label="VPIP"   value={stats.vpip_pct}      min={0}  max={60} norm={[22,28]} />
          <StatBar label="PFR"    value={stats.pfr_pct}       min={0}  max={40} norm={[18,24]} />
          <StatBar label="3-Bet"  value={stats.three_bet_pct} min={0}  max={15} norm={[6,10]}  />
          <StatBar label="WTSD"   value={stats.wtsd_pct}      min={0}  max={55} norm={[24,30]} />
          <StatBar label="CBet %" value={stats.cbet_flop_pct} min={0}  max={100} norm={[55,70]} />
        </div>

        <div style={{
          background:"rgba(255,255,255,0.02)",
          border:"1px solid rgba(255,255,255,0.06)",
          borderRadius:12, padding:"18px"
        }}>
          <div style={{ fontSize:10, color:"#5a5245", letterSpacing:"0.1em", marginBottom:14 }}>ПОТЕРИ ПО УЛИЦАМ</div>
          <StreetLossBar losses={stats.losses_by_street} />
          <div style={{ marginTop:20 }}>
            <div style={{ fontSize:10, color:"#5a5245", letterSpacing:"0.1em", marginBottom:12 }}>ПОЗИЦИИ</div>
            <PositionGrid positions={stats.positions} />
          </div>
        </div>
      </div>

      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:10, color:"#5a5245", letterSpacing:"0.1em", marginBottom:14 }}>3 ГЛАВНЫХ LEAK-А</div>
        {analysis.leaks.map((leak, i) => (
          <LeakCard key={i} leak={leak} index={i} />
        ))}
      </div>

      <motion.div
        initial={{ opacity:0 }}
        animate={{ opacity:1 }}
        transition={{ delay:0.6 }}
        style={{
          background:"rgba(224,82,82,0.06)",
          border:"1px solid rgba(224,82,82,0.25)",
          borderRadius:12, padding:"14px 18px", marginBottom:32
        }}
      >
        <div style={{ fontSize:10, color:"#e05252", letterSpacing:"0.1em", marginBottom:6 }}>ПРИОРИТЕТ №1</div>
        <p style={{ fontSize:14, color:"#e8c8c8", lineHeight:1.6, margin:0, fontWeight:500 }}>
          {analysis.top_priority}
        </p>
      </motion.div>
    </motion.div>
  );
}

function AuthView({ onSuccess }) {
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError("");
    if (!email || !password) { setError("Заполни все поля"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/${tab}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "Ошибка"); return; }
      onSuccess(data.token, data.email);
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: "100%", padding: "12px 16px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10, color: "#e8dfc8",
    fontSize: 14, outline: "none",
    boxSizing: "border-box", fontFamily: "inherit",
    marginBottom: 12,
  };

  return (
    <div style={{ maxWidth: 400, margin: "0 auto", padding: "0 16px" }}>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: 40, letterSpacing: "-0.02em", marginBottom: 12 }}>
            <span style={{ color: "#c9a84c" }}>♠</span>
            <span style={{ color: "#e8dfc8", margin: "0 8px" }}>Leak</span>
            <span style={{ color: "#c9a84c" }}>finder</span>
          </div>
          <p style={{ color: "#8a8070", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Анализ покерных leak-ов на основе AI
          </p>
        </div>

        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16, padding: "28px 28px",
        }}>
          <div style={{
            display: "flex", marginBottom: 24,
            background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 3,
          }}>
            {["login", "register"].map(t => (
              <button key={t} onClick={() => { setTab(t); setError(""); }}
                style={{
                  flex: 1, padding: "8px 0", border: "none", borderRadius: 6,
                  background: tab === t ? "rgba(201,168,76,0.15)" : "none",
                  color: tab === t ? "#c9a84c" : "#5a5245",
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                  fontFamily: "inherit", transition: "all 0.15s",
                }}>
                {t === "login" ? "Войти" : "Регистрация"}
              </button>
            ))}
          </div>

          <input value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email" type="email" style={inputStyle}
            onKeyDown={e => e.key === "Enter" && submit()} />
          <input value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Пароль" type="password" style={{ ...inputStyle, marginBottom: error ? 8 : 20 }}
            onKeyDown={e => e.key === "Enter" && submit()} />

          {error && (
            <div style={{ color: "#e05252", fontSize: 12, marginBottom: 14 }}>{error}</div>
          )}

          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={submit} disabled={loading}
            style={{
              width: "100%", padding: "13px",
              background: "linear-gradient(135deg, #c9a84c, #a8863c)",
              border: "none", borderRadius: 10, color: "#1a1610",
              fontSize: 15, fontWeight: 700,
              cursor: loading ? "wait" : "pointer",
              fontFamily: "inherit", letterSpacing: "0.04em",
            }}>
            {loading ? "..." : tab === "login" ? "ВОЙТИ" : "СОЗДАТЬ АККАУНТ"}
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}

function HistoryView({ token, onSelect, onBack }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/history`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(setItems)
      .catch(() => setItems([]));
  }, [token]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      style={{ maxWidth: 600, margin: "0 auto", padding: "0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
        <button onClick={onBack} style={{
          background: "none", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8, padding: "6px 12px",
          color: "#8a8070", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
        }}>← назад</button>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#e8dfc8" }}>История анализов</div>
      </div>

      {items === null && <div style={{ color: "#5a5245", textAlign: "center", padding: 40 }}>Загрузка...</div>}
      {items?.length === 0 && <div style={{ color: "#5a5245", textAlign: "center", padding: 40 }}>Анализов пока нет</div>}

      {items?.map((item, i) => (
        <motion.div key={item.id}
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          onClick={() => onSelect({ stats: item.stats, analysis: item.analysis })}
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 12, padding: "14px 18px", marginBottom: 10,
            cursor: "pointer", transition: "border-color 0.15s",
          }}
          whileHover={{ borderColor: "rgba(201,168,76,0.3)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ color: "#c9a84c", fontWeight: 600 }}>{item.hero_name}</span>
              <span style={{ color: "#5a5245", fontSize: 12, marginLeft: 10 }}>
                {item.hands_parsed} раздач
              </span>
            </div>
            <div style={{
              fontSize: 14, fontWeight: 700, fontFamily: "'DM Mono', monospace",
              color: item.bb_per_100 >= 0 ? "#7ab87a" : "#e05252",
            }}>
              {item.bb_per_100 >= 0 ? "+" : ""}{item.bb_per_100?.toFixed(1)} BB/100
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <span style={{ fontSize: 11, color: "#5a5245" }}>{item.player_type}</span>
            <span style={{ fontSize: 11, color: "#3a3530" }}>
              {new Date(item.created_at).toLocaleDateString("ru-RU")}
            </span>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}

function PaywallView({ token, onBack }) {
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState("");

  const plans = [
    { id: "monthly",  label: "Месячная подписка", price: "$9 / месяц",  desc: "Безлимитные анализы" },
    { id: "lifetime", label: "Навсегда",           price: "$29 разово",  desc: "Лучшая цена" },
  ];

  const pay = async (planId) => {
    setLoading(planId);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/payment/create?plan=${planId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "Ошибка"); return; }
      window.location.href = data.payment_url;
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setLoading(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px" }}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>
          <span style={{ color: "#c9a84c" }}>♠</span>
          <span style={{ color: "#e8dfc8", margin: "0 8px" }}>Leak</span>
          <span style={{ color: "#c9a84c" }}>finder</span>
        </div>
        <div style={{
          display: "inline-block", padding: "6px 16px",
          background: "rgba(224,82,82,0.1)", border: "1px solid rgba(224,82,82,0.3)",
          borderRadius: 20, color: "#e05252", fontSize: 12, marginBottom: 16,
        }}>
          Бесплатный анализ использован
        </div>
        <p style={{ color: "#8a8070", fontSize: 14, lineHeight: 1.7, margin: 0 }}>
          Получи безлимитный доступ к AI-анализу leak-ов.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
        {plans.map(plan => (
          <motion.div key={plan.id} whileHover={{ scale: 1.01 }}
            style={{
              background: "rgba(255,255,255,0.03)",
              border: plan.id === "lifetime"
                ? "1px solid rgba(201,168,76,0.35)"
                : "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14, padding: "20px 24px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
            <div>
              <div style={{ color: "#e8dfc8", fontWeight: 600, marginBottom: 4 }}>{plan.label}</div>
              <div style={{ color: "#5a5245", fontSize: 12 }}>{plan.desc}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#c9a84c", fontWeight: 700, fontFamily: "'DM Mono', monospace", marginBottom: 8 }}>
                {plan.price}
              </div>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => pay(plan.id)}
                disabled={loading !== null}
                style={{
                  padding: "8px 18px",
                  background: "linear-gradient(135deg, #c9a84c, #a8863c)",
                  border: "none", borderRadius: 8, color: "#1a1610",
                  fontSize: 13, fontWeight: 700, cursor: loading ? "wait" : "pointer",
                  fontFamily: "inherit",
                }}>
                {loading === plan.id ? "..." : "Оплатить крипто"}
              </motion.button>
            </div>
          </motion.div>
        ))}
      </div>

      {error && <div style={{ color: "#e05252", fontSize: 12, textAlign: "center", marginBottom: 12 }}>{error}</div>}

      <div style={{ textAlign: "center" }}>
        <button onClick={onBack} style={{
          background: "none", border: "none", color: "#4a4540",
          fontSize: 12, cursor: "pointer", fontFamily: "inherit",
        }}>← вернуться назад</button>
      </div>
    </motion.div>
  );
}

function LoadingView() {
  const steps = ["Парсим раздачи...", "Считаем статистику...", "Ищем leak-и...", "Готовим отчёт..."];
  const [step, setStep] = useState(0);

  useState(() => {
    const t = setInterval(() => setStep(s => Math.min(s + 1, steps.length - 1)), 700);
    return () => clearInterval(t);
  });

  return (
    <div style={{ textAlign:"center", padding:"80px 24px" }}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration:3, repeat:Infinity, ease:"linear" }}
        style={{ fontSize:48, display:"inline-block", marginBottom:32 }}
      >♠</motion.div>
      <div style={{ color:"#8a8070", fontSize:14 }}>{steps[step]}</div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem("userEmail") || "");
  const [view, setView] = useState(() => localStorage.getItem("token") ? "upload" : "auth");
  const [result, setResult] = useState(null);

  useEffect(() => {
    localStorage.setItem("token", token);
    localStorage.setItem("userEmail", userEmail);
  }, [token, userEmail]);

  const handleAuthSuccess = (t, email) => {
    setToken(t);
    setUserEmail(email);
    setView("upload");
  };

  const handleLogout = () => {
    setToken("");
    setUserEmail("");
    setView("auth");
  };

  const handleAnalyze = async (file, heroName) => {
    if (!file) {
      setResult(MOCK_RESULT);
      setView("result");
      return;
    }
    setView("loading");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("hero_name", heroName);
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        body: formData,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 402) {
        setView("paywall");
        return;
      }
      if (!res.ok) throw new Error("Ошибка сервера");
      const data = await res.json();
      setResult(data);
      setView("result");
    } catch (e) {
      alert("Ошибка: " + e.message);
      setView("upload");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#111009",
      color: "#e8dfc8",
      fontFamily: "'Playfair Display', 'Georgia', serif",
      position: "relative",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
      <SuitPattern />

      {/* Header — только для залогиненных */}
      {view !== "auth" && (
        <div style={{
          position: "relative", zIndex: 2,
          display: "flex", justifyContent: "flex-end", alignItems: "center",
          padding: "12px 24px", gap: 10,
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}>
          <span style={{ fontSize: 12, color: "#5a5245" }}>{userEmail}</span>
          <button onClick={() => setView("history")} style={{
            background: "none", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6, padding: "5px 10px",
            color: "#8a8070", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
          }}>История</button>
          <button onClick={handleLogout} style={{
            background: "none", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6, padding: "5px 10px",
            color: "#4a4540", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
          }}>Выйти</button>
        </div>
      )}

      <div style={{ position: "relative", zIndex: 1, paddingTop: 48, paddingBottom: 48 }}>
        <AnimatePresence mode="wait">
          {view === "auth"    && <AuthView key="auth" onSuccess={handleAuthSuccess} />}
          {view === "upload"  && <UploadView key="up" onAnalyze={handleAnalyze} />}
          {view === "loading" && <LoadingView key="ld" />}
          {view === "result"  && <ResultView key="rs" result={result} onBack={() => setView("upload")} />}
          {view === "paywall" && <PaywallView key="pw" token={token} onBack={() => setView("upload")} />}
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
