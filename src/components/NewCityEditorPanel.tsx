'use client';

import { useMemo, useState } from 'react';
import {
  layerOfCategory, type PrototypeInfo, type Layer,
} from '@/GamePlay/FightGame/Stage/NewCityEditor';

interface Props {
  prototypes: PrototypeInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  layer: Layer;
  onSetLayer: (layer: Layer) => void;
  onClear: () => void;
  placementCount: number;
  ready: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
  building: '建物',
  road: '道路',
  nature: '自然',
  props: '小物',
  vehicle: '車両',
  other: 'その他',
};
const CATEGORY_ORDER = ['road', 'nature', 'building', 'props', 'vehicle', 'other'];

export function NewCityEditorPanel(props: Props) {
  const {
    prototypes, selectedId, onSelect, layer, onSetLayer, onClear,
    placementCount, ready,
  } = props;
  const [filter, setFilter] = useState('');
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({ road: true, nature: true, building: true });

  const filtered = useMemo(() => {
    const lower = filter.toLowerCase();
    return prototypes.filter((p) =>
      layerOfCategory(p.id, p.category) === layer &&
      (!lower || p.id.toLowerCase().includes(lower)),
    );
  }, [filter, prototypes, layer]);

  const byCategory = useMemo(() => {
    const map = new Map<string, PrototypeInfo[]>();
    for (const p of filtered) {
      const arr = map.get(p.category) ?? [];
      arr.push(p);
      map.set(p.category, arr);
    }
    return CATEGORY_ORDER
      .filter((c) => map.has(c))
      .map((c) => [c, map.get(c)!] as const);
  }, [filtered]);

  if (!ready) {
    return (
      <div style={panelStyle}>
        <div style={{ padding: 20, textAlign: 'center', color: '#aaa' }}>
          ローディング中…
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <div style={{ fontWeight: 'bold' }}>NewCity Editor</div>
        <div style={{ fontSize: 11, color: '#aaa' }}>{placementCount} 個配置中</div>
      </div>

      {/* Layer toggle: ground (roads) vs building (on top) */}
      <div style={segmentRowStyle}>
        <button
          onClick={() => onSetLayer('ground')}
          style={segmentButtonStyle(layer === 'ground')}
        >
          🛣 地面・道路
        </button>
        <button
          onClick={() => onSetLayer('building')}
          style={segmentButtonStyle(layer === 'building')}
        >
          🏢 建物
        </button>
      </div>

      <div style={toolbarStyle}>
        <button onClick={onClear} style={{ ...smallButtonStyle, flex: 1, background: 'rgba(170,50,50,0.4)' }}>
          全消去
        </button>
      </div>

      <div style={instructionsStyle}>
        左クリック: 空きセル=配置 / 配置物=回転<br />
        右クリック: 空きセル=向き変更 / 配置物=消去
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="パーツ検索…"
        style={{ ...inputStyle, margin: '4px 0 8px 0' }}
      />

      <div style={listStyle}>
        {byCategory.map(([cat, list]) => (
          <div key={cat} style={categoryStyle}>
            <div
              style={categoryHeaderStyle}
              onClick={() => setOpenCats((o) => ({ ...o, [cat]: !o[cat] }))}
            >
              <span style={{ flex: 1 }}>{CATEGORY_LABEL[cat] ?? cat} ({list.length})</span>
              <span>{openCats[cat] ? '▾' : '▸'}</span>
            </div>
            {openCats[cat] && (
              <div>
                {list.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      ...itemStyle,
                      background: selectedId === p.id ? 'rgba(80, 140, 220, 0.4)' : 'transparent',
                    }}
                    onClick={() => onSelect(p.id)}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.id.replace(/^(Building|Natures|Props|Road|Vehicle)_/, '')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute', top: 12, right: 12, width: 280,
  maxHeight: 'calc(100vh - 24px)', display: 'flex', flexDirection: 'column',
  padding: '10px 12px', background: 'rgba(0, 0, 0, 0.7)', color: '#fff',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12,
  borderRadius: 6, pointerEvents: 'auto',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: 6, marginBottom: 6,
};
const toolbarStyle: React.CSSProperties = { display: 'flex', gap: 6, marginBottom: 6 };
const segmentRowStyle: React.CSSProperties = { display: 'flex', gap: 4, marginBottom: 6 };
function segmentButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '5px 4px',
    background: active ? 'rgba(80, 140, 220, 0.55)' : 'rgba(255,255,255,0.12)',
    color: '#fff', border: active ? '1px solid #8cc' : '1px solid rgba(255,255,255,0.25)',
    borderRadius: 4, cursor: 'pointer', fontSize: 11,
    fontWeight: active ? 'bold' : 'normal', whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  };
}
const instructionsStyle: React.CSSProperties = {
  fontSize: 10, color: '#ffeb3b', textAlign: 'center', padding: '4px',
  border: '1px solid rgba(255,235,59,0.3)', borderRadius: 4, marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  padding: '4px 6px', background: 'rgba(255,255,255,0.1)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.3)', borderRadius: 3, fontSize: 11,
  fontFamily: 'inherit', flex: 1, minWidth: 0,
};
const smallButtonStyle: React.CSSProperties = {
  padding: '4px 8px', background: 'rgba(255,255,255,0.15)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.3)', borderRadius: 3, cursor: 'pointer',
  fontSize: 11, whiteSpace: 'nowrap',
};
const listStyle: React.CSSProperties = { overflowY: 'auto', flex: 1 };
const categoryStyle: React.CSSProperties = { marginBottom: 4 };
const categoryHeaderStyle: React.CSSProperties = {
  display: 'flex', padding: '3px 4px', cursor: 'pointer',
  background: 'rgba(255,255,255,0.08)', borderRadius: 3, fontSize: 11,
  color: '#ffeb3b', marginBottom: 2,
};
const itemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '3px 6px',
  cursor: 'pointer', borderRadius: 2, fontSize: 11, lineHeight: 1.3,
};
