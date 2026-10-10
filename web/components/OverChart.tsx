'use client';
import React from 'react';
import st from './OverChart.module.css';

export type OverStat = { runs: number; wickets: number; live?: boolean };

const CHART_H = 150;

// Manhattan chart: runs per over, wickets as red dots, optional 1st-innings comparison bars
export default function OverChart({ data, compare, totalOvers, teamName, compareName }: {
  data: OverStat[]; compare?: OverStat[]; totalOvers: number; teamName: string; compareName?: string;
}) {
  const count = Math.max(data.length, compare?.length ?? 0, Math.min(totalOvers, 6));
  const maxRuns = Math.max(6, ...data.map(d => d.runs), ...(compare ?? []).map(d => d.runs));
  const step = maxRuns > 18 ? 10 : maxRuns > 9 ? 5 : 2;
  const top = Math.ceil(maxRuns / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step).reverse();
  const h = (runs: number) => Math.max(runs > 0 ? 3 : 0, (runs / top) * CHART_H);

  return (
    <div className={st.root}>
      <div className={st.legendRow}>
        <div className={st.legendItem}><div className={st.legendSwatch} style={{ backgroundColor: 'var(--sky)' }} /><span className={st.legendText}>{teamName}</span></div>
        {compare && compareName && (
          <div className={st.legendItem}><div className={st.legendSwatch} style={{ backgroundColor: '#CBD5E1' }} /><span className={st.legendText}>{compareName}</span></div>
        )}
        <div className={st.legendItem}><div className={st.wicketDot} /><span className={st.legendText}>Wicket</span></div>
      </div>

      <div className={st.chartRow}>
        <div className={st.axis} style={{ height: CHART_H }}>
          {ticks.map(t => <span key={t} className={st.axisText}>{t}</span>)}
        </div>
        <div className={st.scroll}>
          <div className={st.barsScroll}>
            <div className={st.plot} style={{ height: CHART_H }}>
              {ticks.map(t => <div key={t} className={st.gridLine} style={{ bottom: (t / top) * CHART_H }} />)}
              {Array.from({ length: count }, (_, i) => {
                const d = data[i];
                const c = compare?.[i];
                return (
                  <div key={i} className={st.group}>
                    {compare && <div className={`${st.bar} ${st.compareBar}`} style={{ height: c ? h(c.runs) : 0 }} />}
                    <div className={st.barCol}>
                      {d && d.wickets > 0 && (
                        <div className={st.wicketStack}>
                          {Array.from({ length: d.wickets }, (__, w) => <div key={w} className={st.wicketDot} />)}
                        </div>
                      )}
                      {d && d.runs > 0 && <span className={st.barValue}>{d.runs}</span>}
                      <div
                        className={`${st.bar} ${d?.live ? st.liveBar : ''} ${d && d.runs >= 12 ? st.bigBar : ''}`}
                        style={{ height: d ? h(d.runs) : 0 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={st.labels}>
              {Array.from({ length: count }, (_, i) => (
                <span key={i} className={`${st.label} ${compare ? st.labelWide : ''}`}>{i + 1}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <span className={st.caption}>Runs per over</span>
    </div>
  );
}
