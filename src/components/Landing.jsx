import React from "react";
import "./landing.css";

export default function Landing({ onSkip, onStart, onStartExample, logoSrc = "/vite.svg" }) {
  return (
    <div className="landing">
      <header className="landing-header">
        <div className="brand">
          {/* Replaceable logo image */}
          <img src={logoSrc} alt="Logo" className="brand-logo" />
          Chess Analyzer
        </div>
      </header>
      <section className="landing-hero">
        <div className="hero-left">
          <h1 className="hero-title">Analisis Game Catur Anda dengan Engine Stockfish</h1>
          <p className="hero-subtitle">Upload atau paste PGN, lalu dapatkan evaluasi, akurasi, anotasi langkah (Best, Good, Mistake, Blunder), dan grafik evaluasi yang jelas. Desain gelap modern, responsif untuk mobile.</p>
          <div className="hero-cta">
            <button className="btn-primary" onClick={onStart}>Mulai Analisis</button>
            <button className="btn-ghost" onClick={onStartExample}>Coba Contoh Cepat</button>
          </div>
        </div>
        <div className="hero-right">
          <div className="feature-card">
            <div className="feature-title">Upload PGN</div>
            <div className="feature-desc">Mudah mengunggah file .pgn atau paste teksnya.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Evaluasi Engine</div>
            <div className="feature-desc">Ditenagai Stockfish dengan tampilan bar dan grafik.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Anotasi Langkah</div>
            <div className="feature-desc">Deteksi Brilliant, Blunder, Miss, dan lainnya.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Ramah Mobile</div>
            <div className="feature-desc">Tata letak adaptif, kontrol navigasi tetap di bawah.</div>
          </div>
        </div>
      </section>
    </div>
  );
}
