'use client';
// /creators — who made CricScore
import React, { useEffect } from 'react';
import Link from 'next/link';
import st from './creators.module.css';

const CREATOR = { name: 'Ramkesh Bairwa', initials: 'RB', role: 'Creator & developer of CricScore', address: 'Jaipur' };

export default function CreatorsPage() {
  useEffect(() => { document.title = 'Creators · CricScore'; }, []);
  return (
    <main className={st.page}>
      <header className={st.hero}>
        <div className={st.heroInner}>
          <Link href="/" className={st.back} aria-label="Back to home">←</Link>
          <span className={st.kicker}>🏏 CricScore</span>
          <h1 className={st.title}>Creators</h1>
          <p className={st.sub}>The people behind the app</p>
        </div>
      </header>

      <section className={st.body}>
        <article className={st.card}>
          <div className={st.avatar} aria-hidden>{CREATOR.initials}</div>
          <div className={st.info}>
            <span className={st.badge}>App creator</span>
            <h2 className={st.name}>{CREATOR.name}</h2>
            <p className={st.role}>{CREATOR.role}</p>
            <dl className={st.details}>
              <div className={st.row}><dt>Creator name</dt><dd>{CREATOR.name}</dd></div>
              <div className={st.row}><dt>Address</dt><dd>📍 {CREATOR.address}</dd></div>
            </dl>
          </div>
        </article>
        <p className={st.thanks}>Thank you for scoring your matches with CricScore. 🏏</p>
      </section>
    </main>
  );
}
