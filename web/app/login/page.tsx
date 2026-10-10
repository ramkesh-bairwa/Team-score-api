'use client';
// /login?next=/path — mobile number + OTP. New numbers also give a name (that's the register path).
// No SMS provider yet: the OTP comes back from the API and is shown under the form.
import React, { useEffect, useRef, useState } from 'react';
import { AuthRequestError, completeLogin, requestOtp, verifyOtp } from '@/lib/auth-client';
import st from './login.module.css';

const OTP_LEN = 6;
const RESEND_S = 30;
const empty = () => Array<string>(OTP_LEN).fill('');

// Accepts pasted "+91 98765-43210", "098765 43210" … and keeps the 10 digits
const cleanMobile = (raw: string) => {
  let d = raw.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  else if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
};
const prettyMobile = (m: string) => (m.length > 5 ? `${m.slice(0, 5)} ${m.slice(5)}` : m);
const validMobile = (m: string) => /^[6-9]\d{9}$/.test(m);

export default function LoginPage() {
  const [step, setStep] = useState<'mobile' | 'otp'>('mobile');
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [digits, setDigits] = useState<string[]>(empty);
  const [shownOtp, setShownOtp] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const mobileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const boxRefs = useRef<(HTMLInputElement | null)[]>([]);
  const verifyingRef = useRef(false);

  useEffect(() => { document.title = 'Log in · CricScore'; }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const focusBox = (i: number) => {
    const el = boxRefs.current[Math.max(0, Math.min(OTP_LEN - 1, i))];
    el?.focus();
    el?.select();
  };

  // ── Step 1: get an OTP ─────────────────────────────────
  const sendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!validMobile(mobile)) {
      setError('Enter a valid 10-digit mobile number');
      mobileRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await requestOtp(mobile);
      setShownOtp(r.otp);
      setIsNewUser(r.isNewUser);
      setDigits(empty());
      setResendIn(RESEND_S);
      setStep('otp');
      setTimeout(() => (r.isNewUser ? nameRef.current?.focus() : focusBox(0)), 50);
    } catch (err) {
      const e2 = err as AuthRequestError;
      setError(e2.message);
      if (e2.data?.retryIn && step === 'otp') setResendIn(Number(e2.data.retryIn));
    } finally {
      setBusy(false);
    }
  };

  const changeNumber = () => {
    setStep('mobile');
    setDigits(empty());
    setShownOtp('');
    setError('');
    setTimeout(() => mobileRef.current?.focus(), 50);
  };

  // ── Step 2: verify ─────────────────────────────────────
  const verify = async (code = digits.join('')) => {
    if (verifyingRef.current || done) return;
    if (isNewUser) {
      const n = name.replace(/\s+/g, ' ').trim();
      if (n.length < 2 || n.length > 40) {
        setError(n ? 'Name must be 2–40 characters' : 'Enter your name');
        nameRef.current?.focus();
        return;
      }
    }
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit OTP');
      focusBox(digits.findIndex(d => !d));
      return;
    }
    verifyingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await verifyOtp(mobile, code, isNewUser ? name.trim() : undefined);
      setDone(true);
      completeLogin(r.user, new URLSearchParams(window.location.search).get('next'));
    } catch (err) {
      const e2 = err as AuthRequestError;
      if (e2.data?.needName) {
        setIsNewUser(true);
        setError(e2.message);
        setTimeout(() => nameRef.current?.focus(), 50);
      } else if (typeof e2.data?.attemptsLeft === 'number' && e2.data.attemptsLeft > 0) {
        setError(`Wrong OTP · ${e2.data.attemptsLeft} attempt${e2.data.attemptsLeft === 1 ? '' : 's'} left`);
        setDigits(empty());
        setTimeout(() => focusBox(0), 30);
      } else if (e2.data?.expired) {
        setError(e2.data.attemptsLeft === 0 ? 'Too many wrong attempts. Request a new OTP' : e2.message);
        setShownOtp('');
        setDigits(empty());
      } else {
        setError(e2.message);
      }
    } finally {
      verifyingRef.current = false;
      setBusy(false);
    }
  };

  const onDigitsChange = (next: string[], focusAt?: number) => {
    setDigits(next);
    if (error) setError('');
    if (focusAt !== undefined) focusBox(focusAt);
    // Existing users: log in as soon as the 6th digit lands
    if (next.every(Boolean) && !isNewUser) verify(next.join(''));
  };

  const onBoxChange = (i: number, value: string) => {
    let v = value.replace(/\D/g, '');
    // Typed over an existing digit without selecting it: keep the new one
    if (v.length === 2 && digits[i] && v.includes(digits[i])) v = v[0] === digits[i] ? v[1] : v[0];
    if (!v) { const n = [...digits]; n[i] = ''; setDigits(n); return; }
    if (v.length > 1) return fillFrom(i, v); // autofill / fast typing
    const n = [...digits];
    n[i] = v;
    onDigitsChange(n, i < OTP_LEN - 1 ? i + 1 : undefined);
  };

  const fillFrom = (start: number, raw: string) => {
    const v = raw.replace(/\D/g, '');
    if (!v) return;
    const from = v.length >= OTP_LEN ? 0 : start;
    const n = [...digits];
    for (let k = 0; k < v.length && from + k < OTP_LEN; k++) n[from + k] = v[k];
    onDigitsChange(n, Math.min(OTP_LEN - 1, from + v.length));
  };

  const onBoxKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault();
      const n = [...digits];
      n[i - 1] = '';
      setDigits(n);
      focusBox(i - 1);
    } else if (e.key === 'ArrowLeft') { e.preventDefault(); focusBox(i - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); focusBox(i + 1); }
    else if (e.key === 'Enter') { e.preventDefault(); verify(); }
  };

  const fillShownOtp = () => {
    if (!shownOtp) return;
    onDigitsChange(shownOtp.split(''), OTP_LEN - 1);
    if (isNewUser && !name.trim()) setTimeout(() => nameRef.current?.focus(), 30);
  };

  const title = step === 'mobile' ? 'Log in or sign up' : isNewUser ? 'Create your account' : 'Welcome back';

  return (
    <main className={st.page}>
      <section className={st.hero}>
        <div className={st.heroInner}>
          <Brand />
          <h1 className={st.tagline}>Every ball.<br /><span>Every run.</span><br />Live.</h1>
          <p className={st.heroSub}>Score your matches ball by ball, share the live scorecard and stream the action to friends.</p>
          <ul className={st.points}>
            <li><span className={st.dot} />Ball-by-ball scoring &amp; commentary</li>
            <li><span className={st.dot} />Live links anyone can watch</li>
            <li><span className={st.dot} />Your teams &amp; matches on every device</li>
          </ul>
        </div>
        <Pitch />
      </section>

      <section className={st.side}>
        <div className={st.card}>
          <div className={st.cardBrand}><Brand compact /></div>
          <h2 className={st.title}>{title}</h2>

          {step === 'mobile' ? (
            <form onSubmit={sendOtp} noValidate>
              <p className={st.sub}>Enter your mobile number. We&apos;ll send a 6-digit OTP to verify it.</p>
              <label className={st.label} htmlFor="mobile">Mobile number</label>
              <div className={`${st.phone} ${error ? st.invalid : ''}`}>
                <span className={st.cc}>🇮🇳 +91</span>
                <input
                  id="mobile"
                  ref={mobileRef}
                  className={st.phoneInput}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  autoFocus
                  value={prettyMobile(mobile)}
                  onChange={e => { setMobile(cleanMobile(e.target.value)); if (error) setError(''); }}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                />
              </div>
              {error && <p id="login-error" className={st.error} role="alert">{error}</p>}
              <button className={st.primary} type="submit" disabled={busy || mobile.length < 10}>
                {busy ? <span className={st.spinner} aria-hidden /> : null}
                {busy ? 'Sending…' : 'Get OTP'}
              </button>
              <p className={st.fine}>New here? Your account is created when you verify your number.</p>
            </form>
          ) : (
            <form onSubmit={e => { e.preventDefault(); verify(); }} noValidate>
              <p className={st.sub}>
                OTP sent to <b>+91 {prettyMobile(mobile)}</b>{' '}
                <button type="button" className={st.link} onClick={changeNumber}>Change number</button>
              </p>

              {isNewUser && (
                <>
                  <label className={st.label} htmlFor="name">Your name</label>
                  <input
                    id="name"
                    ref={nameRef}
                    className={st.input}
                    type="text"
                    autoComplete="name"
                    placeholder="e.g. Rohit Sharma"
                    maxLength={40}
                    value={name}
                    onChange={e => { setName(e.target.value); if (error) setError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); verify(); } }}
                  />
                </>
              )}

              <label className={st.label} htmlFor="otp-0">Enter OTP</label>
              <div className={st.otpRow} onPaste={e => { e.preventDefault(); fillFrom(0, e.clipboardData.getData('text')); }}>
                {digits.map((d, i) => (
                  <input
                    key={i}
                    id={`otp-${i}`}
                    ref={el => { boxRefs.current[i] = el; }}
                    className={`${st.otpBox} ${d ? st.otpFilled : ''} ${error && !d ? st.invalid : ''}`}
                    type="text"
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={i === 0 ? OTP_LEN : 1}
                    aria-label={`Digit ${i + 1}`}
                    value={d}
                    onChange={e => onBoxChange(i, e.target.value)}
                    onKeyDown={e => onBoxKey(i, e)}
                    onFocus={e => e.target.select()}
                  />
                ))}
              </div>

              {error && <p className={st.error} role="alert">{error}</p>}

              <button className={st.primary} type="submit" disabled={busy || done}>
                {busy || done ? <span className={st.spinner} aria-hidden /> : null}
                {done ? 'Logging you in…' : busy ? 'Verifying…' : isNewUser ? 'Create account' : 'Verify & log in'}
              </button>

              <div className={st.resend}>
                {resendIn > 0 ? (
                  <span>Resend OTP in <b>0:{String(resendIn).padStart(2, '0')}</b></span>
                ) : (
                  <>Didn&apos;t get it? <button type="button" className={st.link} onClick={() => sendOtp()} disabled={busy}>Resend OTP</button></>
                )}
              </div>
            </form>
          )}

          {step === 'otp' && shownOtp && (
            <div className={st.otpShow} aria-live="polite">
              <div>
                <div className={st.otpShowLabel}>Your OTP</div>
                <div className={st.otpShowCode}>{shownOtp.slice(0, 3)} {shownOtp.slice(3)}</div>
                <div className={st.otpShowNote}>SMS delivery is coming soon. Valid for 5 minutes.</div>
              </div>
              <button type="button" className={st.fill} onClick={fillShownOtp} disabled={busy || done}>Fill</button>
            </div>
          )}
        </div>
        <p className={st.legal}>By continuing you agree to play fair and keep the scores honest. 🏏</p>
      </section>
    </main>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`${st.brand} ${compact ? st.brandCompact : ''}`}>
      <span className={st.ball} aria-hidden />
      <span className={st.brandText}>Cric<span>Score</span></span>
    </div>
  );
}

// Decorative stumps + pitch for the hero
function Pitch() {
  return (
    <svg className={st.pitch} viewBox="0 0 400 300" aria-hidden>
      <defs>
        <linearGradient id="pitchFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FACC15" stopOpacity="0" />
          <stop offset="1" stopColor="#FACC15" stopOpacity=".16" />
        </linearGradient>
      </defs>
      <path d="M150 40 L250 40 L330 300 L70 300 Z" fill="url(#pitchFade)" />
      <path d="M160 70 L240 70" stroke="rgba(255,255,255,.35)" strokeWidth="2" />
      <path d="M118 210 L282 210" stroke="rgba(255,255,255,.35)" strokeWidth="2" />
      {[180, 200, 220].map(x => (
        <rect key={x} x={x - 3} y={120} width="6" height="88" rx="3" fill="rgba(248,250,252,.85)" />
      ))}
      <rect x="176" y="114" width="22" height="5" rx="2.5" fill="#FACC15" />
      <rect x="202" y="114" width="22" height="5" rx="2.5" fill="#FACC15" />
    </svg>
  );
}
