'use client';
import React, { useEffect, useState } from 'react';
import { pickImage } from '@/lib/pickImage';
import { popup } from '@/components/Popup';
import { BET_DRAFT, loadDraft, saveDraft } from '@/lib/screenDraft';
import s from './BetScreen.module.css';

const PRESETS = ['10', '20', '50', '100'];
const EXPENSE_PRESETS = ['Ground fee', 'Ball fee', 'Umpire fee', 'Refreshments', 'Equipment'];
export const BALL_TYPES = [
  { key: 'Tennis', icon: '🎾' },
  { key: 'Leather', icon: '🔴' },
  { key: 'Plastic', icon: '⚪' },
  { key: 'Wind', icon: '🌬️' },
];
type Expense = { label: string; amount: string };
type BetType = 'free' | 'paid' | 'loser' | null;
type Draft = {
  betType: BetType; expenses: Expense[]; expenseNote: string; ballType: string;
  amount: string; customAmount: string; cap1Photo: string | null; cap2Photo: string | null;
};

export default function BetScreen({ navigation, route }: any) {
  const { team1, team2, overs, matchType, location } = route.params || {};

  // Restored when coming Back from Toss (the page remounts on the web)
  const [draft] = useState(() => loadDraft<Draft>(BET_DRAFT, 'Bet'));
  const [betType, setBetType] = useState<BetType>(draft?.betType ?? null);
  // Loser to pay: the losing team covers the match expenses
  const [expenses, setExpenses] = useState<Expense[]>(draft?.expenses ?? [{ label: 'Ground fee', amount: '' }]);
  const [expenseNote, setExpenseNote] = useState(draft?.expenseNote ?? '');
  const [ballType, setBallType] = useState(draft?.ballType ?? 'Tennis');
  const [amount, setAmount] = useState(draft?.amount ?? '');
  const [customAmount, setCustomAmount] = useState(draft?.customAmount ?? '');
  const [cap1Photo, setCap1Photo] = useState<string | null>(draft?.cap1Photo ?? null);
  const [cap2Photo, setCap2Photo] = useState<string | null>(draft?.cap2Photo ?? null);

  useEffect(() => {
    const data: Draft = { betType, expenses, expenseNote, ballType, amount, customAmount, cap1Photo, cap2Photo };
    saveDraft(BET_DRAFT, 'Bet', data, () => ({ ...data, cap1Photo: null, cap2Photo: null }));
  }, [betType, expenses, expenseNote, ballType, amount, customAmount, cap1Photo, cap2Photo]);

  // Opened directly (no match params, e.g. a bookmarked URL): nothing to bet on, go Home
  const missing = !team1 || !team2;
  useEffect(() => { if (missing) navigation.replace('Home'); }, [missing, navigation]);
  if (missing) return null;

  const finalAmount = amount === 'custom' ? customAmount : amount;
  const expenseTotal = expenses.reduce((sum, e) => sum + (parseInt(e.amount, 10) || 0), 0);

  const addExpense = (label: string) => {
    if (expenses.some(e => e.label === label) && label !== 'Other') return;
    setExpenses([...expenses, { label, amount: '' }]);
  };
  const updateExpense = (i: number, patch: Partial<Expense>) =>
    setExpenses(expenses.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  const capturePhoto = (captain: 1 | 2) => {
    pickImage({ camera: true, front: true, quality: 0.7, maxSize: 600 })
      .then(res => {
        const uri = res?.uri;
        if (!uri) return;
        if (captain === 1) setCap1Photo(uri);
        else setCap2Photo(uri);
      })
      .catch((e: any) => popup.alert('Photo Error', e?.message, undefined, 'error'));
  };

  const canProceed = () => {
    if (!betType) return false;
    if (betType === 'paid') {
      if (!finalAmount || parseInt(finalAmount) < 1) return false;
      if (!cap1Photo || !cap2Photo) return false;
    }
    if (betType === 'loser' && expenseTotal < 1) return false;
    return true;
  };

  const proceed = () => {
    // ballType travels inside `bet`, which is already passed through every match screen
    const bet = betType === 'paid'
      ? { type: 'paid', amount: parseInt(finalAmount), cap1Photo, cap2Photo, ballType }
      : betType === 'loser'
        ? {
          type: 'loser', amount: expenseTotal, ballType, note: expenseNote.trim(),
          expenses: expenses
            .filter(e => (parseInt(e.amount, 10) || 0) > 0)
            .map(e => ({ label: e.label.trim() || 'Other', amount: parseInt(e.amount, 10) })),
        }
        : { type: 'free', amount: 0, ballType };
    navigation.navigate('Toss', {
      team1, team2, overs, matchType, location, bet,
    });
  };

  const showAmount = !!finalAmount && parseInt(finalAmount) > 0;
  const ok = canProceed();

  return (
    <div className={s.container}>
      <div className={s.header}>
        <div className={s.headerInner}>
          <button className={s.back} onClick={() => navigation.goBack()}>← Back</button>
          <div className={s.headerTitle}>Match Bet</div>
          <div style={{ width: 60 }} />
        </div>
      </div>

      <div className={s.scroll}>
        <div className={s.matchLabel}>{team1.name} vs {team2.name}</div>

        {/* Free / Paid */}
        <div className={s.sectionTitle}>Bet Type</div>
        <div className={s.row}>
          <button
            className={`${s.typeBtn} ${betType === 'free' ? s.typeBtnActive : ''}`}
            onClick={() => { setBetType('free'); setAmount(''); setCustomAmount(''); }}>
            <span className={s.typeIcon}>🆓</span>
            <span className={`${s.typeText} ${betType === 'free' ? s.typeTextActive : ''}`}>Free Match</span>
            <span className={s.typeDesc}>No bet amount</span>
            {betType === 'free' && <span className={s.check}>✓</span>}
          </button>
          <button
            className={`${s.typeBtn} ${betType === 'paid' ? s.typeBtnActive : ''}`}
            onClick={() => setBetType('paid')}>
            <span className={s.typeIcon}>💰</span>
            <span className={`${s.typeText} ${betType === 'paid' ? s.typeTextActive : ''}`}>Paid Match</span>
            <span className={s.typeDesc}>Set bet amount</span>
            {betType === 'paid' && <span className={s.check}>✓</span>}
          </button>
          <button
            className={`${s.typeBtn} ${betType === 'loser' ? s.typeBtnActive : ''}`}
            onClick={() => setBetType('loser')}>
            <span className={s.typeIcon}>🧾</span>
            <span className={`${s.typeText} ${betType === 'loser' ? s.typeTextActive : ''}`}>Loser to Pay</span>
            <span className={s.typeDesc}>Loser pays expenses</span>
            {betType === 'loser' && <span className={s.check}>✓</span>}
          </button>
        </div>

        {betType === 'loser' && (
          <>
            <div className={s.sectionTitle}>Match Expenses (₹)</div>
            <div className={s.card}>
              {expenses.map((e, i) => (
                <div key={i} className={s.expenseRow}>
                  <input
                    className={`${s.expenseInput} ${s.expenseLabel}`}
                    value={e.label}
                    onChange={ev => updateExpense(i, { label: ev.target.value })}
                    placeholder="Expense"
                  />
                  <input
                    className={`${s.expenseInput} ${s.expenseAmount}`}
                    value={e.amount}
                    onChange={ev => updateExpense(i, { amount: ev.target.value.replace(/[^0-9]/g, '') })}
                    placeholder="₹ 0"
                    inputMode="numeric"
                  />
                  <button className={s.expenseRemove} onClick={() => setExpenses(expenses.filter((_, idx) => idx !== i))}>✕</button>
                </div>
              ))}
              <div className={s.expenseChips}>
                {[...EXPENSE_PRESETS, 'Other'].filter(l => l === 'Other' || !expenses.some(e => e.label === l)).map(l => (
                  <button key={l} className={s.expenseChip} onClick={() => addExpense(l)}>+ {l}</button>
                ))}
              </div>
              <textarea
                className={s.noteInput}
                value={expenseNote}
                onChange={ev => setExpenseNote(ev.target.value)}
                placeholder="📝 Note (e.g. ground booked for 2 hours, 2 new balls)"
                rows={2}
              />
              <div className={s.expenseTotal}>
                <span className={s.expenseTotalLabel}>Losing team pays</span>
                <span className={s.expenseTotalVal}>₹{expenseTotal}</span>
              </div>
            </div>
          </>
        )}

        {betType === 'paid' && (
          <>
            {/* Amount */}
            <div className={s.sectionTitle}>Bet Amount (₹)</div>
            <div className={s.card}>
              <div className={s.amountRow}>
                {PRESETS.map(a => (
                  <button
                    key={a}
                    className={`${s.amountChip} ${amount === a ? s.amountChipActive : ''}`}
                    onClick={() => { setAmount(a); setCustomAmount(''); }}>
                    ₹{a}
                  </button>
                ))}
                <button
                  className={`${s.amountChip} ${amount === 'custom' ? s.amountChipActive : ''}`}
                  onClick={() => setAmount('custom')}>
                  Custom
                </button>
              </div>
              {amount === 'custom' && (
                <input
                  className={s.customInput}
                  placeholder="Enter amount"
                  inputMode="numeric"
                  value={customAmount}
                  onChange={ev => setCustomAmount(ev.target.value)}
                  autoFocus
                />
              )}
              {showAmount && (
                <div className={s.amountConfirm}>
                  <span className={s.amountConfirmText}>💰 Bet: ₹{finalAmount}</span>
                </div>
              )}
            </div>

            {/* Captain Photos */}
            {showAmount && (
              <>
                <div className={s.sectionTitle}>Captain Confirmation</div>
                <div className={s.photoSubText}>Both captains must take a selfie to confirm the bet</div>
                <div className={s.photoRow}>
                  {[
                    { captain: team1.captain, team: team1.name, photo: cap1Photo, num: 1 as 1 | 2 },
                    { captain: team2.captain, team: team2.name, photo: cap2Photo, num: 2 as 1 | 2 },
                  ].map(({ captain, team, photo, num }) => (
                    <div key={num} className={s.photoCard}>
                      <div className={s.photoCapName}>{captain}</div>
                      <div className={s.photoTeamName}>{team}</div>
                      {photo ? (
                        <button className={s.photoBtn} onClick={() => capturePhoto(num)}>
                          <img src={photo} alt="" className={s.photoImg} />
                          <span className={s.retakeText}>Tap to retake</span>
                        </button>
                      ) : (
                        <button className={s.captureBtn} onClick={() => capturePhoto(num)}>
                          <span className={s.captureIcon}>📷</span>
                          <span className={s.captureBtnText}>Take Photo</span>
                        </button>
                      )}
                      {photo && <div className={s.photoDone}><span className={s.photoDoneText}>✓ Done</span></div>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <div className={s.sectionTitle}>Ball Type</div>
        <div className={s.ballRow}>
          {BALL_TYPES.map(b => (
            <button key={b.key} className={`${s.ballBtn} ${ballType === b.key ? s.ballBtnOn : ''}`} onClick={() => setBallType(b.key)}>
              <span className={s.ballIcon}>{b.icon}</span>
              <span className={`${s.ballText} ${ballType === b.key ? s.ballTextOn : ''}`}>{b.key}</span>
            </button>
          ))}
        </div>

        <button
          className={`${s.proceedBtn} ${!ok ? s.proceedBtnDisabled : ''}`}
          onClick={proceed}
          disabled={!ok}>
          {betType === 'paid' ? '💰 Confirm & Proceed to Toss' : betType === 'loser' ? `🧾 Loser pays ₹${expenseTotal} · Proceed to Toss` : '🏏 Proceed to Toss'}
        </button>
      </div>
    </div>
  );
}
