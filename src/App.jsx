import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import Landing from "./components/Landing.jsx";
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
  Area,
  ComposedChart,
  ReferenceLine,
} from "recharts";

// --- Evaluation Bar Component ---
function EvaluationBar({ evaluation, sideToMove, barHeight = 500, barWidth = 30 }) {
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
    // Prefer mate reported in multipv rank#1 if top-level doesn't carry it
    const pv1Mate = (() => {
      try {
        const pv1 = Array.isArray(evaluation.multipv) ? evaluation.multipv.find(x => x.rank === 1) : null;
        if (pv1 && ('mate' in pv1)) return Number(pv1.mate);
      } catch {}
      return null;
    })();
    const mateVal = ('mate' in evaluation) ? Number(evaluation.mate) : pv1Mate;
    if (mateVal != null) {
      // Mate score is relative to side-to-move. Convert to White perspective.
      const mWhite = sideToMove === 'w' ? mateVal : -mateVal;
      // Use a large sentinel to map to near-edges; actual percentage handled below
      return mWhite > 0 ? 10 : -10;
    }
    if ('cp' in evaluation) {
      const cpWhite = sideToMove === 'b' ? -evaluation.cp : evaluation.cp;
      return cpWhite / 100;
    }
    return 0;
  };

  // Numeric label text displayed inside the bar (bottom)
  const labelText = (() => {
    if (!evaluation) return '';
    if ('mate' in evaluation) {
      const m = Number(evaluation.mate);
      if (m === 0) {
        // Side-to-move is checkmated; winner is the opposite side
        return sideToMove === 'w' ? '0-1' : '1-0';
      }
      const sign = Math.sign(m);
      return sign > 0 ? `M${Math.abs(m)}` : `M-${Math.abs(m)}`;
    }
    if ('cp' in evaluation) {
      const pawns = (evaluation.cp / 100).toFixed(1);
      return `${pawns}`;
    }
    return '';
  })();

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

  return (
    <div style={{ position: 'relative', width: barWidth, height: barHeight, borderRadius: 6, overflow: 'hidden', background: '#111827', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)', flex: `0 0 ${barWidth}px` }}>
      <div style={{ position: 'absolute', left: 0, top: blackHeight + '%', width: '100%', height: whiteHeight + '%', background: '#ffffff' }} />
      {/* Label di dalam bar bagian bawah */}
      <div style={{ position: 'absolute', left: 0, bottom: 6, width: '100%', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#111827' }}>
        {labelText}
      </div>
    </div>
  );
}

// --- Captured pieces row component ---
function CapturedRow({ caps, oppCaps, color = 'white' }) {
  // Tampilkan bidak LAWAN yang berhasil ditangkap oleh pemain pada baris ini.
  // Jadi di sisi White, tampilkan bidak hitam; di sisi Black, tampilkan bidak putih.
  const prefix = color === 'white' ? 'b' : 'w';
  const order = ['q','r','b','n','p'];
  // Display icons from opponent pieces captured by this player
  const c = oppCaps || { p:0,n:0,b:0,r:0,q:0 };
  const size = 16; // ukuran ikon kecil 16px
  const items = [];
  order.forEach(t => {
    const count = c[t] || 0;
    for (let i=0; i<count; i++) {
      const code = `${prefix}${t.toUpperCase()}`; // contoh: wQ, bN
      const src = `/pieces/${code}.png`;
      items.push({ src, code, i });
    }
  });
  // Hitung keunggulan materi untuk pemain pada baris ini (positif jika pemain ini unggul)
  const values = { p:1, n:3, b:3, r:5, q:9 };
  const sumVals = (obj) => {
    if (!obj) return 0;
    let s = 0; for (const k of Object.keys(values)) s += (obj[k] || 0) * values[k];
    return s;
  };
  // oppCaps = buah yang ditangkap oleh pemain ini, caps = buah yang hilang dari pemain ini
  const lead = sumVals(oppCaps) - sumVals(caps);
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', minHeight: size }}>
      {items.map((it, idx) => (
        <img
          key={`${it.code}-${idx}`}
          src={it.src}
          alt={it.code}
          width={size}
          height={size}
          style={{ display: 'block', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))' }}
          loading="lazy"
        />
      ))}
      {lead > 0 && (
        <span style={{ marginLeft: 6, color: '#10B981', fontWeight: 700, fontSize: 13 }}>+{lead}</span>
      )}
    </div>
  );
}

// --- Minimal Error Boundary ---
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error, info) { console.error('ErrorBoundary caught:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, background: '#7f1d1d', border: '1px solid #b91c1c', borderRadius: 8, color: '#fecaca' }}>
          Terjadi kesalahan saat merender komponen. Silakan coba lagi.
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Util: deteksi exchange sacrifice (mis. Rxd5: rook (5) menangkap minor (3) → korbankan nilai ≥2)
function isExchangeSacrifice(fen, san) {
  try {
    const values = { p:1, n:3, b:3, r:5, q:9, k:0 };
    const g = new Chess(fen);
    const before = materialScore(g);
    const m = g.move(san, { sloppy: true });
    if (!m) return false;
    // Hanya relevan jika ini capture
    if (!m.flags || !m.flags.includes('c')) return false;
    const movedType = m.piece; // 'r','n','b','q','k','p'
    const capturedType = m.captured; // 'p','n','b','r','q'
    if (!movedType || !capturedType) return false;
    const delta = (values[movedType] || 0) - (values[capturedType] || 0);
    // Exchange sacrifice jika nilai buah yang bergerak lebih besar ≥2 dibanding yang ditangkap
    return delta >= 2;
  } catch {
    return false;
  }
}

// --- Util: compute worst immediate capture loss for mover after playing SAN (any capture, any square)
function worstImmediateCaptureLoss(fen, san, moverSide) {
  try {
    const before = new Chess(fen);
    const m = before.move(san, { sloppy: true });
    if (!m) return null;
    const after = before; // position after mover's move
    const scoAfter = materialScore(after);
    const opponentMoves = after.moves({ verbose: true });
    let worst = 0; // most negative
    let found = false;
    for (const om of opponentMoves) {
      if (!om.flags.includes('c')) continue;
      const test = new Chess(after.fen());
      test.move({ from: om.from, to: om.to, promotion: om.promotion });
      const scoCap = materialScore(test);
      const delta = (moverSide === 'w') ? (scoCap.w - scoAfter.w) : (scoCap.b - scoAfter.b);
      if (!found || delta < worst) { worst = delta; found = true; }
    }
    return found ? worst : null;
  } catch {
    return null;
  }
}

// --- Util: normalize SAN for comparison (strip trailing +, #, !, ? characters) ---
function normalizeSan(san) {
  if (!san) return san;
  return String(san).replace(/[+#!?]+$/g, '').trim();
}

// --- Util: get moved piece type ('p','n','b','r','q','k') for a SAN move on a FEN ---
function getMovedPieceType(fen, san) {
  try {
    const g = new Chess(fen);
    const mv = g.move(san, { sloppy: true });
    if (!mv) return null;
    return mv.piece || null;
  } catch {
    return null;
  }
}

// --- Util: strict piece sacrifice offer (relaxed): counts capture/exchange sacs too.
// Thresholds (net loss after best capture/recapture on target square): Q>=5, R>=3, N/B>=2 ---
function isStrictPieceSacrificeOffer(fen, san, moverSide) {
  try {
    const moved = getMovedPieceType(fen, san);
    if (!moved || moved === 'k' || moved === 'p') return false;
    const loss = offeredSacrificeLossMagnitude(fen, san, moverSide); // negative for mover
    if (typeof loss !== 'number') return false;
    // Relaxed thresholds so that realistic sacrifice (including exchange sacs) count as piece sacrifice
    // Queen: lose at least ~half a queen value; Rook: lose ≥3; Minor: lose ≥2 after best reply/recapture sequence
    if (moved === 'q') return loss <= -5;
    if (moved === 'r') return loss <= -3;
    if (moved === 'b' || moved === 'n') return loss <= -2;
    return false;
  } catch {
    return false;
  }
}

// --- Util: magnitude of offered sacrifice (pawns) if opponent captures the offered piece immediately.
// Returns a negative number for material loss by the mover (e.g., -9 for queen), or null if no such capture.
function offeredSacrificeLossMagnitude(fen, san, moverSide) {
  try {
    const before = new Chess(fen);
    const wasInCheck = before.in_check();
    const move = before.move(san, { sloppy: true });
    if (!move) return null;
    const after = before; // after mover's move
    const scoAfter = materialScore(after);
    const opponentMoves = after.moves({ verbose: true });
    const targetSquare = move.to;
    let found = false;
    let worstDelta = 0; // most negative for mover
    for (const om of opponentMoves) {
      if (om.to !== targetSquare || !om.flags.includes('c')) continue;
      const afterOpp = new Chess(after.fen());
      afterOpp.move({ from: om.from, to: om.to, promotion: om.promotion });
      const scoAfterOpp = materialScore(afterOpp);

      // Look for immediate recapture by mover on the same square
      const recaps = afterOpp.moves({ verbose: true }).filter(rm => rm.flags.includes('c') && rm.to === targetSquare);
      let bestAfterRecapScore = null; // best for mover (maximize mover's material)
      for (const rm of recaps) {
        const tmp = new Chess(afterOpp.fen());
        tmp.move({ from: rm.from, to: rm.to, promotion: rm.promotion });
        const sco = materialScore(tmp);
        const val = (moverSide === 'w') ? sco.w : sco.b;
        if (bestAfterRecapScore == null || val > bestAfterRecapScore) bestAfterRecapScore = val;
      }

      const baseSideVal = (moverSide === 'w') ? scoAfter.w : scoAfter.b;
      let delta;
      if (bestAfterRecapScore != null) {
        // Net loss after optimal immediate recapture
        delta = bestAfterRecapScore - baseSideVal;
      } else {
        // No recapture: use post-opponent-capture value
        const sideValAfterOpp = (moverSide === 'w') ? scoAfterOpp.w : scoAfterOpp.b;
        delta = sideValAfterOpp - baseSideVal;
      }

      if (!found || delta < worstDelta) { worstDelta = delta; found = true; }
    }
    if (found) return worstDelta;
    return null;
  } catch {
    return null;
  }
}

// --- Heuristic: is there any opponent capture on the moved piece's target square? ---
function hasOpponentCaptureOnTarget(fen, san) {
  try {
    const before = new Chess(fen);
    const mv = before.move(san, { sloppy: true });
    if (!mv) return false;
    const after = before;
    const targetSquare = mv.to;
    const opponentMoves = after.moves({ verbose: true });
    return opponentMoves.some(m => m.flags.includes('c') && m.to === targetSquare);
  } catch {
    return false;
  }
}

// --- Heuristic: after opponent captures that target square, does mover have an immediate checking reply? ---
function moverHasImmediateCheckAfterTargetCapture(fen, san, moverSide) {
  try {
    const before = new Chess(fen);
    const mv = before.move(san, { sloppy: true });
    if (!mv) return false;
    const targetSquare = mv.to;
    const after = before; // opponent to move
    const opponentMoves = after.moves({ verbose: true }).filter(m => m.flags.includes('c') && m.to === targetSquare);
    for (const om of opponentMoves) {
      const afterOpp = new Chess(after.fen());
      afterOpp.move({ from: om.from, to: om.to, promotion: om.promotion });
      // now mover's turn; look for any checking move (strong forcing signal)
      const replies = afterOpp.moves({ verbose: true });
      for (const r of replies) {
        const tmp = new Chess(afterOpp.fen());
        tmp.move({ from: r.from, to: r.to, promotion: r.promotion });
        if (tmp.in_checkmate()) return true; // mate in 1 after capture → surely brilliant
        if (r.san && /\+/.test(r.san)) return true; // any check reply considered a strong punish
      }
    }
    return false;
  } catch {
    return false;
  }
}

// --- Worker: memuat Stockfish dari CDN di dalam Web Worker ---
function createStockfishWorker(url = '/stockfish/stockfish-17.1-8e4d048.js') {
  // Build absolute URL without cache-buster; Stockfish scripts resolve wasm paths relative to this URL
  const abs = new URL(url, window.location.origin).toString();
  return new Worker(abs, { type: 'classic', name: 'stockfish' });
}

// --- Util: parse PGN jadi daftar FEN + SAN ---
function parsePgnToFens(pgn) {
  const raw = (pgn ?? '').toString();
  // Normalisasi line-ending agar Chess.js tidak bingung dengan CRLF Windows
  let normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized.endsWith('\n')) normalized += '\n';
  const game = new Chess();
  try {
    const opts = { sloppy: true, newlineChar: '\n' };
    const loader = (g, s) => (typeof g.loadPgn === 'function' ? g.loadPgn(s, opts) : (typeof g.load_pgn === 'function' ? g.load_pgn(s, opts) : false));
    let ok = loader(game, normalized);
    if (!ok) {
      // Fallback: buang header [Tags] dan ambil movetext mulai dari nomor langkah pertama
      // Pastikan ada blank line antara header dan movetext
      const lines = normalized.split('\n');
      let lastTagIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*\[.*\]\s*$/.test(lines[i])) lastTagIdx = i; else break;
      }
      if (lastTagIdx >= 0) {
        const hasBlank = lines[lastTagIdx + 1] === '';
        if (!hasBlank) {
          lines.splice(lastTagIdx + 1, 0, '');
        }
      }
      const normalizedWithBlank = lines.join('\n');
      ok = loader(game, normalizedWithBlank);
      if (!ok) {
        const noTags = normalizedWithBlank
        .split('\n')
        .filter(line => !/^\s*\[.*\]\s*$/.test(line))
        .join(' ');
        const idxFirstMove = noTags.search(/\d+\s*\./);
        if (idxFirstMove >= 0) {
          let movetext = noTags.slice(idxFirstMove).trim();
          // normalisasi spasi
          movetext = movetext.replace(/\s+/g, ' ').trim();
          if (!movetext.endsWith('\n')) movetext += '\n';
          ok = loader(game, movetext);
        }
      }
    }
    if (!ok) throw new Error('format PGN tidak dikenali');

    const moves = game.history({ verbose: true });
    if (!Array.isArray(moves) || moves.length === 0) {
      throw new Error('PGN tidak mengandung langkah yang valid');
    }

    const walk = new Chess();
    const fens = [walk.fen()];
    const sans = [];
    // Build captures progress: index i corresponds to position after i moves (same as fens[i])
    const emptyCaps = () => ({ p:0, n:0, b:0, r:0, q:0 });
    const capsProgress = [{ white: emptyCaps(), black: emptyCaps() }];
    let accWhite = emptyCaps();
    let accBlack = emptyCaps();
    for (const mv of moves) {
      walk.move(mv);
      fens.push(walk.fen());
      sans.push(mv.san);
      // track captured
      if (mv.captured) {
        // mover color mv.color captures opponent piece mv.captured
        const t = mv.captured; // 'p','n','b','r','q'
        if (mv.color === 'w') accWhite = { ...accWhite, [t]: (accWhite[t] || 0) + 1 };
        else accBlack = { ...accBlack, [t]: (accBlack[t] || 0) + 1 };
      }
      capsProgress.push({ white: { ...accWhite }, black: { ...accBlack } });
    }
    // Extract headers (fallback to regex over tags)
    const tags = {};
    normalized.split('\n').forEach((line) => {
      const m = line.match(/^\s*\[(\w+)\s+"(.*)"\]\s*$/);
      if (m) tags[m[1]] = m[2];
    });
    const headers = {
      White: tags.White || 'White Player',
      Black: tags.Black || 'Black Player',
      WhiteElo: tags.WhiteElo || tags.WhiteELO || '',
      BlackElo: tags.BlackElo || tags.BlackELO || ''
    };
    return { fens, sans, game, headers, captures: capsProgress };
  } catch (e) {
    // Fallback terakhir: parse SAN manual dari movetext sederhana
    try {
      const stripTags = (s) => s.replace(/^\s*\[.*\]\s*$\n?/gm, '');
      const stripComments = (s) => s
        .replace(/\{[^}]*\}/g, ' ')    // {comments}
        .replace(/;.*$/gm, ' ')         // ; comments per-line
        .replace(/\$\d+/g, ' ');       // NAGs
      const stripResults = (s) => s.replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, ' ');
      const stripMoveNums = (s) => s.replace(/\d+\s*\.\.\.|\d+\s*\./g, ' ');
      let text = stripTags(normalized);
      text = stripComments(text);
      text = stripResults(text);
      text = stripMoveNums(text);
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) throw e;

      const walk = new Chess();
      const fens = [walk.fen()];
      const sans = [];
      const tokens = text.split(' ');
      for (const tok of tokens) {
        const mv = walk.move(tok, { sloppy: true });
        if (!mv) {
          // jika token bukan SAN, abaikan (mis. spasi ganda)
          continue;
        }
        sans.push(mv.san);
        fens.push(walk.fen());
      }
      if (sans.length === 0) throw e;
      // rebuild captures for fallback tokens
      const emptyCaps = () => ({ p:0, n:0, b:0, r:0, q:0 });
      const capsProgress = [{ white: emptyCaps(), black: emptyCaps() }];
      let accWhite = emptyCaps();
      let accBlack = emptyCaps();
      const hist = walk.history({ verbose: true });
      for (const mv of hist) {
        if (mv.captured) {
          const t = mv.captured;
          if (mv.color === 'w') accWhite = { ...accWhite, [t]: (accWhite[t] || 0) + 1 }; else accBlack = { ...accBlack, [t]: (accBlack[t] || 0) + 1 };
        }
        capsProgress.push({ white: { ...accWhite }, black: { ...accBlack } });
      }
      // headers via tags stripped earlier
      const tags = {};
      raw.replace(/\r\n/g,'\n').split('\n').forEach((line)=>{ const m=line.match(/^\s*\[(\w+)\s+"(.*)"\]\s*$/); if(m) tags[m[1]]=m[2]; });
      const headers = {
        White: tags.White || 'White Player',
        Black: tags.Black || 'Black Player',
        WhiteElo: tags.WhiteElo || tags.WhiteELO || '',
        BlackElo: tags.BlackElo || tags.BlackELO || ''
      };
      return { fens, sans, game: walk, headers, captures: capsProgress };
    } catch (e2) {
      throw new Error('PGN tidak valid atau gagal di-parse: ' + (e?.message || e));
    }
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
    const wasInCheck = before.in_check();
    const move = before.move(san, { sloppy: true });
    if (!move) return false;
    // Hanya anggap "offered sacrifice" jika LANGKAHNYA BUKAN CAPTURE.
    // Jika langkah adalah capture (mis. qxg3), itu biasanya trade/recapture dan bukan offering.
    if (move.flags && move.flags.includes('c')) return false;
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
        // Jika sebelumnya sedang skak dan langkah ini hanya "menutup skak",
        // naikkan ambang pengorbanan agar tidak gampang disebut Brilliant.
        const threshold = wasInCheck ? -5 : -3; // butuh ≥5 pion saat menutup skak
        if (delta <= threshold) return true; // pelaku langkah kehilangan materi besar setelah tangkapan terbaik
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

// Map mate distance to a large centipawn-like score that preserves distance.
// Example: mate +3 -> +97,000; mate +1 -> +99,000; mate -3 -> -97,000, etc.
function mateToScore(mate) {
  const base = 100000;
  const step = 1000; // distance granularity
  const n = Math.min(99, Math.abs(Number(mate) || 0));
  return Math.sign(mate) * (base - n * step);
}

// Classify a move by loss against engine best (in centipawns), mover's perspective.
function classifyMoveByDelta(bestCp, playedCp, flags) {
  // bestCp/playedCp: higher is better for mover
  // loss = best - played (>=0 means worse than best)
  const loss = (bestCp ?? 0) - (playedCp ?? 0);


  // If both best and played still mate for mover, classify by mate-distance delta instead of raw cp
  if (typeof flags?.deltaMateForMover === 'number') {
    const d = flags.deltaMateForMover; // >0 means slower mate; <0 faster
    if (d < 0) return "Best";                // faster mate
    if (d === 0) return "Best";              // same mate distance
    if (d === 1) return "Excellent";         // one ply slower
    if (d <= 3) return "Good";               // a few plies slower
    if (d <= 6) return "Inaccuracy";         // noticeably slower
    if (d <= 10) return "Mistake";           // much slower but still winning
    // Only call blunder if mate distance explodes massively
    return "Mistake";
  }

  // Jika langkah LEBIH BAIK dari PV#1 (loss < 0), jangan dihukum: anggap 'Best'
  if (loss < -10) return "Best";

  // Blunder: sangat buruk atau membalik hasil besar → netral/berlawanan
  if (loss > 300 ||
      (bestCp != null && playedCp != null && (
        (bestCp >= 300 && playedCp <= 0) ||
        (bestCp <= -300 && playedCp >= 0)
      ))) {
    return "Blunder";
  }

  // Miss (taktik terlewat) – dievaluasi setelah blunder agar tidak menimpa blunder besar
  if (flags?.bestIsMate || (bestCp != null && bestCp >= 300)) {
    if (playedCp != null && playedCp <= 50 && loss <= 200) return "Miss"; // jangan label Miss kalau kerugiannya sudah besar → biar jatuh ke Mistake/Blunder
  }

  if (loss <= 10) return "Best";        // sama PV#1 atau selisih ≤10cp
  if (loss <= 20) return "Excellent";
  if (loss <= 50) return "Good";
  if (loss <= 150) return "Inaccuracy";
  if (loss <= 300) return "Mistake";
  return "Blunder";
}

// --- Util: parse PGN jadi daftar FEN + SAN ---
// Removed duplicate definition

export default function App() {
  const [pgn, setPgn] = useState("");
  const [game, setGame] = useState(null);
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
  const [playerElos, setPlayerElos] = useState({ white: '', black: '' });
  const [capturesProgress, setCapturesProgress] = useState([]); // array of { white: {p,n,b,r,q}, black: {...} }
  const [engineReady, setEngineReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [showLanding, setShowLanding] = useState(true); // tampilkan landing page di awal

  // Worker Stockfish (opsional)
  const workerRef = useRef(null);
  // Simple in-memory cache: key by fen + options signature
  const evalCacheRef = useRef(new Map());
  // Debug toggle for annotation logic
  const DEBUG_ANNOT = true;

  // Responsive board size based on viewport; updates on resize
  const [boardSize, setBoardSize] = useState(500);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth || 1024;
      // On small screens, make board nearly full width minus paddings
      if (w <= 900) {
        const padding = 24 * 2; // left-section padding
        const size = Math.max(260, Math.min( Math.floor(w - padding - 16), 520));
        setBoardSize(size);
        setIsMobile(true);
      } else {
        setBoardSize(500);
        setIsMobile(false);
      }
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  // Use the same piece assets for both react-chessboard and captured pieces rows
  // We map piece codes (wK, wQ, ..., bP) to <img> components that load from /public/pieces/*.png
  const customPieces = useMemo(() => {
    const codes = ['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'];
    const map = {};
    codes.forEach((code) => {
      map[code] = ({ squareWidth }) => (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <img
            src={`/pieces/${code}.png`}
            alt={code}
            style={{ width: '86%', height: '86%', objectFit: 'contain' }}
            draggable={false}
          />
        </div>
      );
    });
    return map;
  }, []);



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
      const { fens: F, sans: S, captures: C } = parsePgnToFens(normalized);
      const names = extractPlayerNames(normalized);
      setFens(F);
      setSans(S);
      setPlayerNames(names);
      if (C) setCapturesProgress(C);
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
    reader.onload = () => {
      setPgn(String(reader.result || ""));
      setShowLanding(false);
    };
    reader.readAsText(file);
  }

  // Analisis 1 posisi (kembalikan evalObj {cp|mate} + multipv)
  const analyzeFenOnce = useCallback((fen, optionsDepthOrOpts = 12, multiPVArg = 5) => {
    return new Promise((resolve) => {
      const w = workerRef.current;
      if (!w) return resolve(null);
      // Determine options
      let depth = 12;
      let multiPV = 5;
      let movetime = null;
      if (typeof optionsDepthOrOpts === 'object' && optionsDepthOrOpts !== null) {
        depth = optionsDepthOrOpts.depth ?? depth;
        movetime = optionsDepthOrOpts.movetime ?? null;
        multiPV = optionsDepthOrOpts.multiPV ?? multiPVArg ?? 5;
      } else {
        depth = optionsDepthOrOpts ?? 12;
        multiPV = multiPVArg ?? 5;
      }

      // Terminal position short-circuit
      const terminal = getTerminalEval(fen);
      if (terminal) {
        const key = `${fen}|mv:${movetime ?? ''}|dp:${depth}|mpv:${multiPV}`;
        const res = { ...terminal, bestmoveUci: null, multipv: [] };
        evalCacheRef.current.set(key, res);
        return resolve(res);
      }

      // Cache check
      const cacheKey = `${fen}|mv:${movetime ?? ''}|dp:${depth}|mpv:${multiPV}`;
      if (evalCacheRef.current.has(cacheKey)) {
        return resolve(evalCacheRef.current.get(cacheKey));
      }

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
      // Send UCI commands directly (avoid ucinewgame here to keep hash warm)
      try { w.postMessage('setoption name MultiPV value ' + multiPV); } catch {}
      try { w.postMessage('position fen ' + fen); } catch {}
      if (movetime != null) {
        try { w.postMessage('go movetime ' + movetime); } catch {}
      } else {
        try { w.postMessage('go depth ' + depth); } catch {}
      }
    });
  }, []);

  // Analisis semua posisi berurutan
  const analyzeAll = useCallback(async (depth = 12, list, { fastFirstPass = true, movetime = 80, multiPV = 3, stableFinalPass = true, stableDepth = 14, stableMultiPV = 5 } = {}) => {
    const fenList = Array.isArray(list) ? list : fens;
    if (!engineReady || fenList.length === 0) return;
    setThinking(true);
    setAnalyzeProgress(0);
    const next = {};
    const w = workerRef.current;
    if (!w) {
      setThinking(false);
      return;
    }
    // Prepare engine once per batch with deterministic options
    try {
      w.postMessage('ucinewgame');
      w.postMessage('setoption name Clear Hash value true');
      w.postMessage('setoption name Threads value 1');
      w.postMessage('setoption name Hash value 32');
      w.postMessage('setoption name Ponder value false');
      w.postMessage('setoption name UCI_AnalyseMode value true');
      w.postMessage('setoption name UCI_LimitStrength value false');
      w.postMessage('setoption name Skill Level value 20');
      w.postMessage('setoption name Contempt value 0');
      w.postMessage('setoption name MultiPV value ' + (fastFirstPass ? multiPV : stableMultiPV));
    } catch {}
    for (let i = 0; i < fenList.length; i++) {
      // Use cache-aware fast first pass
      const opts = fastFirstPass ? { movetime, multiPV, depth: Math.min(depth, 12) } : { depth, multiPV: 5 };
      const ev = await analyzeFenOnce(fenList[i], opts);
      if (ev) {
        next[i] = ev;
        // store in cache explicitly as well (already done inside analyzeFenOnce but safe)
        const key = `${fenList[i]}|mv:${opts.movetime ?? ''}|dp:${opts.depth}|mpv:${opts.multiPV ?? ''}`;
        evalCacheRef.current.set(key, ev);
      }
      setAnalyzeProgress((i + 1) / fenList.length);
    }
    // Stable final pass: re-evaluate SELURUH posisi dengan parameter tetap agar hasil konsisten antar-run
    let finalEvals = next;
    if (stableFinalPass) {
      // Reset engine state for stable pass
      w.postMessage('ucinewgame');
      w.postMessage('setoption name Clear Hash value true');
      w.postMessage('setoption name Threads value 1');
      w.postMessage('setoption name Hash value 32');
      w.postMessage('setoption name Ponder value false');
      w.postMessage('setoption name UCI_AnalyseMode value true');
      w.postMessage('setoption name UCI_LimitStrength value false');
      w.postMessage('setoption name Skill Level value 20');
      w.postMessage('setoption name Contempt value 0');
      w.postMessage('setoption name MultiPV value ' + stableMultiPV);
      finalEvals = {};
      for (let i = 0; i < fenList.length; i++) {
        const ev2 = await analyzeFenOnce(fenList[i], { depth: stableDepth, multiPV: stableMultiPV });
        if (ev2) finalEvals[i] = ev2; else finalEvals[i] = next[i] ?? null;
        setAnalyzeProgress((i + 1) / fenList.length);
      }
    }

    // Auto-deepen verification: for strict sacrifice candidates where played move is NOT PV#1 at stable depth,
    // run a deeper check to confirm whether it becomes PV#1. If yes, update finalEvals[i] with the deeper result.
    try {
      const deepDepth = Math.max((stableFinalPass ? stableDepth : depth) + 4, 18);
      const deepMultiPV = Math.max(stableMultiPV || 5, 5);
      for (let i = 0; i < fenList.length - 1; i++) {
        const fen = fenList[i];
        if (!fen || !finalEvals[i]) continue;
        const moverSide = fen.split(' ')[1];
        const playedSan = sans[i];
        if (!playedSan) continue;
        if (!isStrictPieceSacrificeOffer(fen, playedSan, moverSide)) continue;
        // Compare with current PV#1
        const bestUci = finalEvals[i].bestmoveUci || (Array.isArray(finalEvals[i].multipv) ? finalEvals[i].multipv.find(x => x.rank === 1)?.uci : null);
        const bestSanNow = bestUci ? uciToSan(fen, bestUci) : null;
        if (bestSanNow && normalizeSan(bestSanNow) === normalizeSan(playedSan)) continue; // already PV#1

        // Deeper re-analysis for this position only
        const evDeep = await analyzeFenOnce(fen, { depth: deepDepth, multiPV: deepMultiPV });
        if (evDeep) {
          const deepBestUci = evDeep.bestmoveUci || (Array.isArray(evDeep.multipv) ? evDeep.multipv.find(x => x.rank === 1)?.uci : null);
          const deepBestSan = deepBestUci ? uciToSan(fen, deepBestUci) : null;
          if (deepBestSan && normalizeSan(deepBestSan) === normalizeSan(playedSan)) {
            finalEvals[i] = evDeep; // promote deeper verdict so annotations will mark Brilliant
          }
        }
      }
    } catch (e) {
      console.warn('Auto-deepen verification skipped due to error:', e?.message || e);
    }

    setEvals(finalEvals);
    setThinking(false);
  }, [engineReady, fens, analyzeFenOnce]);

  // Handlers: Quick and Deep analysis (placed AFTER analyzeAll definition)
  const handleQuickAnalyze = useCallback(() => {
    try {
      const parsed = parsePgnToFens(pgn);
      if (!parsed || !parsed.fens || parsed.fens.length === 0) {
        setError('PGN tidak valid atau kosong.');
        return;
      }
      setError('');
      setShowLanding(false);
      setGame(parsed.game);
      setFens(parsed.fens);
      setSans(parsed.sans);
      // set headers
      if (parsed.headers) {
        setPlayerNames({ white: parsed.headers.White || 'White Player', black: parsed.headers.Black || 'Black Player' });
        setPlayerElos({ white: parsed.headers.WhiteElo || '', black: parsed.headers.BlackElo || '' });
      }
      // set captures progress
      if (parsed.captures) setCapturesProgress(parsed.captures);
      setIdx(0);
      setEvals({});
      analyzeAll(12, parsed.fens, { fastFirstPass: true, stableFinalPass: false, movetime: 80, multiPV: 3 });
    } catch (e) {
      console.error('Quick analyze PGN error:', e);
      setError(e?.message || 'Gagal memproses PGN.');
    }
  }, [pgn, analyzeAll]);

  const handleDeepAnalyze = useCallback(() => {
    try {
      const parsed = parsePgnToFens(pgn);
      if (!parsed || !parsed.fens || parsed.fens.length === 0) {
        setError('PGN tidak valid atau kosong.');
        return;
      }
      setError('');
      setShowLanding(false);
      setGame(parsed.game);
      setFens(parsed.fens);
      setSans(parsed.sans);
      if (parsed.headers) {
        setPlayerNames({ white: parsed.headers.White || 'White Player', black: parsed.headers.Black || 'Black Player' });
        setPlayerElos({ white: parsed.headers.WhiteElo || '', black: parsed.headers.BlackElo || '' });
      }
      if (parsed.captures) setCapturesProgress(parsed.captures);
      setIdx(0);
      setEvals({});
      analyzeAll(14, parsed.fens, { fastFirstPass: false, stableFinalPass: true, stableDepth: 14, stableMultiPV: 5 });
    } catch (e) {
      console.error('Deep analyze PGN error:', e);
      setError(e?.message || 'Gagal memproses PGN.');
    }
  }, [pgn, analyzeAll]);

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
      analyzeAll(depth, undefined, { fastFirstPass: true, movetime: 80, multiPV: 3 });
    } else {
      setPendingAnalyze({ type: 'all', depth });
    }
  }, [engineReady, analyzeAll]);

  // When engine becomes ready, flush any pending analyze request
  useEffect(() => {
    if (engineReady && pendingAnalyze) {
      const { type, depth } = pendingAnalyze;
      if (type === 'current') {
        analyzeFenOnce(fens[idx], { depth, multiPV: 5 }).then((ev) => {
          if (ev) setEvals((prev) => ({ ...prev, [idx]: ev }));
        });
      } else if (type === 'all') {
        analyzeAll(depth, undefined, { fastFirstPass: true, movetime: 80, multiPV: 3 });
      }
      setPendingAnalyze(null);
    }
  }, [engineReady, pendingAnalyze, analyzeFenOnce, fens, idx, analyzeAll]);

  // Start with example PGN directly (bypass needing user to click Quick after filling)
  const startWithExample = useCallback(() => {
    const example = `[Event "Fool's Mate"]
[Site "?"]
[Date "2025.08.18"]
[Round "?"]
[White "Anon"]
[Black "Anon"]
[Result "0-1"]

1. f3 e5 2. g4 Qh4# 0-1
`;
    try {
      setPgn(example);
      const parsed = parsePgnToFens(example);
      setError('');
      setShowLanding(false);
      setGame(parsed.game);
      setFens(parsed.fens);
      setSans(parsed.sans);
      if (parsed.headers) {
        setPlayerNames({ white: parsed.headers.White || 'White Player', black: parsed.headers.Black || 'Black Player' });
        setPlayerElos({ white: parsed.headers.WhiteElo || '', black: parsed.headers.BlackElo || '' });
      }
      if (parsed.captures) setCapturesProgress(parsed.captures);
      setIdx(0);
      setEvals({});
      analyzeAll(12, parsed.fens, { fastFirstPass: true, stableFinalPass: false, movetime: 80, multiPV: 3 });
    } catch (e) {
      setError(e?.message || 'Gagal memulai contoh.');
    }
  }, [analyzeAll]);

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
      if ("mate" in best) bestCp = mateToScore(best.mate); else bestCp = best.cp;

      let playedCp;
      if ("mate" in after) {
        if (after.mate === 0) {
          // Langkah yang baru dimainkan menghasilkan skakmat segera
          // Dari perspektif pelaku langkah: ini kemenangan maksimum
          playedCp = 100000;
        } else {
          // Flip tanda karena setelah langkah giliran lawan
          playedCp = -mateToScore(after.mate);
        }
      } else playedCp = -after.cp; // flip cp

      // Compute mate distance delta for mover if applicable
      const bestMateForMover = ("mate" in best && Math.sign(best.mate) > 0) ? Math.abs(best.mate) : null;
      const playedMateForMover = ("mate" in after && (after.mate === 0 || Math.sign(after.mate) < 0)) ? Math.abs(after.mate) : null;
      const deltaMateForMover = (bestMateForMover != null && playedMateForMover != null)
        ? (playedMateForMover - bestMateForMover)
        : null;

      let tag = classifyMoveByDelta(bestCp, playedCp, {
        bestIsMate: "mate" in best && Math.sign(best.mate) > 0, // mate untuk mover
        deltaMateForMover
      });

      const deltaCp = (bestCp ?? 0) - (playedCp ?? 0);

      // Great / Brilliant detection: only-move and optional sacrifice
      const pvList = Array.isArray(best.multipv) ? best.multipv : [];
      const bestUci = best.bestmoveUci || pvList.find(x => x.rank === 1)?.uci || null;
      const bestSanRaw = bestUci ? uciToSan(fens[i], bestUci) : null;
      const playedSanRaw = sans[i];
      const bestSan = normalizeSan(bestSanRaw);
      const playedSan = normalizeSan(playedSanRaw);
      if (DEBUG_ANNOT) {
        console.debug('[Annot]', { i, bestSanRaw, playedSanRaw, bestSan, playedSan });
      }

      // If the played move equals engine best (SAN match), default to 'Best'.
      // Upgrade to 'Brilliant' if it constitutes a deliberate piece sacrifice (Q/R/N/B),
      // including capture sacrifices and exchange sacrifices, measured by net material loss
      // after opponent's best immediate capture on the target square (with best recapture by mover):
      // thresholds: Q>=5, R>=3, N/B>=2 pawns of net loss for the mover.
      if (bestSan && playedSan && playedSan === bestSan) {
        const movedType = getMovedPieceType(fens[i], playedSan); // 'p','n','b','r','q','k'
        let isPieceSacrifice = false;
        let sacLoss = null; // hoist so it's available for debug logging below
        if (movedType && movedType !== 'p' && movedType !== 'k') {
          sacLoss = offeredSacrificeLossMagnitude(fens[i], playedSan, moverSide);
          if (movedType === 'q' && sacLoss <= -5) isPieceSacrifice = true;
          else if (movedType === 'r' && sacLoss <= -3) isPieceSacrifice = true;
          else if ((movedType === 'n' || movedType === 'b') && sacLoss <= -2) isPieceSacrifice = true;
          // pawn sacrifices are ignored for Brilliant per request; king is impossible
        }
        if (DEBUG_ANNOT) {
          console.debug('[Annot][sac-offer]', { i, movedType, sacLoss, isPieceSacrifice });
        }
        tag = isPieceSacrifice ? 'Brilliant' : 'Best';
      }

      // Secondary upgrade: if played move is a qualifying sacrifice (same thresholds)
      // and is very close to PV#1 (loss <= 20cp from mover's perspective), treat as Brilliant.
      if (tag !== 'Brilliant' && playedSan) {
        const movedType3 = getMovedPieceType(fens[i], playedSan);
        if (movedType3 && movedType3 !== 'p' && movedType3 !== 'k') {
          const sacLoss3 = offeredSacrificeLossMagnitude(fens[i], playedSan, moverSide);
          const qualifies = (movedType3 === 'q' && sacLoss3 <= -5) ||
                           (movedType3 === 'r' && sacLoss3 <= -3) ||
                           ((movedType3 === 'n' || movedType3 === 'b') && sacLoss3 <= -2);
          const nearBest = (bestCp != null && playedCp != null && ((bestCp - playedCp) <= 20));
          if (DEBUG_ANNOT) {
            console.debug('[Annot][sac-nearBest]', { i, movedType3, sacLoss3, qualifies, bestCp, playedCp });
          }
          if (qualifies && nearBest) {
            tag = 'Brilliant';
          }
        }
      }

      // Compute only-move: all alternatives lose >=150cp vs best for mover
      let onlyMove = false;
      if (bestSan && playedSan && playedSan === bestSan && pvList.length >= 2) {
        const getCp = (item) => ('mate' in item) ? mateToScore(item.mate) : (item.cp);
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
        // Do NOT auto-upgrade to Brilliant di sini; tetap 'Great' kecuali aturan sacrifice ketat di atas sudah set Brilliant.
        if (tag !== 'Brilliant' && tag !== 'Best') {
          tag = 'Great';
        }
      }

      // Heuristik tambahan: jika langkah = PV#1 dan tampak seperti "offer" (lawan bisa makan di kotak target)
      // dan setelah capture itu pelaku punya balasan cek langsung, anggap Brilliant untuk N/B/R/Q.
      if (tag !== 'Brilliant' && bestSan && playedSan && playedSan === bestSan) {
        const movedType2 = getMovedPieceType(fens[i], playedSan);
        if (movedType2 && movedType2 !== 'p' && movedType2 !== 'k') {
          const capOnTarget = hasOpponentCaptureOnTarget(fens[i], playedSan);
          const checkAfter = moverHasImmediateCheckAfterTargetCapture(fens[i], playedSan, moverSide);
          if (DEBUG_ANNOT) {
            console.debug('[Annot][offer+check]', { i, movedType2, capOnTarget, checkAfter });
          }
          if (capOnTarget && checkAfter) {
            tag = 'Brilliant';
          }
        }
      }

      // Additional heuristic: For knight moves that are best moves and can be captured,
      // if the knight sacrifice leads to a significant positional advantage or tactical sequence,
      // mark as Brilliant even if material calculation doesn't meet strict thresholds
      if (tag !== 'Brilliant' && bestSan && playedSan && playedSan === bestSan) {
        const movedType4 = getMovedPieceType(fens[i], playedSan);
        if (movedType4 === 'n') { // specifically for knight moves
          const capOnTarget = hasOpponentCaptureOnTarget(fens[i], playedSan);
          if (capOnTarget) {
            // Check if this is a true sacrifice (knight can be taken for less than its value)
            const sacLoss4 = offeredSacrificeLossMagnitude(fens[i], playedSan, moverSide);
            // For knights, be more lenient - if there's any material loss and it's the best move,
            // and the evaluation is still good for the player, consider it brilliant
            if (sacLoss4 != null && sacLoss4 < 0 && bestCp != null && bestCp > -50) {
              if (DEBUG_ANNOT) {
                console.debug('[Annot][knight-sac]', { i, sacLoss4, bestCp, playedCp });
              }
              tag = 'Brilliant';
            }
          }
        }
      }

      // Fallback yang lebih kuat: jika langkah = PV#1 dan ada kehilangan materi langsung
      // setelah langkah ini (bisa ditangkap di mana pun) menurut worstImmediateCaptureLoss,
      // maka terapkan ambang sacrifice yang sama untuk promosi ke "Brilliant".
      if (tag !== 'Brilliant' && bestSan && playedSan && playedSan === bestSan) {
        const movedType5 = getMovedPieceType(fens[i], playedSan);
        if (movedType5 && movedType5 !== 'p' && movedType5 !== 'k') {
          const worstLoss = worstImmediateCaptureLoss(fens[i], playedSan, moverSide); // negatif untuk pelaku
          if (DEBUG_ANNOT) {
            console.debug('[Annot][worst-loss-fallback]', { i, movedType5, worstLoss });
          }
          if (typeof worstLoss === 'number') {
            const qualifies = (movedType5 === 'q' && worstLoss <= -5) ||
                              (movedType5 === 'r' && worstLoss <= -3) ||
                              ((movedType5 === 'n' || movedType5 === 'b') && worstLoss <= -2);
            if (qualifies) {
              tag = 'Brilliant';
            }
          }
        }
      }

      // Remove broad fallback Brilliant logic. We already applied the strict rule above (best move + real piece sacrifice).

      if (DEBUG_ANNOT) {
        console.debug('[Annot][final]', { i, tag, deltaCp });
      }
      if (tag) ann[i + 1] = { mover: moverSide === 'w' ? 'White' : 'Black', tag, delta: (deltaCp / 100) };
    }
    return ann;
  }, [fens, evals, sans]);

  // Calculate player statistics based on move analysis
  const playerStats = useMemo(() => {
    const stats = {
      white: { accuracy: 0, totalMoves: 0, goodMoves: 0, extraPenalty: 0, counts: { best:0, excellent:0, good:0, inaccuracy:0, mistake:0, blunder:0, miss:0 } },
      black: { accuracy: 0, totalMoves: 0, goodMoves: 0, extraPenalty: 0, counts: { best:0, excellent:0, good:0, inaccuracy:0, mistake:0, blunder:0, miss:0 } }
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
      let bestCp;
      if ("mate" in best) bestCp = mateToScore(best.mate); else bestCp = best.cp;

      let playedCp;
      if ("mate" in after) {
        // Jika setelah langkah posisi adalah mate (mate==0), berarti pelaku langkah memberi skakmat → +INF
        playedCp = (after.mate === 0) ? 100000 : (-mateToScore(after.mate));
      } else {
        playedCp = -after.cp;
      }
      
      const cpLoss = Math.max(0, (bestCp ?? 0) - (playedCp ?? 0));

      // --- Per-move accuracy with edge case handling ---
      let moveAccuracy;

      // H0. Hybrid perfect-move detection
      //  - 100% if played SAN equals PV#1 SAN
      //  - 100% if played SAN equals any PV whose score is within 5cp of PV#1
      //  - 100% if cpLoss <= 5 (treat tiny drift as zero loss)
      const pvList = Array.isArray(best.multipv) ? best.multipv : [];
      const playedSan = sans[i];
      let forcedPerfect = false;
      try {
        const getCpFromItem = (item) => (( 'mate' in item) ? mateToScore(item.mate) : item.cp);
        const pv1 = pvList.find(x => x.rank === 1);
        const pv1Uci = best.bestmoveUci || (pv1 ? pv1.uci : null);
        const pv1San = pv1Uci ? uciToSan(fens[i], pv1Uci) : null;
        if (pv1San && playedSan && playedSan === pv1San) {
          forcedPerfect = true;
        } else if (pv1) {
          const pv1Cp = getCpFromItem(pv1);
          // Look for any near-equal PV (<=10cp difference) matching played SAN
          for (const alt of pvList) {
            if (alt.rank === 1) continue;
            const altCp = getCpFromItem(alt);
            if (Number.isFinite(pv1Cp) && Number.isFinite(altCp) && Math.abs(pv1Cp - altCp) <= 10) {
              const altSan = alt.uci ? uciToSan(fens[i], alt.uci) : null;
              if (altSan && playedSan && playedSan === altSan) {
                forcedPerfect = true;
                break;
              }
            }
          }
        }
      } catch {}
      // Do not force perfect if the move accelerates mate against the mover
      try {
        const beforeMateAgainst = ("mate" in best && Math.sign(best.mate) < 0) ? Math.abs(best.mate) : null;
        const afterMateAgainst = ("mate" in after && Math.sign(after.mate) > 0) ? Math.abs(after.mate) : null;
        if (forcedPerfect && beforeMateAgainst != null && afterMateAgainst != null && afterMateAgainst < beforeMateAgainst) {
          forcedPerfect = false;
        }
      } catch {}
      if (!forcedPerfect && cpLoss <= 10) forcedPerfect = true;

      if (forcedPerfect) {
        moveAccuracy = 100;
      } else if ("mate" in after && after.mate === 0) {
        // A. If move delivers mate immediately → 100
        moveAccuracy = 100;
      } else if ("mate" in best && Math.sign(best.mate) > 0) {
        // B. Best has mate for mover but played misses it → heavy penalty
        moveAccuracy = 30; // cap
      } else {
        // C. Base curve (tighter CPL penalty)
        const baseAcc = Math.max(0, 100 - 0.45 * Math.pow(cpLoss, 0.88));

        // D. Criticality weighting only when there is an actual loss
        const eqFactor = (() => {
          const eq = Math.exp(-Math.pow((Math.min(Math.abs(bestCp), 200)) / 120, 2)); // 0..1
          return 0.7 + 0.3 * eq; // 0.7..1.0 (closer to 1 when position ~ even)
        })();

        moveAccuracy = baseAcc * eqFactor;

        // E. Trivial recapture boost: if move is capture that restores/keeps material and cpLoss small
        try {
          const g0 = new Chess(fens[i]);
          const m = g0.move(sans[i], { sloppy: true });
          if (m && m.flags.includes('c')) {
            const beforeMat = materialScore(new Chess(fens[i]));
            const afterMat = materialScore(new Chess(g0.fen()));
            const side = moverSide === 'w' ? { before: beforeMat.w, after: afterMat.w } : { before: beforeMat.b, after: afterMat.b };
            if (side.after >= side.before && cpLoss <= 30) {
              moveAccuracy = Math.max(moveAccuracy, 95);
            }
          }
        } catch {}
      }

      // Clamp
      moveAccuracy = Math.max(0, Math.min(100, moveAccuracy));
      stats[player].accuracy += moveAccuracy;

      // Count buckets for rating penalties (mate-distance aware)
      const bestMateForMover2 = ("mate" in best && Math.sign(best.mate) > 0) ? Math.abs(best.mate) : null;
      const playedMateForMover2 = ("mate" in after && (after.mate === 0 || Math.sign(after.mate) < 0)) ? Math.abs(after.mate) : null;
      const dMate = (bestMateForMover2 != null && playedMateForMover2 != null) ? (playedMateForMover2 - bestMateForMover2) : null;

      if (dMate != null && dMate >= 0) {
        // Slower mate still winning: never count as blunder; map softly by distance
        if (dMate === 0) stats[player].counts.best++;
        else if (dMate === 1) stats[player].counts.excellent++;
        else if (dMate <= 3) stats[player].counts.good++;
        else if (dMate <= 6) stats[player].counts.inaccuracy++;
        else stats[player].counts.mistake++;
      } else {
        if (cpLoss <= 10) stats[player].counts.best++;
        else if (cpLoss <= 20) stats[player].counts.excellent++;
        else if (cpLoss <= 50) { stats[player].counts.good++; }
        else if (cpLoss <= 150) stats[player].counts.inaccuracy++;
        else if (cpLoss <= 300) stats[player].counts.mistake++;
        else stats[player].counts.blunder++;
      }

      // Miss (taktik terlewat), konsisten dengan classifyMoveByDelta
      const isMiss = (
        (("mate" in best && Math.sign(best.mate) > 0) || (bestCp != null && bestCp >= 300)) &&
        (playedCp != null && playedCp <= 50)
      );
      if (isMiss) stats[player].counts.miss++;

      // Extra penalty trigger: move allows opponent mate-in-1 immediately
      if ("mate" in after && Number(after.mate) === 1) {
        stats[player].extraPenalty += 200;
      }

      // Track good move ratio for consistency bonus separately (>=92%)
      if (moveAccuracy >= 92) stats[player].goodMoves++;
    }
    // Finalize accuracy as percentage
    ['white', 'black'].forEach(color => {
      if (stats[color].totalMoves > 0) {
        stats[color].accuracy = stats[color].accuracy / stats[color].totalMoves;
      }
    });

    return stats;
  }, [fens, evals, sans]);

  // Aggregate counts for Move Quality Summary (white | icon | black)
  const moveTypeCounts = useMemo(() => {
    const base = {
      brilliant: 0,
      great: 0,
      best: 0,
      excellent: 0,
      good: 0,
      inaccuracy: 0,
      miss: 0,
      mistake: 0,
      blunder: 0,
    };
    const res = { white: { ...base }, black: { ...base } };
    Object.entries(annotations || {}).forEach(([ply, ann]) => {
      if (!ann || !ann.tag) return;
      const color = (ann.mover || '').toLowerCase(); // 'white' | 'black'
      const key = String(ann.tag).toLowerCase();
      if (res[color] && key in res[color]) {
        res[color][key] += 1;
      }
    });

    return res;
  }, [annotations, fens.length]);

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
        return 'rgb(0, 221, 255)'; // cyan
      case 'great':
        return 'rgba(42, 175, 252, 0.6)'; // blue
      default:
        return 'rgba(255, 255, 0, 0.35)';
    }
  }

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

  // Custom arrow overlay component since react-chessboard may not support arrows
  const ArrowOverlay = ({ arrows, boardSize = 400 }) => {
    if (!arrows || arrows.length === 0) return null;

    const squareSize = boardSize / 8;
    const getSquarePosition = (square) => {
      const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
      const rank = parseInt(square[1], 10) - 1;
      return {
        x: file * squareSize + squareSize / 2,
        y: (7 - rank) * squareSize + squareSize / 2,
      };
    };

    return (
      <div style={{ position: 'absolute', top: 0, left: 0, width: boardSize, height: boardSize, pointerEvents: 'none', zIndex: 10 }}>
        <svg width={boardSize} height={boardSize}>
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="rgba(0, 128, 0, 0.8)" />
            </marker>
          </defs>
          {arrows.map((arrow, index) => {
            const from = typeof arrow === 'string' ? arrow.slice(0, 2) : arrow.from;
            const to = typeof arrow === 'string' ? arrow.slice(2, 4) : arrow.to;
            const fromPos = getSquarePosition(from);
            const toPos = getSquarePosition(to);
            return (
              <line
                key={`${from}-${to}-${index}`}
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

  // Best move arrow for current position
  const bestMoveArrow = useMemo(() => {
    if (!hasGame || !fens[idx]) return [];
    const currentEval = evals[idx];
    if (!currentEval || !currentEval.bestmoveUci) return [];
    const uci = currentEval.bestmoveUci;
    if (uci.length < 4) return [];

    // Hide arrow if played move equals best move
    if (idx < sans.length) {
      const playedSan = sans[idx];
      const bestSan = uciToSan(fens[idx], uci);
      if (playedSan && bestSan && normalizeSan(playedSan) === normalizeSan(bestSan)) {
        return [];
      }
    }

    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    return [{ from, to, color: 'rgba(0, 128, 0, 0.8)' }];
  }, [hasGame, fens, idx, evals, sans]);

  // Use last known evaluation to avoid bar snapping to center while new eval is pending
  const { effectiveEval, effectiveSide } = useMemo(() => {
    const currFen = fens[idx];
    const currEval = evals[idx];
    // Terminal override
    if (currFen) {
      const term = getTerminalEval(currFen);
      if (term) return { effectiveEval: term, effectiveSide: currFen.split(' ')[1] };
    }
    if (currEval && currFen) {
      return { effectiveEval: currEval, effectiveSide: currFen.split(' ')[1] };
    }
    return { effectiveEval: null, effectiveSide: (currFen?.split(' ')[1]) || 'w' };
  }, [evals, fens, idx]);

  // --- Overlay: classification icon in the top-right of last move target square ---
  function MoveBadgeOverlay({ square, tag, boardSize = 500 }) {
    if (!square || !tag) return null;
    const icon = getMoveIconPath(tag);
    if (!icon) return null;
    const squareSize = boardSize / 8;
    const getSquareTopLeft = (sq) => {
      const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
      const rank = parseInt(sq[1], 10) - 1;
      const x = file * squareSize;
      const y = (7 - rank) * squareSize;
      return { x, y };
    };
    const { x, y } = getSquareTopLeft(square);
    const size = 42;
    const inset = -15;
    const left = x + squareSize - size - inset;
    const top = y + inset;
    return (
      <div style={{ position: 'absolute', pointerEvents: 'none', left: 0, top: 0, width: boardSize, height: boardSize, zIndex: 11 }}>
        <img src={icon} alt={tag} title={tag} style={{ position: 'absolute', left, top, width: size, height: size, borderRadius: '50%', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.28))' }} />
      </div>
    );
  }

  // ... (rest of the code remains the same)

  // Conditional render: Landing or Analyzer
  if (showLanding) {
    return (
      <ErrorBoundary>
        <Landing
          onSkip={() => setShowLanding(false)}
          onStart={() => setShowLanding(false)}
          onStartExample={startWithExample}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
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
            
            <div className="pgn-input-row" style={{ alignItems: 'stretch' }}>
              <textarea
                className="textarea-pgn"
                placeholder="Paste your PGN here..."
                value={pgn}
                onChange={(e) => setPgn(e.target.value)}
              />
              <div className="pgn-actions">
                <button
                  onClick={handleQuickAnalyze}
                  disabled={!pgn.trim() || thinking}
                  className="btn-analyze"
                >
                  {thinking ? 'Analyzing...' : 'Quick'}
                </button>
                <button
                  onClick={handleDeepAnalyze}
                  disabled={!pgn.trim() || thinking}
                  className="btn-analyze"
                >
                  {thinking ? 'Analyzing...' : 'Deep'}
                </button>
              </div>
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
              <div className="board-with-eval" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div className="board-stack" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: 'auto' }}>
                  {/* Top player info (Black) */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ color: '#D1D5DB', fontWeight: 600, width: '100%', textAlign: 'left' }}>
                      {playerNames.black}
                      {playerElos.black ? <span style={{ marginLeft: 6, color: '#9CA3AF', fontWeight: 500 }}>({playerElos.black})</span> : null}
                    </div>
                    {/* Pieces lost by Black (captured by White) */}
                    <CapturedRow
                      caps={capturesProgress[idx]?.white}
                      oppCaps={capturesProgress[idx]?.black}
                      color="black"
                    />
                  </div>
                  {/* Row: Evaluation bar (left) and Board (right) */}
                  <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 8, overflow: 'visible', minWidth: boardSize + 30 + 8 }}>
                    <EvaluationBar 
                      evaluation={effectiveEval}
                      sideToMove={effectiveSide}
                      barHeight={boardSize}
                      barWidth={30}
                    />
                    <div style={{ width: `${boardSize}px`, height: `${boardSize}px`, position: 'relative', marginLeft: 0 }}>
                      <Chessboard
                        id="analysis-board"
                        position={hasGame ? (fens[idx] || 'start') : 'start'}
                        boardWidth={boardSize}
                        arePiecesDraggable={false}
                        showBoardNotation={true}
                        animationDuration={300}
                        customPieces={customPieces}
                        customBoardStyle={{ borderRadius: '4px', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
                        customSquareStyles={lastMove ? {
                          [lastMove.from]: { backgroundColor: getHighlightColor(annotations[idx]?.tag) },
                          [lastMove.to]: { backgroundColor: getHighlightColor(annotations[idx]?.tag) }
                        } : {}}
                      />
                      {!thinking && <ArrowOverlay arrows={bestMoveArrow} boardSize={boardSize} />}
                      {/* Ikon klasifikasi pada petak tujuan langkah terakhir */}
                      {hasGame && idx > 0 && annotations[idx] && lastMove?.to && (
                        <MoveBadgeOverlay
                          square={lastMove.to}
                          tag={annotations[idx]?.tag}
                          boardSize={boardSize}
                        />
                      )}
                    </div>
                  </div>
                  {/* Bottom player info (White) */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginTop: 6 }}>
                    <div style={{ color: '#D1D5DB', fontWeight: 600, width: '100%', textAlign: 'left' }}>
                      {playerNames.white}
                      {playerElos.white ? <span style={{ marginLeft: 6, color: '#9CA3AF', fontWeight: 500 }}>({playerElos.white})</span> : null}
                    </div>
                    {/* Pieces lost by White (captured by Black) */}
                    <CapturedRow
                      caps={capturesProgress[idx]?.black}
                      oppCaps={capturesProgress[idx]?.white}
                      color="white"
                    />
                  </div>
                </div>
              </div>
            
              {/* Navigation Controls moved to right panel bottom */}

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
            <div className="accuracy-wrapper">
              {/* White Player Stats (left side) */}
              <div className="stat-item stats-white">
                <div className="stat-label">Accuracy</div>
                <div className="stat-value accuracy">{playerStats.white.accuracy.toFixed(2)}%</div>
              </div>

              {/* Black Player Stats (right side) */}
              <div className="stat-item stats-black">
                <div className="stat-label">Accuracy</div>
                <div className="stat-value accuracy">{playerStats.black.accuracy.toFixed(2)}%</div>
              </div>
            </div>

            {/* Move Type Summary (White | Icon | Black) */}
            {hasGame && (
              <div className="card stats-card">
                <h3 className="card-title">Report</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { key: 'brilliant', label: 'Brilliant', color: '#08FDFF' },
                    { key: 'great', label: 'Great', color: '#32ADFF' },
                    { key: 'best', label: 'Best', color: '#00F227' },
                    { key: 'excellent', label: 'Excellent', color: '#00F227' },
                    { key: 'good', label: 'Good', color: '#6FE47C' },
                    { key: 'inaccuracy', label: 'Inaccuracy', color: '#FFEC6C' },
                    { key: 'miss', label: 'Miss', color: '#FF8088' },
                    { key: 'mistake', label: 'Mistake', color: '#FFB278' },
                    { key: 'blunder', label: 'Blunder', color: '#FF0B07' },
                  ].map((row) => {
                    const icon = getMoveIconPath(row.label);
                    return (
                      <div
                        key={row.key}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr auto 1fr',
                          alignItems: 'center',
                          gap: 12,
                        }}
                      >
                        <div style={{ textAlign: 'left', fontWeight: 700, color: row.color }}>
                          {moveTypeCounts.white[row.key]}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 0, justifyContent: 'center' }}>
                          {icon && (
                            <img
                              src={icon}
                              alt={row.label}
                              title={row.label}
                              width={38}
                              height={38}
                              style={{ display: 'block' }}
                            />
                          )}
                          <span style={{ color: row.color, fontWeight: 600 }}>{row.label}</span>
                        </div>
                        <div style={{ textAlign: 'right', fontWeight: 700, color: row.color }}>
                          {moveTypeCounts.black[row.key]}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Evaluation Chart */}
            {hasGame && chartData.length > 0 && !thinking && (
              <div className="card full-height">
                <h3 className="card-title">Evaluation</h3>
                <div className="chart-container">
                  <ResponsiveContainer>
                    <ComposedChart 
                      data={chartData} 
                      margin={{ top: 0, right: 0, bottom: -6, left: -8 }}
                      onClick={(state) => {
                        const label = state && typeof state.activeLabel === 'number' ? state.activeLabel : null;
                        if (label == null) return;
                        const clamped = Math.max(0, Math.min(fens.length - 1, Math.round(label)));
                        setIdx(clamped);
                      }}
                      onMouseUp={(state) => {
                        const label = state && typeof state.activeLabel === 'number' ? state.activeLabel : null;
                        if (label == null) return;
                        const clamped = Math.max(0, Math.min(fens.length - 1, Math.round(label)));
                        setIdx(clamped);
                      }}
                    >
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
                      <CartesianGrid 
                        vertical={false}
                        horizontal={false}
                        stroke="transparent"
                        fill="#1a1a1ab7" 
                        fillOpacity={1} 
                      />
                      <XAxis 
                        type="number"
                        dataKey="move" 
                        domain={[chartData && chartData.length ? chartData[0].move : 0, chartData && chartData.length ? chartData[chartData.length - 1].move : 0]}
                        allowDataOverflow
                        hide
                      />
                      <YAxis 
                        domain={[-10, 10]} 
                        allowDataOverflow
                        hide
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
                      {/* Axis lines flush to edges */}
                      <ReferenceLine x="dataMin" stroke="#EAB308" strokeWidth={3} />
                      <ReferenceLine y="dataMin" stroke="#E5E7EB" strokeWidth={1} />
                      {/* Reference line at y=0 (subtle) */}
                      <Line 
                        type="monotone" 
                        dataKey={() => 0}
                        stroke="#6B7280"
                        strokeWidth={1}
                        strokeDasharray="4 4"
                        strokeOpacity={0.3}
                        dot={false}
                        activeDot={false}
                      />
                      {/* White area fill over black background */}
                      <Area 
                        type="monotone"
                        dataKey="pawns"
                        fill="#ffffff"
                        stroke="none"
                        baseValue={-10}
                        fillOpacity={1}
                        isAnimationActive={false}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="pawns" 
                        stroke="#3B82F6" 
                        strokeWidth={2}
                        dot={false}
                        activeDot={false}
                      />
                    </ComposedChart>
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
                        key={`${i}-${san}-${fens[i] || ''}`}
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

          {/* Fixed bottom navigation inside right panel (desktop) - always mounted, show/hide via style */}
          <div className="right-panel-nav" style={{ display: isMobile ? 'none' : 'block' }}>
            <div className="nav-controls">
              <button className="nav-btn" onClick={() => navigateToPosition(0)} disabled={!hasGame}>⏮</button>
              <button className="nav-btn" onClick={() => navigateToPosition(Math.max(0, idx - 1))} disabled={!hasGame}>◀</button>
              <button className="nav-btn" onClick={() => navigateToPosition(Math.min(fens.length - 1, idx + 1))} disabled={!hasGame}>▶</button>
              <button className="nav-btn" onClick={() => navigateToPosition(fens.length - 1)} disabled={!hasGame}>⏭</button>
            </div>
          </div>
        </div>
      </div>
      {/* Global fixed nav for mobile - always mounted, show/hide via style */}
      <div className="mobile-fixed-nav" style={{ display: isMobile ? 'block' : 'none' }}>
        <div className="nav-controls">
          <button className="nav-btn" onClick={() => navigateToPosition(0)} disabled={!hasGame}>⏮</button>
          <button className="nav-btn" onClick={() => navigateToPosition(Math.max(0, idx - 1))} disabled={!hasGame}>◀</button>
          <button className="nav-btn" onClick={() => navigateToPosition(Math.min(fens.length - 1, idx + 1))} disabled={!hasGame}>▶</button>
          <button className="nav-btn" onClick={() => navigateToPosition(fens.length - 1)} disabled={!hasGame}>⏭</button>
        </div>
      </div>
    </div>
    </ErrorBoundary>
  );
}
