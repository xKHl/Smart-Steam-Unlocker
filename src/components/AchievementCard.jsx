import React, { useState } from 'react';
import { Lock, Unlock, Check, EyeOff, BarChart2, RotateCcw, Loader2 } from 'lucide-react';
import { useI18n } from '../i18n';

export default function AchievementCard({ achievement, isSelected, onToggleSelect, inQueue, queueIndex, onRelock, relockState = null }) {
  const { t } = useI18n();
  const { id, name, description, unlocked, hidden, globalPercent, iconUrl } = achievement;
  const [imgError, setImgError] = useState(false);

  const showImage = iconUrl && !imgError;

  return (
    <div
      className={`achievement-card ${unlocked ? 'unlocked' : 'locked'} ${isSelected ? 'selected' : ''}`}
      onClick={() => {
        if (!unlocked && !inQueue) onToggleSelect();
      }}
      role="button"
      tabIndex={unlocked || inQueue ? -1 : 0}
      aria-disabled={unlocked || inQueue}
      aria-pressed={isSelected}
    >
      <div 
        className="achievement-status-icon"
        style={showImage ? { padding: 0, overflow: 'hidden', position: 'relative' } : {}}
      >
        {showImage ? (
          <>
            <img 
              src={iconUrl} 
              alt="" 
              style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: unlocked ? 1 : 0.4 }} 
              onError={() => setImgError(true)}
            />
            {!unlocked && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
                <Lock size={18} color={isSelected ? "#a78bfa" : "#e2e8f0"} />
              </div>
            )}
          </>
        ) : (
          unlocked ? (
            <Unlock size={24} color="#4ade80" />
          ) : (
            <Lock size={24} color={isSelected ? "#a78bfa" : "#94a3b8"} />
          )
        )}
      </div>
      
      <div className="achievement-info">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <p className="achievement-name">{name || id}</p>
          {hidden && <EyeOff size={12} color="#94a3b8" title={t('common.hiddenAchievement')} />}
          {typeof globalPercent === 'number' && (
            <span className={`badge ${globalPercent < 10 ? 'badge-orange' : 'badge-green'}`} style={{ padding: '1px 6px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
              <BarChart2 size={10} />
              {globalPercent.toFixed(1)}%
            </span>
          )}
        </div>
        <p className="achievement-desc">
          {description || (hidden && !unlocked ? t('common.hiddenAchievement') : t('common.noDescription'))}
        </p>
      </div>

      {!unlocked && !inQueue && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {queueIndex > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-purple)' }}>
              #{queueIndex}
            </span>
          )}
          <div className={`achievement-checkbox ${isSelected ? 'checked' : ''}`}>
            {isSelected && <Check size={14} color="#fff" />}
          </div>
        </div>
      )}

      {unlocked && (
        <div className="achievement-relock-control" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="btn-secondary achievement-relock-button"
            onClick={() => onRelock?.(achievement)}
            disabled={relockState === 'requested' || relockState === 'verification-pending'}
            aria-label={t('achievements.relockAria', { achievement: name || id })}
            title={t('achievements.relockTooltip')}
          >
            {relockState === 'requested' ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
            {relockState === 'requested' ? t('achievements.relockRequested') : relockState === 'verification-pending' ? t('achievements.relockPending') : t('common.relock')}
          </button>
        </div>
      )}

      {inQueue && (
        <div className="achievement-in-queue-badge">
          {queueIndex > 0 ? `#${queueIndex} - ` : ''}{t('common.inQueue')}
        </div>
      )}
    </div>
  );
}
