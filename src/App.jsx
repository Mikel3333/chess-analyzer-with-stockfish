import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

// --- Evaluation Bar Component ---
function EvaluationBar({ evaluation, sideToMove }) {
  // Logistic mapping from pawns (White perspective) → percentage
  // This approximates chess.com style saturation: ~1 pawn ≈ 65%, 2 pawns ≈ 78%, 3 pawns ≈ 87%
  const pawnsToPct = (pawns) => {
    // clamp extreme values for stability
    const x = Math.max(-10, Math.min(10, pawns));
    const k = 0.85; // steeper → faster saturation
    const pct = 100 / (1 + Math.exp(-k * x));
    // Ensure we never hit the absolute edges to keep the UI nice
    return Math.max(1, Math.min(99, pct));
  };

  // Convert evaluation (UCI relative to side-to-move) → White perspective pawns
  const evalToWhitePawns = () => {
    if (!evaluation) return 0;
    if ('mate' in evaluation) {
      const m = Number(evaluation.mate);
      // Mate score is relative to side-to-move. Convert to White perspective.
      const mWhite = sideToMove === 'w' ? m : -m;
      // Use a large sentinel to map to near-edges; actual percentage handled below
      return mWhite > 0 ? 10 : -10;
    }
    if ('cp' in evaluation) {
      const cpWhite = sideToMove === 'b' ? -evaluation.cp : evaluation.cp;
      return cpWhite / 100;
    }
    return 0;
  };

  // Numeric label text (White perspective)
  const getWhiteAdvText = () => {
    if (!evaluation) return '0.0';
    if ('mate' in evaluation) {
      const m = Number(evaluation.mate);
      if (m === 0) return 'Checkmate';
      const mWhite = sideToMove === 'w' ? m : -m;
      return (mWhite >= 0 ? '' : '-') + 'M' + Math.abs(mWhite);
    }
    if ('cp' in evaluation) {
      const cpWhite = sideToMove === 'b' ? -evaluation.cp : evaluation.cp;
      const pawns = cpWhite / 100;
      const abs = Math.abs(pawns);
      // Chess.com caps display around 10.0 pawns
      const txt = abs < 9.95 ? pawns.toFixed(1) : (pawns > 0 ? '10+' : '-10+');
      return txt.startsWith('-') || txt.startsWith('1') || txt.startsWith('0') ? txt : `+${txt}`;
    }
    return '0.0';
  };

  const pawnsWhite = evalToWhitePawns();
  const percentage = (() => {
    // Special casing mate for visual fill
    if (evaluation && 'mate' in evaluation) {
      const m = Number(evaluation.mate);
      if (m === 0) {
        // Side to move is already mated → winner is opposite
        return sideToMove === 'b' ? 100 : 0;
      }
      const mWhite = sideToMove === 'w' ? m : -m;
      return mWhite > 0 ? 99 : 1;
    }
    return pawnsToPct(pawnsWhite);
  })();

  const whiteHeight = percentage;
  const blackHeight = 100 - percentage;
  const labelText = getWhiteAdvText();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{
        position: 'relative',
        width: '30px',
        height: '500px',
        border: '1px solid #333',
        borderRadius: '4px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Center marker at 50% */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          width: '100%',
          height: '2px',
          backgroundColor: 'rgba(255,255,255,0.25)',
          transform: 'translateY(-1px)',
          pointerEvents: 'none'
        }} />

        {/* Black advantage (top) */}
        <div style={{
          height: `${blackHeight}%`,
          backgroundColor: '#2c2c2c',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'height 0.35s ease-in-out'
        }} />
        
        {/* White advantage (bottom) */}
        <div style={{
          height: `${whiteHeight}%`,
          backgroundColor: '#f0f0f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'height 0.35s ease-in-out'
        }} />
      </div>
      {/* Numeric label for White advantage */}
      <div style={{
        marginTop: '4px',
        fontSize: '12px',
        fontWeight: 600,
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif',
        color: '#333'
      }}>
        {labelText}
      </div>
    </div>
  );
}

// --- Worker: memuat Stockfish dari CDN di dalam Web Worker ---
function createStockfishWorker(url = '/stockfish/stockfish-17.1-8e4d048.js') {
  // Build absolute URL without cache-buster; Stockfish scripts resolve wasm paths relative to this URL
  const abs = new URL(url, window.location.origin).toString();
  return new Worker(abs, { type: 'classic', name: 'stockfish' });
}

// --- Util: parse PGN jadi daftar FEN + SAN ---
function parsePgnToFens(pgn) {
  const game = new Chess();
  
  try {
    game.loadPgn(pgn, { sloppy: true, newlineChar: "\n" });
    
    // Check if any moves were actually loaded
    const moves = game.history({ verbose: true });
    if (moves.length === 0) {
      throw new Error("PGN tidak mengandung langkah yang valid");
    }

    const walk = new Chess();
    const fens = [walk.fen()]; // posisi awal
    const sans = [];

    for (const mv of moves) {
      walk.move(mv);
      fens.push(walk.fen());   // posisi setelah langkah ini
      sans.push(mv.san);
    }
    return { fens, sans };
  } catch (e) {
    throw new Error("PGN tidak valid atau gagal di-parse: " + e.message);
  }
}

// --- Util: hitung nilai materi sederhana (tanpa pion struktur, hanya bobot materi) ---
function materialScore(game) {
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const board = game.board();
  let w = 0, b = 0;
  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      const v = values[piece.type] || 0;
      if (piece.color === 'w') w += v; else b += v;
    }
  }
  return { w, b };
}

// --- Util: konversi UCI pertama dari PV menjadi SAN pada FEN tertentu ---
function uciToSan(fen, uci) {
  try {
    const game = new Chess(fen);
    const moves = game.moves({ verbose: true });
    const match = moves.find(m => (m.from + m.to + (m.promotion || '')) === uci);
    if (!match) return null;
    const sanGame = new Chess(fen);
    const mv = sanGame.move({ from: match.from, to: match.to, promotion: match.promotion });
    return mv ? mv.san : null;
  } catch {
    return null;
  }
}

// --- Util: deteksi pengorbanan materi pada langkah SAN dari posisi FEN ---
function isSacrificeMove(fen, san, moverSide) {
  try {
    const before = new Chess(fen);
    const sco0 = materialScore(before);
    const m = before.move(san, { sloppy: true });
    if (!m) return false;
    const sco1 = materialScore(before);
    const delta = moverSide === 'w' ? (sco1.w - sco0.w) : (sco1.b - sco0.b);
    // sacrifice jika materi turun >= 3 pion-equivalent
    return delta <= -3;
  } catch {
    return false;
  }
}

// --- Util: deteksi "offered sacrifice" (korban ditawarkan: setelah langkah, lawan bisa menangkap
//          bidak/buah yang baru bergerak dan itu menurunkan materi pelaku langkah ≥ 3 pion-equivalent)
function offersSacrificeNextMove(fen, san, moverSide) {
  try {
    const before = new Chess(fen);
    const move = before.move(san, { sloppy: true });
    if (!move) return false;
    const after = before; // board now at position after mover's move
    const scoAfter = materialScore(after);
    const opponentMoves = after.moves({ verbose: true });
    // Cari tangkapan pada kotak tujuan piece yang baru bergerak
    const targetSquare = move.to;
    for (const om of opponentMoves) {
      if (om.to === targetSquare && om.flags.includes('c')) {
        const test = new Chess(after.fen());
        test.move({ from: om.from, to: om.to, promotion: om.promotion });
        const scoCap = materialScore(test);
        const delta = (moverSide === 'w') ? (scoCap.w - scoAfter.w) : (scoCap.b - scoAfter.b);
        if (delta <= -3) return true; // pelaku langkah kehilangan ≥3 setelah tangkapan terbaik
      }
    }
    return false;
  } catch {
    return false;
  }
}

// --- Util: normalisasi evaluasi ke sudut pandang Putih (pawns) ---
function evalToPawns(evalObj, sideToMove) {
  if (!evalObj) return null;
  if ("mate" in evalObj) {
    // gunakan angka besar agar tetap tergambar di chart (cap ±10)
    // mate === 0 berarti side-to-move pada posisi itu sedang skakmat
    const m = Number(evalObj.mate);
    if (m === 0) {
      return sideToMove === 'w' ? -10 : 10; // dari sudut pandang putih
    }
    // UCI mate sign is relative to side-to-move; convert to White perspective
    const mWhite = sideToMove === 'w' ? m : -m;
    return mWhite > 0 ? 10 : -10;
  }
  const sign = sideToMove === "b" ? -1 : 1; // score UCI relatif side-to-move
  return (evalObj.cp * sign) / 100; // centipawn -> pawn
}

// Helper: convert evaluation object to centipawns from a given side's perspective
// For cp: positive = good for 'side'. For mate: use large sentinel while preserving sign.
function evalToCpForSide(ev, side) {
  if (!ev) return null;
  const INF = 100000; // sentinel for mate
  if ("mate" in ev) {
    // UCI mate is relative to side-to-move of the position where it was reported.
    // Caller must ensure sign corresponds to 'side' perspective before calling if needed.
    // Here we assume ev is already for 'side' perspective.
    return Math.sign(ev.mate) * INF;
  }
  if ("cp" in ev) return ev.cp;
  return null;
}

// Classify a move by loss against engine best (in centipawns), mover's perspective.
function classifyMoveByDelta(bestCp, playedCp, flags) {
  // bestCp/playedCp: higher is better for mover
  // loss = best - played (>=0 means worse than best)
  const loss = (bestCp ?? 0) - (playedCp ?? 0);
  const absLoss = Math.abs(loss);

  // Miss (taktik terlewat)
  if (flags?.bestIsMate || (bestCp != null && bestCp >= 300)) {
    if (playedCp != null && playedCp <= 50) return "Miss";
  }

  // Blunder: sangat buruk atau membalik hasil besar → netral/berlawanan
  if (absLoss > 300 ||
      (bestCp != null && playedCp != null && (
        (bestCp >= 300 && playedCp <= 0) ||
        (bestCp <= -300 && playedCp >= 0)
      ))) {
    return "Blunder";
  }

  if (absLoss <= 10) return "Best";        // sama PV#1 atau selisih ≤10cp
  if (absLoss <= 20) return "Excellent";
  if (absLoss <= 50) return "Good";
  if (absLoss <= 150) return "Inaccuracy";
  if (absLoss <= 300) return "Mistake";
  return "Blunder";
}

// --- Util: parse PGN jadi daftar FEN + SAN ---
// Removed duplicate definition

export default function App() {
  const [pgn, setPgn] = useState("");
  const [error, setError] = useState("");
  const [fens, setFens] = useState([]);     // posisi[0..N]
  const [sans, setSans] = useState([]);     // SAN per ply [1..N]
  const [idx, setIdx] = useState(0);        // index posisi saat ini
  const [evals, setEvals] = useState({});   // map: index -> {cp|mate}
  const [lastMove, setLastMove] = useState(null); // untuk highlight langkah terakhir
  const [boardPosition, setBoardPosition] = useState("start"); // string "start" atau objek posisi
  const [boardKey, setBoardKey] = useState(0); // untuk force re-render
  const [pendingAnalyze, setPendingAnalyze] = useState(null); // { type: 'current'|'all', depth: number } | null
  const [playerNames, setPlayerNames] = useState({ white: 'White Player', black: 'Black Player' });
  const [engineReady, setEngineReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);

  // Worker Stockfish (opsional)
  const workerRef = useRef(null);

  useEffect(() => {
    let loadingTimeout;
    let timeoutToken = 0; // increment to invalidate old timeouts
    let candidateIndex = 0;
    const isolated = window.crossOriginIsolated === true;
    const supportsThreads = isolated && typeof window.SharedArrayBuffer !== 'undefined';
    console.info('[Stockfish] crossOriginIsolated:', isolated, 'SharedArrayBuffer:', typeof window.SharedArrayBuffer !== 'undefined');
    // Build list depending on capability
    const threadedPriority = [
      '/stockfish/stockfish-17.1-8e4d048.js',           // FORCE ONLY primary candidate for debugging
    ];
    const nonThreaded = [];
    const candidates = [...threadedPriority];
    const debugEngine = true; // TEMP: enable verbose engine logs to diagnose startup

    const tryNextCandidate = (currentWorker) => {
      try { currentWorker?.terminate(); } catch {}
      clearTimeout(loadingTimeout);
      candidateIndex += 1;
      if (candidateIndex < candidates.length) {
        const nextUrl = candidates[candidateIndex];
        console.warn('Switching Stockfish build to:', nextUrl);
        try {
          const fb = createStockfishWorker(nextUrl);
          setupWorker(fb);
          return true;
        } catch (e2) {
          console.error('Failed to create fallback worker:', e2);
        }
      }
      clearTimeout(loadingTimeout);
      setEngineReady(false);
      return false;
    };

    const setupWorker = (w) => {
      workerRef.current = w;

      // watchdog for engine loading
      clearTimeout(loadingTimeout);
      const myToken = ++timeoutToken;
      loadingTimeout = setTimeout(() => {
        if (myToken !== timeoutToken) return; // stale timeout
        console.error('Engine loading timeout after 30 seconds');
        setEngineReady(false);
      }, 30000);

      w.onmessage = (e) => {
        const data = e.data;
        if (typeof data === 'string') {
          const line = data;
          if (debugEngine) console.log('[Stockfish]', line);
          if (line.includes('uciok') || line.includes('readyok')) {
            clearTimeout(loadingTimeout);
            setEngineReady(true);
          }
          // Do not treat arbitrary 'error' text lines as fatal; rely on actual worker error events
          // Some builds emit lines containing the word 'error' during normal operation.
          return;
        }
        const { type } = data || {};
        if (type === 'ready') {
          clearTimeout(loadingTimeout);
          setEngineReady(true);
        }
        if (type === 'error') {
          console.warn('Stockfish reported error message object, advancing candidate.');
          if (tryNextCandidate(w)) return;
        }
        if (type === 'log') {
          const message = data?.message;
          if (message && (String(message).includes('uciok') || String(message).includes('readyok'))) {
            clearTimeout(loadingTimeout);
            setEngineReady(true);
          }
        }
      };

      w.onerror = (err) => {
        console.warn('Worker error event (will try fallback if available):', {
          type: err?.type,
          filename: err?.filename,
          lineno: err?.lineno,
          colno: err?.colno,
          message: err?.message || String(err),
          error: err?.error ? String(err.error) : undefined
        });
        if (tryNextCandidate(w)) return;
      };

      w.onmessageerror = (e) => {
        console.warn('Worker messageerror event (malformed transferable/message):', e);
      };

      // Kick off UCI and readiness check
      try {
        w.postMessage('uci');
      } catch (postErr) {
        console.error('Failed to post initial UCI messages:', postErr);
      }
    };

    // Try primary worker with candidate chain
    try {
      const w = createStockfishWorker(candidates[candidateIndex]);
      setupWorker(w);
    } catch (e) {
      console.error('Primary worker creation threw synchronously:', e);
      tryNextCandidate(workerRef.current);
    }

    return () => {
      clearTimeout(loadingTimeout);
      try { workerRef.current?.terminate(); } catch {}
    };
  }, []);

  const cleanPGN = useCallback((rawPGN) => {
    const cleaningRules = [
      [/\r\n/g, "\n"],                                    // normalize newlines
      [/[\u00A0\u2000-\u200B]/g, " "],                   // NBSP & similar → space
      [/\b0-0-0\b/g, "O-O-O"],                          // normalize castling
      [/\b0-0\b/g, "O-O"],
      [/\{[^}]*\}/g, " "],                              // remove comments { ... }
      [/^\s*;.*$/gm, " "],                              // remove line comments ;
      [/\$\d+/g, " "],                                  // remove NAG $1, $3, etc
      [/\[%[^\]]*\]/g, " "],                            // remove inline tags [%clk 1:23:45]
      [/\([^()]*\)/g, " "],                             // remove variations ( ... )
      [/\([^()]*\)/g, " "],                             // second pass for nested
      [/[ \t]+\n/g, "\n"],                              // clean whitespace
      [/\n{3,}/g, "\n\n"],
      [/[ \t]{2,}/g, " "],
      [/(^\s*\[[^\n]*\]\s*(?:\n\s*\[[^\n]*\]\s*)+)\n(?!\n)/m, "$1\n\n"] // header spacing
    ];
    
    return cleaningRules.reduce((text, [pattern, replacement]) => 
      text.replace(pattern, replacement), rawPGN).trim();
  }, []);

  // --- Util: extract player names from PGN headers ---
  function extractPlayerNames(pgn) {
    const whiteMatch = pgn.match(/\[White\s+"([^"]+)"\]/);
    const blackMatch = pgn.match(/\[Black\s+"([^"]+)"\]/);
    return {
      white: whiteMatch ? whiteMatch[1] : 'White Player',
      black: blackMatch ? blackMatch[1] : 'Black Player'
    };
  }

  // Parse PGN → fens + sans
  function handleParse() {
    try {
      setError("");
      const normalized = cleanPGN(pgn);
      const { fens: F, sans: S } = parsePgnToFens(normalized);
      const names = extractPlayerNames(normalized);
      setFens(F);
      setSans(S);
      setPlayerNames(names);
      setIdx(0);
      setEvals({});
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  // Combined Parse + Analyze function
  function handleAnalyze() {
    try {
      setError("");
      const normalized = cleanPGN(pgn);
      const { fens: F, sans: S } = parsePgnToFens(normalized);
      const names = extractPlayerNames(normalized);
      setFens(F);
      setSans(S);
      setPlayerNames(names);
      setIdx(0);
      setEvals({});
      
      // Start analysis immediately after parsing in a single click
      if (F.length > 0) {
        if (engineReady) {
          // analyze using freshly parsed list to avoid state timing race
          analyzeAll(15, F);
        } else {
          // fallback: queue analyze-all; state F will be ready by the time engine becomes ready
          setPendingAnalyze({ type: 'all', depth: 15 });
        }
      }
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  // Upload file .pgn
  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPgn(String(reader.result || ""));
    reader.readAsText(file);
  }

  // Analisis 1 posisi (kembalikan evalObj {cp|mate} + multipv)
  const analyzeFenOnce = useCallback((fen, depth = 12, multiPV = 5) => {
    return new Promise((resolve) => {
      const w = workerRef.current;
      if (!w) return resolve(null);

      let currentEval = null;
      let bestmoveUci = null;
      const mpv = {}; // k -> { type: 'cp'|'mate', value: number, uci: string }

      const handler = (e) => {
        const data = e.data;
        if (typeof data === 'string') {
          const line = data;
          // Parse MultiPV lines
          // Example: info depth 15 seldepth 28 multipv 2 score cp -34 nodes ... pv e2e4 e7e5 ...
          const mMulti = line.match(/\bmultipv\s+(\d+)/);
          if (mMulti) {
            const k = parseInt(mMulti[1], 10);
            const mCp = line.match(/score\s+cp\s+(-?\d+)/);
            const mMate = line.match(/score\s+mate\s+(-?\d+)/);
            const mPv = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
            if (mPv && (mCp || mMate)) {
              if (mMate) mpv[k] = { type: 'mate', value: parseInt(mMate[1], 10), uci: mPv[1] };
              else mpv[k] = { type: 'cp', value: parseInt(mCp[1], 10), uci: mPv[1] };
              // also track currentEval as best so far when k===1
              if (k === 1) {
                currentEval = mMate ? { mate: parseInt(mMate[1], 10) } : { cp: parseInt(mCp[1], 10) };
              }
            }
          }
          // Parse single PV fallback (no multipv key present on some builds): still update currentEval
          const mCp = line.match(/score\s+cp\s+(-?\d+)/);
          const mMate = line.match(/score\s+mate\s+(-?\d+)/);
          if (mCp) currentEval = { cp: parseInt(mCp[1], 10) };
          if (mMate) currentEval = { mate: parseInt(mMate[1], 10) };

          const mBest = line.match(/\bbestmove\s+(\S+)/);
          if (mBest) {
            bestmoveUci = mBest[1];
            w.removeEventListener('message', handler);
            // Build result
            const multipv = Object.keys(mpv)
              .map(k => ({ rank: parseInt(k, 10), uci: mpv[k].uci, [mpv[k].type]: mpv[k].value }))
              .sort((a, b) => a.rank - b.rank);
            const best = multipv.find(m => m.rank === 1);
            const result = best ? { ...best } : (currentEval || null);
            if (result) {
              // normalize: carry cp|mate to top-level
              const top = {};
              if ('cp' in result) top.cp = result.cp;
              if ('mate' in result) top.mate = result.mate;
              resolve({ ...top, bestmoveUci, multipv });
            } else {
              resolve(null);
            }
          }
          return;
        }
        const { type } = data || {};
        if (type === 'eval') {
          const { cp, mate } = data;
          currentEval = (cp !== undefined) ? { cp } : { mate };
        }
        if (type === 'bestmove') {
          bestmoveUci = data?.bestmove;
          w.removeEventListener('message', handler);
          const multipv = Object.keys(mpv)
            .map(k => ({ rank: parseInt(k, 10), uci: mpv[k].uci, [mpv[k].type]: mpv[k].value }))
            .sort((a, b) => a.rank - b.rank);
          const best = multipv.find(m => m.rank === 1);
          const result = best ? { ...best } : (currentEval || null);
          if (result) {
            const top = {};
            if ('cp' in result) top.cp = result.cp;
            if ('mate' in result) top.mate = result.mate;
            resolve({ ...top, bestmoveUci, multipv });
          } else {
            resolve(null);
          }
        }
      };
      w.addEventListener('message', handler);
      // Send UCI commands directly
      w.postMessage('ucinewgame');
      w.postMessage('setoption name Threads value 1');
      w.postMessage('setoption name Hash value 16');
      w.postMessage('setoption name MultiPV value ' + multiPV);
      w.postMessage('position fen ' + fen);
      w.postMessage('go depth ' + depth);
    });
  }, []);

  // Analisis semua posisi berurutan
  const analyzeAll = useCallback(async (depth = 12, list) => {
    const fenList = Array.isArray(list) ? list : fens;
    if (!engineReady || fenList.length === 0) return;
    setThinking(true);
    setAnalyzeProgress(0);
    const next = {};
    for (let i = 0; i < fenList.length; i++) {
      const ev = await analyzeFenOnce(fenList[i], depth);
      if (ev) {
        next[i] = ev;
      }
      setAnalyzeProgress((i + 1) / fenList.length);
    }
    setEvals(next);
    setThinking(false);
  }, [engineReady, fens, analyzeFenOnce]);

  // Wrapper: request deep analysis for current position, queue if engine not ready yet
  const requestAnalyzeCurrent = useCallback((depth = 18) => {
    if (engineReady) {
      analyzeFenOnce(fens[idx], depth).then((ev) => {
        if (ev) setEvals((prev) => ({ ...prev, [idx]: ev }));
      });
    } else {
      setPendingAnalyze({ type: 'current', depth });
    }
  }, [engineReady, analyzeFenOnce, fens, idx]);

  // Wrapper: request analyze all positions, queue if engine not ready yet
  const requestAnalyzeAll = useCallback((depth = 15) => {
    if (engineReady) {
      analyzeAll(depth);
    } else {
      setPendingAnalyze({ type: 'all', depth });
    }
  }, [engineReady, analyzeAll]);

  // When engine becomes ready, flush any pending analyze request
  useEffect(() => {
    if (engineReady && pendingAnalyze) {
      const { type, depth } = pendingAnalyze;
      if (type === 'current') {
        analyzeFenOnce(fens[idx], depth).then((ev) => {
          if (ev) setEvals((prev) => ({ ...prev, [idx]: ev }));
        });
      } else if (type === 'all') {
        analyzeAll(depth);
      }
      setPendingAnalyze(null);
    }
  }, [engineReady, pendingAnalyze, analyzeFenOnce, fens, idx, analyzeAll]);

  const hasGame = useMemo(() => fens.length > 0, [fens.length]);

  // Update lastMove dan boardPosition ketika idx berubah
  useEffect(() => {
    if (hasGame && fens[idx]) {
      setBoardPosition(fens[idx]);
      
      // Calculate last move efficiently
      if (idx > 0 && sans[idx - 1]) {
        const tempGame = new Chess();
        // Replay moves up to current position
        for (let i = 0; i < idx; i++) {
          if (i === idx - 1) {
            const move = tempGame.move(sans[i]);
            if (move) {
              setLastMove({ from: move.from, to: move.to });
              return;
            }
          } else {
            tempGame.move(sans[i]);
          }
        }
      }
      setLastMove(null);
    } else {
      setBoardPosition("start");
      setLastMove(null);
    }
  }, [idx, sans, fens, hasGame]);

  // Fungsi untuk navigasi dengan animasi
  const navigateToPosition = (newIdx) => {
    if (!hasGame || fens.length === 0) return;
    if (newIdx === idx) return;
    if (newIdx < 0 || newIdx >= fens.length) return;
    setIdx(newIdx);
  };

  // Data grafik evaluasi (pawns, sudut pandang Putih)
  const chartData = useMemo(() => {
    return fens.map((fen, i) => {
      const sideToMove = fen.split(" ")[1]; // 'w' atau 'b'
      const pawns = evalToPawns(evals[i], sideToMove);
      return { move: i, pawns };
    });
  }, [fens, evals]);

  // Klasifikasi per langkah berdasarkan selisih terhadap best PV
  // Memakai evals[i] (score terbaik pada posisi i) dan evals[i+1] (score setelah langkah dimainkan)
  const annotations = useMemo(() => {
    const ann = {};
    for (let i = 0; i < fens.length - 1; i++) {
      const moverSide = fens[i].split(" ")[1];           // 'w' atau 'b'
      const best = evals[i];                               // dari posisi sebelum langkah (best line + multipv)
      const after = evals[i + 1];                          // dari posisi setelah langkah (relatif lawan)
      if (!best || !after) continue;

      // Normalisasi ke perspektif mover dalam centipawns
      let bestCp;
      if ("mate" in best) bestCp = Math.sign(best.mate) * 100000; else bestCp = best.cp;

      let playedCp;
      if ("mate" in after) {
        if (after.mate === 0) {
          // Langkah yang baru dimainkan menghasilkan skakmat segera
          // Dari perspektif pelaku langkah: ini kemenangan maksimum
          playedCp = 100000;
        } else {
          playedCp = -Math.sign(after.mate) * 100000; // flip karena setelah langkah giliran lawan
        }
      } else playedCp = -after.cp; // flip cp

      let tag = classifyMoveByDelta(bestCp, playedCp, {
        bestIsMate: "mate" in best && Math.sign(best.mate) > 0 // mate untuk mover
      });

      const deltaCp = (bestCp ?? 0) - (playedCp ?? 0);

      // Great / Brilliant detection: only-move and optional sacrifice
      const pvList = Array.isArray(best.multipv) ? best.multipv : [];
      const bestUci = best.bestmoveUci || pvList.find(x => x.rank === 1)?.uci || null;
      const bestSan = bestUci ? uciToSan(fens[i], bestUci) : null;
      const playedSan = sans[i];

      // If the played move equals engine best (SAN match), force 'Best'.
      // Additionally, if move offers a clear material sacrifice next move (≥3 pawns), mark as 'Brilliant'.
      if (bestSan && playedSan && playedSan === bestSan) {
        const offered = offersSacrificeNextMove(fens[i], playedSan, moverSide);
        tag = offered ? 'Brilliant' : 'Best';
      }

      // Compute only-move: all alternatives lose >=150cp vs best for mover
      let onlyMove = false;
      if (bestSan && playedSan && playedSan === bestSan && pvList.length >= 2) {
        const getCp = (item) => ('mate' in item) ? (Math.sign(item.mate) * 100000) : (item.cp);
        const bestItem = pvList.find(x => x.rank === 1);
        const bestItemCp = bestItem ? getCp(bestItem) : null;
        if (bestItemCp != null) {
          const altLosses = pvList
            .filter(x => x.rank !== 1)
            .map(x => bestItemCp - getCp(x));
          const minAltLoss = Math.min(...altLosses);
          if (Number.isFinite(minAltLoss) && minAltLoss >= 150) {
            onlyMove = true;
          }
        }
      }

      if (onlyMove && playedSan === bestSan) {
        const sacImmediate = isSacrificeMove(fens[i], playedSan, moverSide) || offersSacrificeNextMove(fens[i], playedSan, moverSide);
        tag = sacImmediate ? 'Brilliant' : 'Great';
      }

      if (tag) ann[i + 1] = { mover: moverSide === 'w' ? 'White' : 'Black', tag, delta: (deltaCp / 100) };
    }
    return ann;
  }, [fens, evals, sans]);

  // Calculate player statistics based on move analysis
  const playerStats = useMemo(() => {
    const stats = {
      white: { accuracy: 0, gameRating: 1200, totalMoves: 0, goodMoves: 0 },
      black: { accuracy: 0, gameRating: 1200, totalMoves: 0, goodMoves: 0 }
    };

    // Calculate accuracy and performance rating based on move quality
    for (let i = 0; i < fens.length - 1; i++) {
      const moverSide = fens[i].split(" ")[1];
      const best = evals[i];
      const after = evals[i + 1];
      
      if (!best || !after) continue;

      const player = moverSide === 'w' ? 'white' : 'black';
      stats[player].totalMoves++;

      // Calculate centipawn loss
      let bestCp = ("mate" in best) ? Math.sign(best.mate) * 100000 : best.cp;

      let playedCp;
      if ("mate" in after) {
        // Jika setelah langkah posisi adalah mate (mate==0), berarti pelaku langkah memberi skakmat → +INF
        playedCp = (after.mate === 0) ? 100000 : (-Math.sign(after.mate) * 100000);
      } else {
        playedCp = -after.cp;
      }
      
      const cpLoss = Math.max(0, (bestCp ?? 0) - (playedCp ?? 0));

      // Tighter, CPL-driven accuracy curve (closer to chess.com)
      // Heavier penalties for medium/large mistakes; light penalty for small inaccuracies.
      // acc(cp) = 100 - 0.45 * (cpLoss^0.88)
      // Examples: 10cp ≈ 96.6, 20cp ≈ 94.5, 50cp ≈ 86, 100cp ≈ 74.8, 200cp ≈ 52, 300cp ≈ 30
      const moveAccuracy = Math.max(0, 100 - 0.45 * Math.pow(cpLoss, 0.88));
      stats[player].accuracy += moveAccuracy;

      // Count "good" moves (threshold ~92%) to compute a small consistency bonus later
      if (moveAccuracy >= 92) stats[player].goodMoves++;
    }

    // Finalize accuracy as percentage
    ['white', 'black'].forEach(color => {
      if (stats[color].totalMoves > 0) {
        stats[color].accuracy = stats[color].accuracy / stats[color].totalMoves;
        const goodMoveRatio = stats[color].goodMoves / stats[color].totalMoves;

        // Game rating: anchor near 800 and scale primarily with accuracy.
        // Calibrated so ~89% ≈ ~1200 and ~73% ≈ ~800 for short games.
        const slope = 25; // rating points per 1% above the 73% anchor
        const anchor = 73; // reference accuracy
        const baseMin = 800; // minimum cap
        const gain = Math.max(0, (stats[color].accuracy - anchor) * slope);

        // Small consistency bonus (0..100) when many moves are high-accuracy
        const consistencyBonus = Math.max(0, (goodMoveRatio - 0.5) * 200); // 0 if <=50% good moves

        let rating = baseMin + gain + consistencyBonus;
        rating = Math.max(800, Math.min(2200, rating));
        stats[color].gameRating = Math.round(rating);
      }
    });
                                                    
    return stats;
  }, [fens, evals]);

  // Custom arrow overlay component since react-chessboard may not support arrows
  const ArrowOverlay = ({ arrows, boardSize = 400 }) => {
    if (!arrows || arrows.length === 0) return null;

    const squareSize = boardSize / 8;
    
    const getSquarePosition = (square) => {
      const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // 0-7
      const rank = parseInt(square[1]) - 1; // 0-7
      return {
        x: file * squareSize + squareSize / 2,
        y: (7 - rank) * squareSize + squareSize / 2
      };
    };

    return (
      <div style={{ position: 'absolute', top: 0, left: 0, width: boardSize, height: boardSize, pointerEvents: 'none', zIndex: 10 }}>
        <svg width={boardSize} height={boardSize}>
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                fill="rgba(0, 128, 0, 0.8)"
              />
            </marker>
          </defs>
          {arrows.map((arrow, index) => {
            const from = typeof arrow === 'string' ? arrow.slice(0, 2) : arrow.from;
            const to = typeof arrow === 'string' ? arrow.slice(2, 4) : arrow.to;
            
            const fromPos = getSquarePosition(from);
            const toPos = getSquarePosition(to);
            
            return (
              <line
                key={index}
                x1={fromPos.x}
                y1={fromPos.y}
                x2={toPos.x}
                y2={toPos.y}
                stroke="rgba(0, 128, 0, 0.8)"
                strokeWidth="4"
                markerEnd="url(#arrowhead)"
              />
            );
          })}
        </svg>
      </div>
    );
  };

  // Best move arrow untuk current position
  const bestMoveArrow = useMemo(() => {
    if (!hasGame || !fens[idx]) return [];
    
    const currentEval = evals[idx];
    if (!currentEval || !currentEval.bestmoveUci) return [];
    
    const uci = currentEval.bestmoveUci;
    if (uci.length < 4) return [];
    
    // Hanya tampilkan panah jika ada langkah selanjutnya dan berbeda dari best move
    if (idx < sans.length) {
      const playedSan = sans[idx];
      const bestSan = uciToSan(fens[idx], uci);
      
      console.log('[Arrow Debug] idx:', idx, 'played:', playedSan, 'best:', bestSan, 'bestUci:', uci);
      
      // Jika langkah yang dimainkan sama dengan best move, jangan tampilkan panah
      if (playedSan === bestSan) {
        console.log('[Arrow Debug] Played move matches best move, hiding arrow');
        return [];
      }
    }
    
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    
    // Try multiple arrow formats for compatibility
    const arrowFormats = [
      // Format 1: Standard object format
      [{
        from,
        to,
        color: 'rgba(0, 128, 0, 0.8)'
      }],
      // Format 2: Array format [from, to, color]
      [[from, to, 'rgba(0, 128, 0, 0.8)']],
      // Format 3: String format
      [`${from}${to}`]
    ];
    
    const selectedFormat = arrowFormats[0]; // Use first format
    console.log('[Arrow Debug] Showing arrow from', from, 'to', to, 'format:', selectedFormat);
    
    return selectedFormat;
  }, [hasGame, fens, idx, evals, sans]);

  // Use last known evaluation to avoid the bar snapping to center while new eval is pending
  const { effectiveEval, effectiveSide } = useMemo(() => {
    const currFen = fens[idx];
    const prevFen = fens[idx - 1];
    const currEval = evals[idx];
    const prevEval = evals[idx - 1];

    // Terminal override: if current position is already a checkmate/stalemate, show that immediately
    if (currFen) {
      const term = getTerminalEval(currFen);
      if (term) {
        return { effectiveEval: term, effectiveSide: currFen.split(' ')[1] };
      }
    }

    if (currEval && currFen) {
      return { effectiveEval: currEval, effectiveSide: currFen.split(' ')[1] };
    }

    // Fallback: neutral until current analysis arrives (do not carry previous eval)
    return { effectiveEval: null, effectiveSide: (currFen?.split(' ')[1]) || 'w' };
  }, [evals, fens, idx]);

  // Terminal position override: if FEN is checkmate/stalemate, produce an immediate evaluation
  function getTerminalEval(fen) {
    try {
      const g = new Chess(fen);
      if (g.isCheckmate()) {
        // mate already on board; our EvaluationBar treats mate:0 specially (winner = side that just moved)
        return { mate: 0 };
      }
      if (g.isStalemate()) {
        return { cp: 0 };
      }
    } catch {}
    return null;
  }

  // --- Util: path ikon anotasi dari folder public/moveIcon/ ---
  function getMoveIconPath(tag) {
    if (!tag) return null;
    const key = String(tag).toLowerCase();
    const map = {
      brilliant: '/moveIcon/brilliant.png',
      great: '/moveIcon/great.png',
      best: '/moveIcon/best.png',
      excellent: '/moveIcon/excellent.png',
      good: '/moveIcon/good.png',
      inaccuracy: '/moveIcon/inaccuracy.png',
      mistake: '/moveIcon/mistake.png',
      blunder: '/moveIcon/blunder.png',
      miss: '/moveIcon/miss.png'
    };
    return map[key] || null;
  }

  // --- Util: highlight color for last move based on annotation tag ---
  function getHighlightColor(tag) {
    if (!tag) return 'rgba(255, 255, 0, 0.35)'; // default yellowish
    switch (String(tag).toLowerCase()) {
      case 'blunder':
        return 'rgba(255, 0, 0, 0.69)'; // red
      case 'mistake':
        return 'rgba(234, 88, 12, 0.45)'; // orange-ish
      case 'miss':
        return 'rgba(244, 114, 182, 0.45)'; // pink
      case 'inaccuracy':
        return 'rgba(234, 179, 8, 0.45)'; // yellow
      case 'good':
        return 'rgba(34, 197, 94, 0.30)'; // light green
      case 'best':
      case 'excellent':
        return 'rgba(30, 255, 0, 0.45)'; // dark green
      case 'brilliant':
        return 'rgba(34, 211, 238, 0.45)'; // cyan
      case 'great':
        return 'rgb(0, 162, 255)'; // blue
      default:
        return 'rgba(255, 255, 0, 0.35)';
    }
  }

  // --- Overlay: icon klasifikasi di pojok kanan atas petak tujuan langkah terakhir ---
  function MoveBadgeOverlay({ square, tag, boardSize = 500 }) {
    if (!square || !tag) return null;
    const icon = getMoveIconPath(tag);
    if (!icon) return null;

    const squareSize = boardSize / 8;
    
    // Get top-left coordinates of a square
    const getSquareTopLeft = (sq) => {
      const file = sq.charCodeAt(0) - 'a'.charCodeAt(0); // 0..7
      const rank = parseInt(sq[1], 10) - 1;               // 0..7 (rank 1=0)
      const x = file * squareSize;
      const y = (7 - rank) * squareSize;
      return { x, y };
    };

    const { x, y } = getSquareTopLeft(square);
    const size = 42;        // px
    const inset = -15;         // distance from the square edges (inside)
    const left = x + squareSize - size - inset; // right side inside the square
    const top = y + inset;                      // top inside the square

    return (
      <div style={{ position: 'absolute', pointerEvents: 'none', left: 0, top: 0, width: boardSize, height: boardSize, zIndex: 11 }}>
        <img
          src={icon}
          alt={tag}
          title={tag}
          style={{ position: 'absolute', left, top, width: size, height: size, borderRadius: '50%', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.28))' }}
        />
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="main-layout">
        {/* Left Side - Board Section */}
        <div className="left-section">
          {/* PGN Input Section */}
          <div className="pgn-input-section">
            <div className="pgn-input-row">
              <input
                type="file"
                accept=".pgn"
                onChange={handleFile}
                className="file-input"
              />
              <button
                onClick={() => {
                  setPgn(`[Event "Fool's Mate"]
[Site "?"]
[Date "2025.08.18"]
[Round "?"]
[White "Anon"]
[Black "Anon"]
[Result "0-1"]

1. f3 e5 2. g4 Qh4# 0-1
`);
                }}
                className="btn-example"
              >
                Example
              </button>
            </div>
            
            <div className="pgn-input-row">
              <textarea
                className="textarea-pgn"
                placeholder="Paste your PGN here..."
                value={pgn}
                onChange={(e) => setPgn(e.target.value)}
              />
              <button
                onClick={handleAnalyze}
                disabled={!pgn.trim() || thinking}
                className="btn-analyze"
              >
                {thinking ? 'Analyzing...' : 'Analyze'}
              </button>
            </div>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}
          </div>

          {/* Chess Board Section */}
          <div className="board-container">
            <div className="board-wrapper">
              <div className="board-with-eval">
                {!thinking && (
                  <EvaluationBar 
                    evaluation={effectiveEval}
                    sideToMove={effectiveSide}
                  />
                )}
                <div style={{ width: '500px', height: '500px', position: 'relative', marginLeft: 0 }}>
                  <Chessboard
                    id="analysis-board"
                    position={hasGame ? (fens[idx] || 'start') : 'start'}
                    boardWidth={500}
                    arePiecesDraggable={false}
                    showBoardNotation={true}
                    animationDuration={300}
                    customBoardStyle={{ borderRadius: '4px', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
                    customSquareStyles={lastMove ? {
                      [lastMove.from]: { backgroundColor: getHighlightColor(annotations[idx]?.tag) },
                      [lastMove.to]: { backgroundColor: getHighlightColor(annotations[idx]?.tag) }
                    } : {}}
                  />
                  {!thinking && <ArrowOverlay arrows={bestMoveArrow} boardSize={500} />}
                  {/* Ikon klasifikasi pada petak tujuan langkah terakhir */}
                  {hasGame && idx > 0 && annotations[idx] && lastMove?.to && (
                    <MoveBadgeOverlay
                      square={lastMove.to}
                      tag={annotations[idx]?.tag}
                      boardSize={500}
                    />
                  )}
                </div>
              </div>
              
              {/* Navigation Controls */}
              <div className="nav-controls">
                <button
                  className="nav-btn"
                  onClick={() => navigateToPosition(0)}
                  disabled={!hasGame}
                >
                  ⏮
                </button>
                <button
                  className="nav-btn"
                  onClick={() => navigateToPosition(Math.max(0, idx - 1))}
                  disabled={!hasGame}
                >
                  ◀
                </button>
                <div className="nav-slider">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, fens.length - 1)}
                    value={idx}
                    onChange={(e) => navigateToPosition(parseInt(e.target.value, 10))}
                    disabled={!hasGame}
                  />
                </div>
                <button
                  className="nav-btn"
                  onClick={() => navigateToPosition(Math.min(fens.length - 1, idx + 1))}
                  disabled={!hasGame}
                >
                  ▶
                </button>
                <button
                  className="nav-btn"
                  onClick={() => navigateToPosition(fens.length - 1)}
                  disabled={!hasGame}
                >
                  ⏭
                </button>
              </div>

              {/* Status message when no game loaded */}
              {!hasGame && (
                <div className="status-message">
                  Paste PGN content above and click Analyze to start
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side - Analysis Panel */}
        <div className="right-panel">
          {thinking && (
            <div className="analyzing-overlay">
              <div style={{ width: '80%', maxWidth: 280 }}>
                <div className="engine-status" style={{ marginBottom: 12 }}>
                  <span className="engine-label">Analyzing game…</span>
                  <span className="status-badge status-loading">Working</span>
                </div>
                <div className="progress-bar" style={{ overflow: 'hidden' }}>
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.round(analyzeProgress * 100)}%`, animation: 'none', transition: 'width 200ms ease' }}
                  />
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: '#D1D5DB', textAlign: 'right' }}>
                  {Math.round(analyzeProgress * 100)}%
                </div>
              </div>
            </div>
          )}
          <div className={`right-panel-content ${thinking ? 'blurred' : ''}`}>
            {/* Player Names */}
            <div className="card">
              <div className="player-header">
                <div className="player-names">
                  {playerNames.white} vs {playerNames.black}
                </div>
                <div className="move-counter">
                  Move {idx} of {Math.max(0, fens.length - 1)}
                </div>
              </div>
            </div>

            {/* Player Stats */}
            <div>
              {/* White Player Stats */}
              <div className="card stats-card" style={{ marginBottom: '16px' }}>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-label">Accuracy</div>
                    <div className="stat-value accuracy">{playerStats.white.accuracy.toFixed(2)}%</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-label">Game Rating</div>
                    <div className="stat-value rating">{playerStats.white.gameRating}</div>
                  </div>
                </div>
              </div>

              {/* Black Player Stats */}
              <div className="card stats-card">
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-label">Accuracy</div>
                    <div className="stat-value accuracy">{playerStats.black.accuracy.toFixed(2)}%</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-label">Game Rating</div>
                    <div className="stat-value rating">{playerStats.black.gameRating}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Engine Status */}
            <div className="card">
              <div className="engine-status">
                <span className="engine-label">Engine Status</span>
                {engineReady ? (
                  <span className="status-badge status-ready">
                    Ready
                  </span>
                ) : (
                  <span className="status-badge status-loading">
                    Loading...
                  </span>
                )}
              </div>
              
              {thinking && (
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${Math.round(analyzeProgress * 100)}%`, animation: 'none', transition: 'width 200ms ease' }}></div>
                </div>
              )}
            </div>

            {/* Evaluation Chart */}
            {hasGame && chartData.length > 0 && !thinking && (
              <div className="card full-height">
                <h3 className="card-title">Evaluation</h3>
                <div className="chart-container">
                  <ResponsiveContainer>
                    <LineChart data={chartData}>
                      <defs>
                        <linearGradient id="whiteArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="50%" stopColor="rgba(255,255,255,0.1)" />
                          <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
                        </linearGradient>
                        <linearGradient id="blackArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgba(0,0,0,0.3)" />
                          <stop offset="50%" stopColor="rgba(0,0,0,0.1)" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#4B5563" />
                      <XAxis 
                        dataKey="move" 
                        stroke="#9CA3AF"
                        tick={{ fontSize: 10 }}
                        axisLine={{ stroke: '#6B7280' }}
                      />
                      <YAxis 
                        domain={[-3, 3]} 
                        stroke="#9CA3AF"
                        tick={{ fontSize: 10 }}
                        axisLine={{ stroke: '#6B7280' }}
                        tickFormatter={(value) => value > 0 ? `+${value}` : value}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#1F2937', 
                          border: '1px solid #4B5563',
                          borderRadius: '8px',
                          color: '#F3F4F6'
                        }}
                        formatter={(value) => [
                          value ? `${value > 0 ? '+' : ''}${value.toFixed(1)}` : 'N/A', 
                          'Evaluation'
                        ]}
                        labelFormatter={(move) => `Move ${move}`}
                      />
                      {/* Reference line at y=0 */}
                      <Line 
                        type="monotone" 
                        dataKey={() => 0}
                        stroke="#6B7280"
                        strokeWidth={1}
                        strokeDasharray="2 2"
                        dot={false}
                        activeDot={false}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="pawns" 
                        stroke="#3B82F6" 
                        strokeWidth={2}
                        dot={{ fill: '#3B82F6', strokeWidth: 0, r: 2 }}
                        activeDot={{ r: 4, stroke: '#3B82F6', strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Move List */}
            {hasGame && (
              <div className="card full-height">
                <h3 className="card-title">Moves</h3>
                <div className="move-list">
                  {sans.map((san, i) => {
                    const moveNum = Math.floor(i / 2) + 1;
                    const isWhite = i % 2 === 0;
                    const annotation = annotations[i + 1];
                    
                    return (
                      <div
                        key={i}
                        className={`move-item ${idx === i + 1 ? 'active' : ''}`}
                        onClick={() => navigateToPosition(i + 1)}
                      >
                        {isWhite && <span className="move-number">{moveNum}.</span>}
                        <span className="move-san">{san}</span>
                        {!thinking && annotation && (
                          <span className={`move-annotation annotation-${annotation.tag.toLowerCase()}`}>
                            {annotation.tag === 'Brilliant' ? '!!' :
                             annotation.tag === 'Great' ? '!' :
                             annotation.tag === 'Inaccuracy' ? '?!' :
                             annotation.tag === 'Mistake' ? '?' :
                             annotation.tag === 'Blunder' ? '??' :
                             annotation.tag === 'Miss' ? '??' : 
                             annotation.tag}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
