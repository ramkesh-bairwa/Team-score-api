'use client';
// The app's three welcome slides (Welcome1, Welcome2, Welcome3) as one screen.
import React, { useEffect, useState } from 'react';
import s from './WelcomeScreen.module.css';

const WELCOME_KEY = 'cricscore_welcome_seen';

const FEATURES = [
  { icon: '📡', label: 'Live Scores', desc: 'Ball-by-ball updates in real time' },
  { icon: '📊', label: 'Deep Stats', desc: 'Player & match analytics' },
  { icon: '🏆', label: 'All Formats', desc: 'T20 · ODI · Test · IPL' },
];

const Dots = ({ active }: { active: number }) => (
  <div className={s.dots}>
    {[0, 1, 2].map(i => <div key={i} className={`${s.dot} ${i === active ? s.dotActive : ''}`} />)}
  </div>
);

const Skip = ({ onPress }: { onPress: () => void }) => (
  <button className={s.skipTopBtn} onClick={onPress}>Skip</button>
);

function Slide1({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [hexDots] = useState(() => [...Array(20)].map((_, i) => ({
    top: `${Math.random() * 100}%`,
    left: `${Math.random() * 100}%`,
    opacity: 0.05 + (i % 5) * 0.02,
  })));

  return (
    <div className={`${s.container} ${s.bg1}`}>
      <Skip onPress={onSkip} />

      {/* Background hexagon pattern */}
      <div className={s.bgPattern}>
        {hexDots.map((d, i) => <div key={i} className={s.hexDot} style={d} />)}
      </div>

      {/* Glowing arc top */}
      <div className={s.arcTop} />
      <div className={s.arcTopInner} />

      <div className={s.centerContent}>
        {/* Ripple behind ball */}
        <div className={s.ripple} />

        {/* Cricket Ball */}
        <div className={s.ballWrapper}>
          <div className={s.ball}>
            <div className={s.seamH} />
            <div className={s.seamV} />
            <div className={s.ballShine} />
          </div>
        </div>

        <div className={s.fade1}>
          <div className={s.tagline}>THE GAME BEGINS</div>
          <div className={s.title}>CRIC<span className={s.titleAccent}>SCORE</span></div>
          <div className={s.subtitle}>Live. Fast. Accurate.</div>
        </div>
      </div>

      {/* Bottom pitch lines */}
      <div className={s.pitchContainer}>
        {[...Array(5)].map((_, i) => (
          <div key={i} className={s.pitchLine} style={{ opacity: 0.3 - i * 0.05 }} />
        ))}
      </div>

      <div className={`${s.btnContainer1} ${s.fade1}`}>
        <button className={s.btn} onClick={onNext}>NEXT  →</button>
      </div>

      <Dots active={0} />
    </div>
  );
}

function Slide2({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div className={`${s.container} ${s.bg2}`}>
      <Skip onPress={onSkip} />

      {/* Diagonal accent */}
      <div className={s.diagonalBg} />
      <div className={s.diagonalBg2} />

      <div className={s.column2}>
        <div className={s.header2}>
          <div className={s.stepLabel}>02 / 03</div>
          <div className={s.heading2}>WHY<br /><span className={s.headingAccent}>CRICSCORE?</span></div>
          <div className={s.headingLine} />
        </div>

        <div className={s.cardsContainer}>
          {FEATURES.map((f, i) => (
            <div key={i} className={s.card} style={{ animationDelay: `${0.7 + i * 0.15}s` }}>
              <div className={s.cardIconBox}>
                <span className={s.cardIcon}>{f.icon}</span>
              </div>
              <div className={s.cardText}>
                <div className={s.cardLabel}>{f.label}</div>
                <div className={s.cardDesc}>{f.desc}</div>
              </div>
              <div className={s.cardArrow}>
                <span className={s.cardArrowText}>›</span>
              </div>
            </div>
          ))}
        </div>

        {/* Scoreboard mockup */}
        <div className={`${s.scoreMock} ${s.fade2}`}>
          <div className={s.scoreMockHeader}>
            <div className={s.liveDot} />
            <span className={s.liveText}>LIVE</span>
            <span className={s.matchType}>Local · 10 Overs</span>
          </div>
          <div className={s.scoreRow}>
            <span className={s.teamName}>Team A</span>
            <span className={s.scoreVal}>98/3</span>
            <span className={s.overs}>(8.4)</span>
          </div>
          <div className={s.scoreRow}>
            <span className={s.teamName}>Team B</span>
            <span className={s.scoreValGray}>needs 99</span>
            <span className={s.overs}>(10 ov)</span>
          </div>
        </div>

        <div className={`${s.btnContainer2} ${s.fade2}`}>
          <button className={s.btn} onClick={onNext}>NEXT  →</button>
        </div>

        <Dots active={1} />
      </div>
    </div>
  );
}

function Slide3({ onDone }: { onDone: () => void }) {
  return (
    <div className={`${s.container} ${s.bg1} ${s.container3}`}>
      {/* Stadium arc */}
      <div className={s.stadiumOuter} />
      <div className={s.stadiumInner} />
      <div className={s.stadiumCore} />

      {/* Pitch lines */}
      <div className={s.pitchLines}>
        {[...Array(7)].map((_, i) => (
          <div key={i} className={s.pitchLine3} style={{ width: 40 + i * 30, opacity: 0.06 + i * 0.015 }} />
        ))}
      </div>

      <div className={s.centerContent3}>
        {/* Trophy */}
        <div className={s.trophyContainer}>
          <span className={s.trophyEmoji}>🏏</span>
          <div className={s.trophyGlow} />
        </div>

        <div className={s.stepLabel}>03 / 03</div>
        <div className={s.heading3}>YOU&apos;RE ALL<br /><span className={s.headingAccent}>SET!</span></div>
        <div className={s.subText}>
          Join millions of cricket fans<br />following every ball, every match.
        </div>

        {/* Stats row */}
        <div className={s.statsRow}>
          {[
            { val: '50M+', label: 'Fans' },
            { val: '200+', label: 'Matches' },
            { val: '24/7', label: 'Live' },
          ].map((st, i) => (
            <div key={i} className={s.statItem}>
              <span className={s.statVal}>{st.val}</span>
              <span className={s.statLabel}>{st.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={s.btnContainer3}>
        <button className={s.btnPrimary} onClick={onDone}>🏏  ENTER THE ARENA</button>
      </div>

      <Dots active={2} />
    </div>
  );
}

export default function WelcomeScreen({ navigation }: any) {
  const [slide, setSlide] = useState(0);

  // Shown automatically only on the first visit
  useEffect(() => {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* storage blocked */ }
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [slide]);

  const goHome = () => navigation.navigate('Home');

  if (slide === 0) return <Slide1 key="1" onNext={() => setSlide(1)} onSkip={goHome} />;
  if (slide === 1) return <Slide2 key="2" onNext={() => setSlide(2)} onSkip={goHome} />;
  return <Slide3 key="3" onDone={goHome} />;
}
