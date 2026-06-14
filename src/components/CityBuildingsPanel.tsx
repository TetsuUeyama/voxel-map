'use client';

import { useMemo, useState } from 'react';
import type { CityBuildingEntry } from '@/GamePlay/FightGame/Stage/CityTerrain';

interface Props {
  buildings: CityBuildingEntry[];
}

const CATEGORY_LABEL: Record<string, string> = {
  commercial: '商業',
  residential: '住宅',
  kiosk: 'キオスク',
  overlay: 'オーバーレイ',
  vegetation: '植物',
  infrastructure: 'インフラ',
};

export function CityBuildingsPanel({ buildings }: Props) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const b of buildings) init[b.id] = b.defaultEnabled;
    return init;
  });
  const [collapsed, setCollapsed] = useState(false);

  const byCategory = useMemo(() => {
    const map = new Map<string, CityBuildingEntry[]>();
    for (const b of buildings) {
      const arr = map.get(b.category) ?? [];
      arr.push(b);
      map.set(b.category, arr);
    }
    return [...map.entries()];
  }, [buildings]);

  const toggle = (id: string) => {
    const b = buildings.find((x) => x.id === id);
    if (!b) return;
    const next = !enabled[id];
    b.mesh.setEnabled(next);
    setEnabled((prev) => ({ ...prev, [id]: next }));
  };

  const setAll = (v: boolean) => {
    for (const b of buildings) b.mesh.setEnabled(v);
    setEnabled(() => {
      const next: Record<string, boolean> = {};
      for (const b of buildings) next[b.id] = v;
      return next;
    });
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={collapsedButtonStyle}
        title="建物パネルを開く"
      >
        建物 ▸
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span>建物 ({buildings.length})</span>
        <button onClick={() => setCollapsed(true)} style={iconButtonStyle} title="折りたたむ">
          ◂
        </button>
      </div>
      <div style={actionsStyle}>
        <button onClick={() => setAll(true)} style={smallButtonStyle}>全て ON</button>
        <button onClick={() => setAll(false)} style={smallButtonStyle}>全て OFF</button>
      </div>
      <div style={listStyle}>
        {byCategory.map(([cat, list]) => (
          <div key={cat} style={categoryStyle}>
            <div style={categoryLabelStyle}>{CATEGORY_LABEL[cat] ?? cat}</div>
            {list.map((b) => (
              <label key={b.id} style={itemStyle}>
                <input
                  type="checkbox"
                  checked={enabled[b.id] ?? false}
                  onChange={() => toggle(b.id)}
                />
                <span style={itemNameStyle}>{b.name_ja}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  width: 240,
  maxHeight: 'calc(100vh - 24px)',
  display: 'flex',
  flexDirection: 'column',
  padding: '10px 12px',
  background: 'rgba(0, 0, 0, 0.65)',
  color: '#fff',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 12,
  borderRadius: 6,
  pointerEvents: 'auto',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontWeight: 'bold',
  borderBottom: '1px solid rgba(255,255,255,0.2)',
  paddingBottom: 6,
  marginBottom: 6,
};

const iconButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
  padding: 0,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginBottom: 8,
};

const smallButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '4px 6px',
  background: 'rgba(255,255,255,0.15)',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.3)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
};

const listStyle: React.CSSProperties = {
  overflowY: 'auto',
  flex: 1,
};

const categoryStyle: React.CSSProperties = {
  marginBottom: 8,
};

const categoryLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#ffeb3b',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 2,
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 0',
  cursor: 'pointer',
  lineHeight: 1.3,
};

const itemNameStyle: React.CSSProperties = {
  flex: 1,
};

const collapsedButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  padding: '6px 10px',
  background: 'rgba(0, 0, 0, 0.55)',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.3)',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 12,
  pointerEvents: 'auto',
};
